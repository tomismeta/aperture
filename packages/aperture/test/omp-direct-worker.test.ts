import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  OMP_ATTENTION_LIMITS,
  OmpAttentionEventError,
  assertOmpAttentionEvent,
  parseOmpAttentionEvent,
  resolveOmpAttentionSocketPath,
  type OmpAttentionEvent,
} from "../src/omp-attention-event.js";
import type { NotificationWorkerIdentity } from "../src/notification-worker/adapter.js";
import {
  assertOwnedSocketMetadata,
  prepareSocketPath,
  startOmpAttentionSocketServer,
} from "../src/notification-worker/direct-server.js";
import { NotificationWorkerEngine } from "../src/notification-worker/engine.js";
import type { NotificationWorkerInput } from "../src/notification-worker/protocol.js";
import {
  loadOmpDirectState,
  ompDirectRecordCount,
  saveOmpDirectState,
} from "../src/notification-worker/omp-direct-state-store.js";
import { runNotificationWorkerStdio } from "../src/notification-worker/stdio.js";
import { assertApertureSurfaceMessage } from "../src/surface/protocol-validator.js";
import { OmpDirectWorkerTransport } from "../../omp/src/direct-worker-transport.js";

const sessionId = "01a0123456789abcdef";
const occurredAt = "2026-09-01T16:00:00.000Z";
const focusHandle = "A23456789_-bcdefghijklmnopqrstuv";
const identity: NotificationWorkerIdentity = {
  id: "omp",
  kind: "omp",
  label: "OMP",
  applicationNames: ["aperture-omp"],
};

function directEvent(overrides: Partial<OmpAttentionEvent> = {}): OmpAttentionEvent {
  return assertOmpAttentionEvent({
    schemaVersion: 2,
    type: "omp.attention-event",
    eventId: "event:approval:1",
    occurredAt,
    sessionId,
    focus: { kind: "opaque-focus", handle: focusHandle },
    interactionId: "tool-call-1",
    classification: "approval_requested",
    title: "OMP needs approval for bash",
    summary: "OMP is waiting for an operator decision.",
    transition: "requested",
    ...overrides,
  });
}

function notificationInput(summary: string): NotificationWorkerInput {
  return {
    type: "notification.observed",
    key: "omp-native-fallback",
    occurredAt,
    application: { name: "aperture-omp" },
    summary,
    urgency: "critical",
  };
}

test("direct OMP contract rejects private or malformed payloads and preserves opaque ids", () => {
  assert.equal(
    directEvent({ sessionId: "opaque;$(touch should-not-run)" }).sessionId,
    "opaque;$(touch should-not-run)",
  );
  assert.throws(
    () =>
      directEvent({
        classification: "unknown" as OmpAttentionEvent["classification"],
      }),
    /classification/,
  );
  assert.throws(() => parseOmpAttentionEvent("{"), OmpAttentionEventError);
  assert.throws(() => directEvent({ schemaVersion: 1 as 2 }), /schema version/);
  assert.throws(() => directEvent({ type: "unknown" as "omp.attention-event" }), /type/);
  assert.throws(() => directEvent({ sessionId: "" }), /sessionId/);
  assert.throws(() => directEvent({ sessionId: "bad\nsession" }), /sessionId/);
  assert.throws(() => directEvent({ sessionId: "x".repeat(161) }), /sessionId/);
  assert.throws(
    () => directEvent({ sessionId: "/home/tom/.omp/session.jsonl" }),
    /filesystem path/,
  );
  assert.throws(() => directEvent({ title: "Read /Users/tom/private/session.jsonl" }), /private/);
  assert.throws(
    () =>
      assertOmpAttentionEvent({
        ...directEvent(),
        prompt: "private prompt",
        rawToolOutput: "secret",
      }),
    /unknown field/,
  );
  assert.throws(
    () => parseOmpAttentionEvent(JSON.stringify({ ...directEvent(), summary: "x".repeat(70_000) })),
    /byte limit/,
  );
});

test("surface navigation is closed, bounded, and absent without a worker route", () => {
  const frame = {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve",
    source: { kind: "omp", label: "OMP" },
    timing: { createdAt: occurredAt, updatedAt: occurredAt },
  };
  assertApertureSurfaceMessage({
    type: "snapshot",
    sequence: 1,
    sources: [{ kind: "omp", label: "OMP" }],
    totals: { now: 1, next: 0, ambient: 0, sources: 1 },
    view: {
      now: { ...frame, navigation: { kind: "opaque-focus", handle: focusHandle } },
      next: [],
      ambient: [],
    },
  });
  for (const navigation of [
    { kind: "unknown", handle: focusHandle },
    { kind: "opaque-focus", handle: "" },
    { kind: "opaque-focus", handle: "bad\nhandle" },
    { kind: "opaque-focus", handle: "x".repeat(31) },
    { kind: "opaque-focus", handle: "x".repeat(33) },
  ]) {
    assert.throws(() =>
      assertApertureSurfaceMessage({
        type: "snapshot",
        sequence: 1,
        sources: [{ kind: "omp", label: "OMP" }],
        totals: { now: 1, next: 0, ambient: 0, sources: 1 },
        view: { now: { ...frame, navigation }, next: [], ambient: [] },
      }),
    );
  }
});

