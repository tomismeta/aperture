import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";

type WorkerMessage = { type?: string; state?: string; code?: string; recoverable?: boolean };

// Both source regression and artifact smoke exercise real children with stdin held open.
export async function proveOmpWorkerStartup(workerArguments: string[]): Promise<string[]> {
  const root = await mkdtemp("/tmp/ap-omp-startup-");
  const socketPath = path.join(root, "omarchy", "aperture", "attention.sock");
  const stateDir = path.join(root, "state");
  const oldServer = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.on("data", () => socket.end("old-server-responsive\n"));
  });
  try {
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    oldServer.listen(socketPath);
    await once(oldServer, "listening");
    await chmod(socketPath, 0o600);
    const oldIdentity = await lstat(socketPath);
    assert.equal(await exchange(socketPath, "probe\n"), "old-server-responsive\n");
    const failed = await runChild(workerArguments, root, stateDir);
    assertFailedStartup(failed, 75, true);
    const preserved = await lstat(socketPath);
    assert.equal(preserved.dev, oldIdentity.dev);
    assert.equal(preserved.ino, oldIdentity.ino);
    assert.equal(preserved.mode & 0o777, 0o600);
    assert.equal(await exchange(socketPath, "probe\n"), "old-server-responsive\n");

    // The old endpoint is released only after the failed new process has terminated.
    await new Promise<void>((resolve, reject) =>
      oldServer.close((error) => (error ? reject(error) : resolve())),
    );
    const retry = await runChild(workerArguments, root, stateDir, async () => {
      const metadata = await lstat(socketPath);
      assert.equal(metadata.isSocket(), true);
      assert.equal(metadata.uid, process.getuid!());
      assert.equal(metadata.mode & 0o777, 0o600);
      const heartbeat = {
        schemaVersion: 4,
        type: "omp.session-heartbeat",
        requestId: "startup-retry-heartbeat",
        sessionId: "startup-retry-session",
      };
      assert.deepEqual(JSON.parse(await exchange(socketPath, `${JSON.stringify(heartbeat)}\n`)), {
        schemaVersion: 4,
        status: "accepted",
        requestId: heartbeat.requestId,
      });
    });
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(
      retry.messages.some((message) => message.type === "snapshot"),
      true,
    );
    await assert.rejects(() => lstat(socketPath), { code: "ENOENT" });

    const external = path.join(root, "external");
    await writeFile(external, "must survive\n", { mode: 0o600 });
    await symlink(external, socketPath);
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 74, false);
    assert.equal((await lstat(socketPath)).isSymbolicLink(), true);
    assert.equal(await readFile(external, "utf8"), "must survive\n");
    await unlink(socketPath);
    await writeFile(socketPath, "not a socket\n", { mode: 0o600 });
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 74, false);
    assert.equal(await readFile(socketPath, "utf8"), "not a socket\n");
    await unlink(socketPath);
    await chmod(path.dirname(socketPath), 0o755);
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 74, false);
    assert.equal((await lstat(path.dirname(socketPath))).mode & 0o777, 0o755);
    await chmod(path.dirname(socketPath), 0o700);
    assertFailedStartup(await runChild(workerArguments, "relative-runtime", stateDir), 74, false);
    oldServer.listen(socketPath);
    await once(oldServer, "listening");
    await chmod(socketPath, 0o666);
    const unsafeSocket = await lstat(socketPath);
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 74, false);
    assert.equal((await lstat(socketPath)).ino, unsafeSocket.ino);
    assert.equal((await lstat(socketPath)).mode & 0o777, 0o666);
    await new Promise<void>((resolve) => oldServer.close(() => resolve()));

    const lockPath = path.join(path.dirname(socketPath), ".attention.sock.lifecycle.lock");
    const lockOwner = `${JSON.stringify({ pid: process.pid, token: "A".repeat(24) })}\n`;
    await writeFile(lockPath, lockOwner, { mode: 0o600 });
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 75, true);
    assert.equal(await readFile(lockPath, "utf8"), lockOwner);
    await chmod(lockPath, 0o644);
    assertFailedStartup(await runChild(workerArguments, root, stateDir), 74, false);
    assert.equal(await readFile(lockPath, "utf8"), lockOwner);
    return [
      "live-socket-overlap-exit75-open-stdin-no-ready-or-snapshot",
      "live-socket-identity-and-responsiveness-preserved",
      "fresh-process-retry-private-owned-socket-accepted-v4-heartbeat",
      "unsafe-startup-exit74-open-stdin-no-ready-or-snapshot-no-deletion",
      "lifecycle-lock-contention-exit75-and-unsafe-lock-exit74",
    ];
  } finally {
    if (oldServer.listening) await new Promise<void>((resolve) => oldServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

function assertFailedStartup(result: ChildResult, exitCode: number, recoverable: boolean): void {
  assert.equal(result.code, exitCode, result.stderr);
  assert.deepEqual(
    result.messages
      .filter((message) => message.type === "error")
      .map((message) => ({
        code: message.code,
        recoverable: message.recoverable,
      })),
    [{ code: "direct_transport_unavailable", recoverable }],
  );
  assert.equal(
    result.messages.some((message) => message.type === "engine" && message.state === "ready"),
    false,
  );
  assert.equal(
    result.messages.some((message) => message.type === "snapshot"),
    false,
  );
}

type ChildResult = { code: number | null; messages: WorkerMessage[]; stderr: string };

async function runChild(
  workerArguments: string[],
  runtimeDir: string,
  stateDir: string,
  onReady?: () => Promise<void>,
): Promise<ChildResult> {
  const child = spawn(process.execPath, [...workerArguments, "--state-dir", stateDir], {
    cwd: path.dirname(workerArguments[workerArguments.length - 1]!),
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: WorkerMessage[] = [];
  let pending = "";
  let stderr = "";
  let failure: unknown;
  let ready = false;
  let readyOperation = Promise.resolve();
  const deadline = setTimeout(() => {
    failure = new Error("Worker startup did not exit with stdin held open");
    child.kill("SIGKILL");
  }, 10_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as WorkerMessage;
        messages.push(message);
        if (!ready && onReady && message.type === "engine" && message.state === "ready") {
          ready = true;
          readyOperation = onReady()
            .then(() => {
              child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
            })
            .catch((error: unknown) => {
              failure = error;
              child.kill("SIGKILL");
            });
        }
      } catch (error) {
        failure = error;
        child.kill("SIGKILL");
      }
    }
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      failure = error;
      child.kill("SIGKILL");
    }
  });
  try {
    const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    await readyOperation;
    if (failure) throw failure;
    assert.equal(signal, null, stderr);
    if (onReady) assert.equal(ready, true, stderr);
    return { code, messages, stderr };
  } finally {
    clearTimeout(deadline);
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function exchange(socketPath: string, line: string): Promise<string> {
  const socket = createConnection({ path: socketPath });
  socket.setEncoding("utf8");
  socket.setTimeout(2_000, () => socket.destroy(new Error("Socket response timed out")));
  let response = "";
  socket.once("connect", () => socket.write(line));
  socket.on("data", (chunk: string) => {
    response += chunk;
  });
  try {
    await once(socket, "close");
    return response;
  } finally {
    socket.destroy();
  }
}
