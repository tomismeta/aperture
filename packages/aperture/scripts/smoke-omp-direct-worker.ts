import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertOmpAttentionEvent, type OmpAttentionEvent } from "../src/omp-attention-event.js";
import { serializeWorkerDirectMessage } from "../src/worker-direct-message.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const options = parseOptions(process.argv.slice(2));
const sourceBundle = path.resolve(
  options.worker ?? path.join(packageRoot, "dist", "aperture-attention-engine.cjs"),
);
const sessionId = "01a0123456789abcdef";
const occurredAtMs = Date.now() - 60_000;
const occurredAt = new Date(occurredAtMs).toISOString();
const checks: string[] = [];
const temporaryRoot = await mkdtemp("/tmp/ap-omp-smoke-");

try {
  const runtimeDir = path.join(temporaryRoot, "runtime");
  const configHome = path.join(temporaryRoot, "config");
  const stateDir = path.join(temporaryRoot, "state");
  const configDir = path.join(configHome, "omarchy", "aperture");
  const configPath = path.join(configDir, "config.json");
  const socketPath = path.join(runtimeDir, "omarchy", "aperture", "attention.sock");
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(runtimeDir, 0o700);
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      identities: [
        {
          id: "omp",
          kind: "omp",
          label: "OMP",
          applicationNames: ["aperture-omp"],
        },
      ],
    })}\n`,
    "utf8",
  );

  const first = startWorker(sourceBundle, configPath, stateDir, runtimeDir);
  const firstHello = await first.waitFor((message) => message.type === "hello");
  assert.equal(firstHello.protocolVersion, 4);
  assert.equal(firstHello.capabilities?.notificationInput, false);
  assert.equal(firstHello.capabilities?.ompDirectInput, true);
  checks.push("private-output-v4-omp-only-handshake");
  await first.waitFor((message) => message.type === "engine" && message.state === "ready");
  await first.waitFor((message) => message.type === "snapshot");
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);
  checks.push("private-worker-socket");

  const approval = event({
    eventId: "smoke:approval:1",
    interactionId: "tool-call-1",
    classification: "approval_requested",
    title: "OMP needs approval for bash",
    summary: "OMP is waiting for an operator decision.",
    transition: "requested",
  });
  await sendDirect(socketPath, approval);
  const approvalSnapshot = await first.waitFor(
    (message) => message.type === "snapshot" && message.totals?.now === 1,
  );
  assert.equal(approvalSnapshot.view?.now?.navigation, undefined);
  checks.push("unregistered-now-is-nonnavigable");

  const input = event({
    eventId: "smoke:input:1",
    occurredAt: timestamp(1_000),
    interactionId: "ask-2",
    classification: "input_requested",
    title: "OMP needs your input",
    summary: "OMP is waiting for an operator response.",
    transition: "requested",
  });
  await sendDirect(socketPath, input);
  const queued = await first.waitFor(
    (message) => message.type === "snapshot" && message.totals?.next === 1,
  );
  assert.equal(queued.view?.next?.[0]?.title, input.title);
  assert.equal(queued.view?.next?.[0]?.navigation, undefined);
  checks.push("unregistered-next-is-nonnavigable");

  await sendDirect(socketPath, input);
  const changed = event({ ...input, eventId: "smoke:input:2", title: "OMP needs a decision" });
  await sendDirect(socketPath, changed);
  const changedSnapshot = await first.waitFor(
    (message) => message.type === "snapshot" && message.view?.next?.[0]?.title === changed.title,
  );
  assert.equal(changedSnapshot.view?.next?.length, 1);
  checks.push("idempotent-replay-and-update");

  const approvalResolved = event({
    eventId: "smoke:approval:resolved",
    occurredAt: timestamp(2_000),
    interactionId: "tool-call-1",
    classification: "approval_resolved",
    title: "OMP approval resolved",
    summary: "OMP resumed after operator approval.",
    transition: "resolved",
  });
  await sendDirect(socketPath, approvalResolved);
  const resolved = await first.waitFor(
    (message) => message.type === "snapshot" && message.view?.now?.title === changed.title,
  );
  assert.equal(resolved.totals?.next, 0);
  checks.push("canonical-resolution");

  await first.shutdown();
  await assert.rejects(() => stat(socketPath), /ENOENT/);
  const second = startWorker(sourceBundle, configPath, stateDir, runtimeDir);
  const secondHello = await second.waitFor((message) => message.type === "hello");
  assert.equal(secondHello.protocolVersion, 4);
  await second.waitFor((message) => message.type === "engine" && message.state === "ready");
  const replayed = await second.waitFor(
    (message) => message.type === "snapshot" && message.view?.now?.title === changed.title,
  );
  assert.equal(replayed.view?.now?.navigation, undefined);
  checks.push("volatile-navigation-is-not-replayed");

  await sendDirect(
    socketPath,
    event({
      eventId: "smoke:shutdown",
      occurredAt: timestamp(3_000),
      classification: "session_shutdown",
      title: "OMP session shut down",
      summary: "OMP closed the originating agent session.",
      transition: "shutdown",
    }),
  );
  await second.waitFor(
    (message) =>
      message.type === "snapshot" &&
      message.totals?.now === 0 &&
      message.totals?.next === 0 &&
      message.totals?.ambient === 0,
  );
  checks.push("session-shutdown-cleanup");

  second.write({
    type: "notification.observed",
    key: "native-fallback",
    occurredAt: timestamp(4_000),
    application: { name: "aperture-omp" },
    summary: `Open OMP session ${sessionId}`,
    urgency: "critical",
  });
  const rejectedGenericInput = await second.waitFor(
    (message) =>
      message.type === "error" &&
      message.code === "invalid_input" &&
      message.message?.includes("disabled in OMP-only mode") === true,
  );
  assert.equal(rejectedGenericInput.recoverable, true);
  checks.push("generic-notification-input-disabled");

  await second.shutdown();
  await assert.rejects(() => stat(socketPath), /ENOENT/);
  const persisted = await readFile(path.join(stateDir, "omp-direct-state.json"), "utf8");
  assert.equal(persisted.includes("prompt"), false);
  assert.equal(persisted.includes("rawTool"), false);
  checks.push("private-bounded-state");
  checks.push("clean-worker-shutdown");

  const bundle = await readFile(sourceBundle);
  const report = {
    schemaVersion: 1,
    proofId: "aperture-omp-direct-transport-conformance-v1",
    privacyProofId: "aperture-omp-direct-privacy-v1",
    passed: true,
    nodeVersion: process.versions.node,
    navigationProofId: "aperture-opaque-focus-navigation-v4",
    bundle: {
      sha256: createHash("sha256").update(bundle).digest("hex"),
      bytes: bundle.byteLength,
    },
    cleanDirectoryWithoutNodeModules: true,
    socket: {
      relativePath: "omarchy/aperture/attention.sock",
      directoryMode: "0700",
      socketMode: "0600",
      removedOnShutdown: true,
    },
    checks,
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

type SmokeOptions = { worker?: string; report?: string };

type WorkerMessage = {
  type?: string;
  protocolVersion?: number;
  state?: string;
  totals?: { now?: number; next?: number; ambient?: number };
  code?: string;
  message?: string;
  recoverable?: boolean;
  capabilities?: {
    notificationInput?: boolean;
    ompDirectInput?: boolean;
  };
  view?: {
    now?: WorkerFrame | null;
    next?: WorkerFrame[];
    ambient?: WorkerFrame[];
  };
};

type WorkerFrame = {
  title?: string;
  navigation?: { kind?: string; handle?: string };
};

type WorkerHarness = {
  waitFor(predicate: (message: WorkerMessage) => boolean): Promise<WorkerMessage>;
  write(message: unknown): void;
  shutdown(): Promise<void>;
};

function startWorker(
  worker: string,
  config: string,
  stateDir: string,
  runtimeDir: string,
): WorkerHarness {
  const child = spawn(process.execPath, [worker, "--config", config, "--state-dir", stateDir], {
    cwd: path.dirname(worker),
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: WorkerMessage[] = [];
  const events = new EventEmitter();
  let cursor = 0;
  let buffered = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline === -1) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as WorkerMessage;
      messages.push(message);
      events.emit("message", message);
    }
  });

  return {
    async waitFor(predicate): Promise<WorkerMessage> {
      for (;;) {
        for (let index = cursor; index < messages.length; index += 1) {
          const message = messages[index]!;
          if (!predicate(message)) continue;
          cursor = index + 1;
          return message;
        }
        const [message] = await once(events, "message", { signal: AbortSignal.timeout(5_000) });
        if (predicate(message as WorkerMessage)) {
          cursor = messages.length;
          return message as WorkerMessage;
        }
      }
    },
    write(message): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    async shutdown(): Promise<void> {
      child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
      const [code, signal] = await once(child, "close", { signal: AbortSignal.timeout(5_000) });
      assert.equal(code, 0, `worker failed (${String(signal)}): ${stderr}`);
    },
  };
}

async function sendDirect(socketPath: string, directEvent: OmpAttentionEvent): Promise<void> {
  const socket = createConnection({ path: socketPath });
  let response = "";
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.write(serializeWorkerDirectMessage(directEvent)));
  socket.on("data", (chunk: string) => {
    response += chunk;
  });
  await once(socket, "close", { signal: AbortSignal.timeout(2_000) });
  const acknowledgement = JSON.parse(response) as {
    schemaVersion?: number;
    status?: string;
    requestId?: string;
  };
  assert.deepEqual(acknowledgement, {
    schemaVersion: 4,
    status: "accepted",
    requestId: directEvent.eventId,
  });
}

function timestamp(offsetMs: number): string {
  return new Date(occurredAtMs + offsetMs).toISOString();
}

function event(
  facts: Omit<OmpAttentionEvent, "schemaVersion" | "type" | "occurredAt" | "sessionId"> & {
    occurredAt?: string;
  },
): OmpAttentionEvent {
  return assertOmpAttentionEvent({
    schemaVersion: 2,
    type: "omp.attention-event",
    occurredAt: facts.occurredAt ?? occurredAt,
    sessionId,
    ...facts,
  });
}

function parseOptions(args: string[]): SmokeOptions {
  const parsed: SmokeOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--worker" || argument === "--report") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--worker") parsed.worker = value;
      else parsed.report = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown direct worker smoke option: ${argument ?? "(missing)"}`);
  }
  return parsed;
}