test("direct OMP events produce canonical NOW and NEXT with replayable navigation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-direct-engine-"));
  let now = Date.parse(occurredAt);
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => now,
  });

  const approval = directEvent();
  await restored.engine.handleOmpAttention(approval, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  const first = restored.engine.snapshot();
  assert.equal(first.view.now?.title, approval.title);
  assert.deepEqual(first.view.now?.navigation, { kind: "opaque-focus", handle: focusHandle });
  assert.deepEqual(first.view.next, []);

  const input = directEvent({
    eventId: "event:input:1",
    occurredAt: "2026-09-01T16:00:01.000Z",
    interactionId: "ask-2",
    classification: "input_requested",
    title: "OMP needs your input",
    summary: "OMP is waiting for an operator response.",
  });
  now = Date.parse(input.occurredAt);
  await restored.engine.handleOmpAttention(input, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  const queued = restored.engine.snapshot();
  assert.equal(queued.view.now?.title, approval.title);
  assert.equal(queued.view.next.length, 1);
  assert.equal(queued.view.next[0]?.title, input.title);
  assert.deepEqual(queued.view.next[0]?.navigation, {
    kind: "opaque-focus",
    handle: focusHandle,
  });

  await restored.engine.handleOmpAttention(input);
  assert.equal(restored.engine.snapshot().view.next.length, 1);
  const changed = directEvent({
    ...input,
    eventId: "event:input:2",
    title: "OMP needs a decision",
  });
  await restored.engine.handleOmpAttention(changed);
  const updated = restored.engine.snapshot();
  assert.equal(updated.view.next.length, 1);
  assert.equal(updated.view.next[0]?.title, "OMP needs a decision");

  const replayed = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => now,
  });
  assert.equal(replayed.engine.snapshot().view.now?.navigation, undefined);
  await replayed.engine.handleOmpAttention(changed, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  assert.deepEqual(replayed.engine.snapshot().view.next[0]?.navigation, {
    kind: "opaque-focus",
    handle: focusHandle,
  });

  await replayed.engine.handleOmpAttention(
    directEvent({
      eventId: "event:approval:resolved",
      occurredAt: "2026-09-01T16:00:02.000Z",
      classification: "approval_resolved",
      title: "OMP approval resolved",
      summary: "OMP resumed after operator approval.",
      transition: "resolved",
    }),
  );
  const resolved = replayed.engine.snapshot();
  assert.equal(resolved.view.now?.title, "OMP needs a decision");
  assert.deepEqual(resolved.view.now?.navigation, {
    kind: "opaque-focus",
    handle: focusHandle,
  });

  await replayed.engine.handleOmpAttention(
    directEvent({
      eventId: "event:shutdown",
      occurredAt: "2026-09-01T16:00:03.000Z",
      interactionId: undefined,
      classification: "session_shutdown",
      title: "OMP session shut down",
      summary: "OMP closed the originating agent session.",
      transition: "shutdown",
    }),
  );
  const shutdown = replayed.engine.snapshot();
  assert.equal(shutdown.view.now, null);
  assert.deepEqual(shutdown.view.next, []);
  assert.equal(JSON.stringify(shutdown).includes(sessionId), false);
});
test("direct navigation expires with bounded private persisted state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-direct-expiry-"));
  let now = Date.parse(occurredAt);
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => now,
  });
  await restored.engine.handleOmpAttention(directEvent());
  const statePath = path.join(root, "omp-direct-state.json");
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  const persisted = await readFile(statePath, "utf8");
  assert.equal(persisted.includes("prompt"), false);
  assert.equal(persisted.includes("rawTool"), false);
  assert.equal(persisted.includes(focusHandle), false);
  assert.equal(persisted.includes("markerTitle"), false);
  assert.equal(persisted.includes("herdrSocketPath"), false);

  now += 25 * 60 * 60 * 1000;
  const expired = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => now,
  });
  const snapshot = expired.engine.snapshot();
  assert.equal(snapshot.view.now, null);
  assert.deepEqual(snapshot.view.next, []);
  assert.equal(JSON.stringify(snapshot).includes(sessionId), false);
});

test("notification fallback remains Ambient and cannot manufacture navigation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-notification-fallback-"));
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  await restored.engine.handle(notificationInput(`Open OMP session ${sessionId}`));
  const snapshot = restored.engine.snapshot();
  assert.equal(snapshot.view.now, null);
  assert.deepEqual(snapshot.view.next, []);
  assert.equal(snapshot.view.ambient.length, 1);
  assert.equal(snapshot.view.ambient[0]?.navigation, undefined);
});

