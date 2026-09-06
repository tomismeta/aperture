import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../src/omp-attention-worker.ts", import.meta.url));

test("worker exits after shutdown lock contention instead of retaining its owned listener", async () => {
  await exerciseFailedShutdown(async (socketPath) => {
    await writeFile(
      path.join(path.dirname(socketPath), ".attention.sock.lifecycle.lock"),
      `${JSON.stringify({ pid: process.pid, token: "A".repeat(24) })}\n`,
      { mode: 0o600 },
    );
    return async () => {
      await assert.rejects(() => connect(socketPath), { code: "ECONNREFUSED" });
      assert.equal((await lstat(socketPath)).isSocket(), true);
    };
  });
});

test("worker exits on unsafe shutdown lock metadata without removing a replacement listener", async () => {
  await exerciseFailedShutdown(async (socketPath, trackServer) => {
    const lockPath = path.join(path.dirname(socketPath), ".attention.sock.lifecycle.lock");
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, token: "B".repeat(24) })}\n`, {
      mode: 0o600,
    });
    await chmod(lockPath, 0o644);
    return replaceListener(socketPath, trackServer);
  });
});

test("worker checks socket identity before closing even with the shutdown lock held", async () => {
  await exerciseFailedShutdown(replaceListener);
});

test("worker exits on unsafe shutdown directories without closing a replacement pathname", async () => {
  await exerciseFailedShutdown(async (socketPath, trackServer) => {
    const verify = await replaceListener(socketPath, trackServer);
    await chmod(path.dirname(socketPath), 0o755);
    return verify;
  });
});

async function exerciseFailedShutdown(
  prepare: (
    socketPath: string,
    trackServer: (server: Server) => void,
  ) => Promise<() => Promise<void>>,
): Promise<void> {
  const root = await mkdtemp("/tmp/ap-omp-teardown-");
  const socketPath = path.join(root, "omarchy", "aperture", "attention.sock");
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), workerPath, "--state-dir", path.join(root, "state")],
    { env: { ...process.env, XDG_RUNTIME_DIR: root }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  let pending = "";
  let failure: unknown;
  let ready = false;
  let verify: (() => Promise<void>) | undefined;
  const replacements: Server[] = [];
  let preparation = Promise.resolve();
  // This watchdog bounds a real subprocess hang; fake time cannot drive its event loop.
  const deadline = setTimeout(() => {
    failure = new Error("Worker retained a listener or process after failed shutdown");
    child.kill("SIGKILL");
  }, 10_000);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      failure = error;
      child.kill("SIGKILL");
    }
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const message = JSON.parse(line) as { type?: string; state?: string };
        if (!ready && message.type === "engine" && message.state === "ready") {
          ready = true;
          preparation = prepare(socketPath, (server) => replacements.push(server))
            .then((check) => {
              verify = check;
              // Leave stdin open: exit must result from shutdown, not parent EOF.
              child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
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
  try {
    const [code, signal] = await once(child, "close");
    await preparation;
    if (failure) throw failure;
    assert.equal(ready, true, stderr);
    assert.equal(signal, null, stderr);
    assert.equal(code, 1, stderr);
    assert.ok(verify);
    await verify();
  } finally {
    clearTimeout(deadline);
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "close");
    }
    try {
      for (const replacement of replacements) await closeServer(replacement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function replaceListener(
  socketPath: string,
  trackServer: (server: Server) => void,
): Promise<() => Promise<void>> {
  await unlink(socketPath);
  const replacement = createServer((socket) => socket.end("replacement\n"));
  trackServer(replacement);
  replacement.listen(socketPath);
  await once(replacement, "listening");
  const identity = await lstat(socketPath);
  return async () => {
    const current = await lstat(socketPath);
    assert.equal(current.dev, identity.dev);
    assert.equal(current.ino, identity.ino);
    const socket = await connect(socketPath);
    socket.setEncoding("utf8");
    let response = "";
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    try {
      await once(socket, "close");
      assert.equal(response, "replacement\n");
    } finally {
      socket.destroy();
    }
  };
}

async function connect(socketPath: string) {
  const socket = createConnection({ path: socketPath });
  socket.setTimeout(2_000, () => socket.destroy(new Error("Socket probe timed out")));
  try {
    await once(socket, "connect");
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