test("direct OMP persistence remains private and record-bounded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-direct-bounds-"));
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  await restored.engine.handleOmpAttention(directEvent());
  const loaded = await loadOmpDirectState(root, Date.parse(occurredAt));
  const base = loaded.state.active[0]!;
  const revision = base.revisions[0]!;
  loaded.state.active[0] = {
    ...base,
    revisions: Array.from({ length: 1_100 }, (_, index) => {
      const timestamp = new Date(Date.parse(occurredAt) + index * 1_000).toISOString();
      return {
        ...revision,
        occurredAt: timestamp,
        sourceEvent: {
          ...revision.sourceEvent,
          id: `omp-direct:bounded-${index}`,
          timestamp,
        },
      };
    }),
  };
  const now = Date.parse(occurredAt) + 1_100 * 1_000;
  const bounded = await saveOmpDirectState(root, loaded.state, now);
  assert(ompDirectRecordCount(bounded) <= 1_024);
  const statePath = path.join(root, "omp-direct-state.json");
  assert((await stat(statePath)).size <= 4 * 1024 * 1024);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
  const corrupted = JSON.parse(await readFile(statePath, "utf8")) as {
    active: Array<{ revisions: Array<{ sourceEvent: Record<string, unknown> }> }>;
  };
  corrupted.active[0]!.revisions[0]!.sourceEvent.prompt = "private prompt";
  await writeFile(statePath, JSON.stringify(corrupted), "utf8");
  const recovered = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => now,
  });
  assert.equal(recovered.recoveredCorruptState, true);
  assert.equal(recovered.engine.snapshot().view.now, null);
});

test("worker-owned socket validates ownership, bounds input, and removes itself", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-socket-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const received: OmpAttentionEvent[] = [];
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async (event) => {
      received.push(event);
    },
    registerFocus: async () => undefined,
    revokeFocus: () => undefined,
  });
  const socketMetadata = await lstat(socketPath);
  assert.equal(socketMetadata.isSocket(), true);
  assert.equal(socketMetadata.mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);
  assert.throws(() => assertOwnedSocketMetadata(socketMetadata, socketMetadata.uid + 1), /owner/);

  const client = new OmpDirectWorkerTransport({ socketPath });
  await client.send(directEvent());
  assert.equal(received.length, 1);
  assert.match(await sendRaw(socketPath, "{\n"), /rejected/);
  assert.match(
    await sendRaw(socketPath, `${"x".repeat(OMP_ATTENTION_LIMITS.jsonLineBytes)}\n`),
    /rejected/,
  );

  await server.close();
  await assert.rejects(() => lstat(socketPath), /ENOENT/);
});

test("worker shutdown removes its direct OMP socket", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-worker-shutdown-");
  const stateDir = path.join(runtimeRoot, "state");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const input = new PassThrough();
  const messages = new EventEmitter();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(String(chunk)) as { type?: string; state?: string };
      if (message.type === "engine" && message.state === "ready") messages.emit("ready");
      callback();
    },
  });
  const ready = once(messages, "ready");
  const running = runNotificationWorkerStdio({
    packageVersion: "0.6.0",
    identities: [identity],
    stateDir,
    socketPath,
    input,
    output,
  });
  await ready;
  assert.equal((await lstat(socketPath)).isSocket(), true);
  input.end(`${JSON.stringify({ type: "shutdown" })}\n`);
  await running;
  await assert.rejects(() => lstat(socketPath), /ENOENT/);
});

test("socket path rejects symlinks and recovers an unchanged stale socket", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-safety-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(path.join(runtimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(socketPath), 0o700);
  const target = path.join(runtimeRoot, "target");
  await writeFile(target, "not a socket", "utf8");
  await symlink(target, socketPath);
  await assert.rejects(() => prepareSocketPath(socketPath, process.getuid!()), /symlink/);

  const staleRuntimeRoot = await mkdtemp("/tmp/ap-omp-stale-");
  const stalePath = path.join(staleRuntimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(stalePath), { recursive: true, mode: 0o700 });
  await chmod(path.join(staleRuntimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(stalePath), 0o700);

  const fileRuntimeRoot = await mkdtemp("/tmp/ap-omp-file-");
  const filePath = path.join(fileRuntimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.join(fileRuntimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(filePath), 0o700);
  await writeFile(filePath, "unsafe replacement", "utf8");
  await assert.rejects(() => prepareSocketPath(filePath, process.getuid!()), /not a socket/);
  const staleServer = createServer();
  staleServer.listen(stalePath);
  await once(staleServer, "listening");
  await prepareSocketPath(stalePath, process.getuid!(), async () => false);
  await assert.rejects(() => lstat(stalePath), /ENOENT/);
  staleServer.close();
  await once(staleServer, "close");
});

test("socket resolver uses only an absolute XDG runtime directory", () => {
  assert.equal(
    resolveOmpAttentionSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }),
    "/run/user/1000/omarchy/aperture/attention.sock",
  );
  assert.equal(resolveOmpAttentionSocketPath({ XDG_RUNTIME_DIR: "relative" }), undefined);
  assert.equal(resolveOmpAttentionSocketPath({}), undefined);
});

async function sendRaw(socketPath: string, value: string): Promise<string> {
  const socket = createConnection({ path: socketPath });
  let response = "";
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.write(value));
  socket.on("data", (chunk: string) => {
    response += chunk;
  });
  await once(socket, "close");
  return response;
}
