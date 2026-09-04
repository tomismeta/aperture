import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
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
import {
  assertWorkerDirectMessage,
  parseWorkerDirectAcknowledgement,
} from "../src/worker-direct-message.js";
import type { NotificationWorkerIdentity } from "../src/notification-worker/adapter.js";
import { startOmpAttentionSocketServer } from "../src/notification-worker/direct-server.js";
import {
  assertOwnedSocketMetadata,
  cleanupOwnedSocket,
  closeOwnedSocketServer,
  listenOnOwnedSocket,
  OwnedSocketCleanupError,
  OWNED_SOCKET_CLEANUP_DEADLINE_MS,
} from "../src/notification-worker/direct-socket-lifecycle.js";
import { NotificationWorkerEngine } from "../src/notification-worker/engine.js";
import type { NotificationWorkerInput } from "../src/notification-worker/protocol.js";
import {
  loadOmpDirectState,
  ompDirectRecordCount,
  pruneOmpDirectState,
  saveOmpDirectState,
  migrateOmpDirectStateV1,
  type OmpDirectPersistedState,
} from "../src/notification-worker/omp-direct-state-store.js";
import {
  OmpSessionCapacityError,
  OmpSessionLiveness,
} from "../src/notification-worker/session-liveness.js";
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

test("private focus control v4 is generic, exact, and recovery-bounded", () => {
  const registration = {
    schemaVersion: 4,
    type: "focus.register",
    requestId: "focus-register-1",
    publicHandle: "A".repeat(32),
    hostGeneration: "B".repeat(32),
    target: {
      kind: "herdr",
      socketPath: "/run/user/1000/herdr.sock",
      paneId: "wA:p1",
      hyprlandInstance: "instance_1",
    },
  };
  assert.deepEqual(assertWorkerDirectMessage(registration), registration);
  assert.throws(
    () => assertWorkerDirectMessage({ ...registration, schemaVersion: 3 }),
    /schema version/,
  );
  assert.throws(
    () => assertWorkerDirectMessage({ ...registration, type: "omp.focus.register" }),
    /type/,
  );
  assert.throws(
    () =>
      assertWorkerDirectMessage({
        ...registration,
        recovery: {
          kind: "tmux",
          marker: "C".repeat(32),
          sessionId: "$0",
          clientName: "/dev/pts/7",
          originalSetTitles: { explicit: true, value: "off" },
          originalTitleString: { explicit: true, value: "original" },
        },
      }),
    /does not match/,
  );
  const acknowledgement = parseWorkerDirectAcknowledgement(
    JSON.stringify({
      schemaVersion: 4,
      status: "accepted",
      requestId: "focus-register-1",
      recovery: { kind: "herdr", marker: "C".repeat(32) },
      workerGeneration: "W".repeat(32),
    }),
  );
  if (acknowledgement.status !== "accepted") throw new Error("expected accepted acknowledgement");
  assert.equal(acknowledgement.recovery?.kind, "herdr");
  assert.equal(acknowledgement.workerGeneration, "W".repeat(32));
});

test("session heartbeat protocol and monotonic lease capacity are exact", () => {
  const heartbeat = {
    schemaVersion: 4,
    type: "omp.session-heartbeat",
    requestId: "heartbeat-1",
    sessionId: "session-live",
  };
  assert.deepEqual(assertWorkerDirectMessage(heartbeat), heartbeat);
  assert.throws(
    () => assertWorkerDirectMessage({ ...heartbeat, extra: true }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      assertWorkerDirectMessage({
        ...heartbeat,
        sessionId: "/home/operator/private-session.jsonl",
      }),
    /filesystem path/,
  );

  let monotonicNow = 0;
  const liveness = new OmpSessionLiveness({
    monotonicNow: () => monotonicNow,
    reconnectGraceMilliseconds: 50,
    leaseMilliseconds: 100,
    maximumSessions: 2,
  });
  assert.deepEqual(liveness.seed(["session-live", "session-dead", "session-overflow"]), [
    "session-overflow",
  ]);
  monotonicNow = 49;
  liveness.observe("session-live");
  monotonicNow = 50;
  const expired = liveness.expired();
  assert.deepEqual(
    expired.map((entry) => entry.sessionId),
    ["session-dead"],
  );
  liveness.commitExpired(expired);
  assert.equal(liveness.size, 1);
  monotonicNow = 148;
  assert.deepEqual(liveness.expired(), []);
  monotonicNow = 149;
  assert.deepEqual(
    liveness.expired().map((entry) => entry.sessionId),
    ["session-live"],
  );
  liveness.observe("session-third");
  assert.throws(() => liveness.observe("session-fourth"), OmpSessionCapacityError);
});

test("live restored sessions survive grace while dead sessions expire causally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-session-lease-"));
  let wallNow = Date.parse(occurredAt);
  const initial = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => wallNow,
  });
  await initial.engine.handleOmpAttention(directEvent());

  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => wallNow,
  });
  let monotonicNow = 0;
  const liveness = new OmpSessionLiveness({
    monotonicNow: () => monotonicNow,
    reconnectGraceMilliseconds: 10,
    leaseMilliseconds: 20,
    maximumSessions: 2,
  });
  assert.deepEqual(liveness.seed(restored.engine.activeOmpSessionIds()), []);
  const statePath = path.join(root, "omp-direct-state.json");
  const beforeHeartbeat = await readFile(statePath, "utf8");
  monotonicNow = 9;
  liveness.observe(sessionId);
  assert.equal(await readFile(statePath, "utf8"), beforeHeartbeat);

  monotonicNow = 11;
  assert.deepEqual(liveness.expired(), []);
  assert.equal(restored.engine.snapshot().view.now?.title, directEvent().title);

  monotonicNow = 30;
  const expired = liveness.expired();
  wallNow += 30_000;
  assert.equal(
    await restored.engine.expireOmpSessions(
      expired.map((entry) => entry.sessionId),
      new Date(wallNow).toISOString(),
    ),
    true,
  );
  liveness.commitExpired(expired);
  assert.equal(restored.engine.snapshot().view.now, null);
  assert.equal(liveness.size, 0);

  await restored.engine.handleOmpAttention(directEvent());
  assert.equal(restored.engine.snapshot().view.now, null);
  const replayed = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => wallNow,
  });
  assert.equal(replayed.engine.snapshot().view.now, null);
});

test("public surface rejects private focus navigation", () => {
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
  assert.throws(() =>
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
    }),
  );
  assert.doesNotThrow(() =>
    assertApertureSurfaceMessage({
      type: "snapshot",
      sequence: 1,
      sources: [{ kind: "omp", label: "OMP" }],
      totals: { now: 1, next: 0, ambient: 0, sources: 2 },
      view: { now: frame, next: [], ambient: [] },
    }),
  );
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

test("direct persistence failures preserve request resolution shutdown and compaction state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-transaction-"));
  let failStorage = false;
  const inMemorySave = async (
    _rootDir: string,
    state: OmpDirectPersistedState,
    _now = Date.now(),
    signal?: AbortSignal,
  ): Promise<OmpDirectPersistedState> => {
    signal?.throwIfAborted();
    if (failStorage) throw new Error("injected storage failure");
    return structuredClone(state);
  };
  const restored = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
    saveDirectState: inMemorySave,
  });
  const request = directEvent({ eventId: "transaction-request" });

  failStorage = true;
  await assert.rejects(
    () => restored.engine.handleOmpAttention(request),
    /injected storage failure/,
  );
  assert.equal(restored.engine.snapshot().view.now, null);

  failStorage = false;
  await restored.engine.handleOmpAttention(request, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  assert.equal(restored.engine.snapshot().view.now?.title, request.title);

  failStorage = true;
  const resolution = directEvent({
    eventId: "transaction-resolution",
    occurredAt: "2026-09-01T16:00:01.000Z",
    classification: "approval_resolved",
    title: "OMP approval resolved",
    summary: "OMP resumed after operator approval.",
    transition: "resolved",
    focus: undefined,
  });
  await assert.rejects(
    () => restored.engine.handleOmpAttention(resolution),
    /injected storage failure/,
  );
  assert.equal(restored.engine.snapshot().view.now?.title, request.title);
  assert.deepEqual(restored.engine.snapshot().view.now?.navigation, {
    kind: "opaque-focus",
    handle: focusHandle,
  });

  const shutdown = directEvent({
    eventId: "transaction-shutdown",
    occurredAt: "2026-09-01T16:00:02.000Z",
    interactionId: undefined,
    classification: "session_shutdown",
    title: "OMP session shut down",
    summary: "OMP closed the originating agent session.",
    transition: "shutdown",
    focus: undefined,
  });
  await assert.rejects(
    () => restored.engine.handleOmpAttention(shutdown),
    /injected storage failure/,
  );
  assert.equal(restored.engine.snapshot().view.now?.title, request.title);

  let clock = Date.parse(occurredAt);
  let failCompaction = false;
  const compacting = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: await mkdtemp(path.join(os.tmpdir(), "aperture-omp-compaction-")),
    now: () => clock,
    saveDirectState: async (_rootDir, state, now, signal) => {
      signal?.throwIfAborted();
      const bounded = pruneOmpDirectState(state, now);
      if (failCompaction && ompDirectRecordCount(bounded) !== ompDirectRecordCount(state)) {
        throw new Error("injected compaction failure");
      }
      return structuredClone(bounded);
    },
  });
  await compacting.engine.handleOmpAttention(request);
  clock += 25 * 60 * 60 * 1000;
  failCompaction = true;
  await assert.rejects(
    () =>
      compacting.engine.handleOmpAttention(
        directEvent({
          eventId: "transaction-after-cutoff",
          occurredAt: new Date(clock).toISOString(),
          interactionId: "transaction-after-cutoff",
        }),
      ),
    /injected compaction failure/,
  );
  assert.equal(compacting.engine.snapshot().view.now?.title, request.title);
});

test("resolution and shutdown tombstones dominate delayed replay", async () => {
  for (const family of ["approval", "input"] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `aperture-omp-${family}-causal-`));
    const resolutionTime = "2026-09-01T16:00:01.000Z";
    const request = directEvent({
      eventId: `${family}-request`,
      interactionId: `${family}-interaction`,
      classification: family === "approval" ? "approval_requested" : "input_requested",
      transition: "requested",
      title: `OMP needs ${family}`,
    });
    const resolution = directEvent({
      eventId: `${family}-resolution`,
      occurredAt: resolutionTime,
      interactionId: `${family}-interaction`,
      classification: family === "approval" ? "approval_resolved" : "input_resolved",
      transition: "resolved",
      title: `OMP resolved ${family}`,
      focus: undefined,
    });
    const restored = await NotificationWorkerEngine.restore({
      identities: [identity],
      stateDir: root,
      now: () => Date.parse(resolutionTime),
    });
    await restored.engine.handleOmpAttention(resolution);
    await restored.engine.handleOmpAttention(request, {
      kind: "opaque-focus",
      handle: focusHandle,
    });
    assert.equal(restored.engine.snapshot().view.now, null);
    assert.deepEqual(restored.engine.snapshot().view.next, []);

    const replayed = await NotificationWorkerEngine.restore({
      identities: [identity],
      stateDir: root,
      now: () => Date.parse(resolutionTime),
    });
    await replayed.engine.handleOmpAttention(request, {
      kind: "opaque-focus",
      handle: focusHandle,
    });
    assert.equal(replayed.engine.snapshot().view.now, null);
    assert.deepEqual(replayed.engine.snapshot().view.next, []);
  }

  const shutdownRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-shutdown-causal-"));
  const shutdownTime = "2026-09-01T16:00:03.000Z";
  const shutdown = directEvent({
    eventId: "session-shutdown",
    occurredAt: shutdownTime,
    classification: "session_shutdown",
    transition: "shutdown",
    focus: undefined,
  });
  const shutdownEngine = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: shutdownRoot,
    now: () => Date.parse(shutdownTime),
  });
  await shutdownEngine.engine.handleOmpAttention(shutdown);
  await shutdownEngine.engine.handleOmpAttention(directEvent(), {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  assert.equal(shutdownEngine.engine.snapshot().view.now, null);
  assert.deepEqual(shutdownEngine.engine.snapshot().view.next, []);
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

test("v1 direct state migrates atomically to causal v3 and rejects rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-v1-migration-"));
  const original = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  await original.engine.handleOmpAttention(directEvent());
  const statePath = path.join(root, "omp-direct-state.json");
  const v2 = JSON.parse(await readFile(statePath, "utf8")) as {
    active: Array<Record<string, unknown> & { sessionId: string }>;
  };
  const v1 = {
    schemaVersion: 1,
    active: v2.active.map(({ sessionId: legacySessionId, ...entry }) => ({
      ...entry,
      navigation: { kind: "omp-session", sessionId: legacySessionId },
    })),
  };
  await writeFile(statePath, `${JSON.stringify(v1)}\n`, { mode: 0o600 });

  const migrated = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  assert.equal(migrated.recoveredCorruptState, false);
  assert.equal(migrated.engine.snapshot().view.now?.title, directEvent().title);
  assert.equal(migrated.engine.snapshot().view.now?.navigation, undefined);
  const canonical = await readFile(statePath, "utf8");
  assert.match(canonical, /"schemaVersion":3/);
  assert.doesNotMatch(canonical, /navigation|focusHandle|marker|socketPath|compositor/);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);

  await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  assert.equal(await readFile(statePath, "utf8"), canonical);
  assert.throws(
    () => migrateOmpDirectStateV1(JSON.parse(canonical)),
    /state fields|v1 state schema/,
  );

  const malformed = {
    ...v1,
    active: v1.active.map((entry) => ({
      ...entry,
      navigation: { ...entry.navigation, marker: "private" },
    })),
  };
  await writeFile(statePath, `${JSON.stringify(malformed)}\n`, { mode: 0o600 });
  const recovered = await NotificationWorkerEngine.restore({
    identities: [identity],
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  assert.equal(recovered.recoveredCorruptState, true);
  assert.equal(recovered.engine.snapshot().view.now, null);
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
  const registrationEvents = new EventEmitter();
  const registrationStarted = once(registrationEvents, "started");
  let releaseRegistration!: () => void;
  const registrationGate = new Promise<void>((resolve) => {
    releaseRegistration = resolve;
  });
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async (event) => {
      received.push(event);
    },
    registerFocus: async () => {
      registrationEvents.emit("started");
      await registrationGate;
      return { kind: "herdr", marker: "C".repeat(32) };
    },
    revokeFocus: () => undefined,
  });
  const socketMetadata = await lstat(socketPath);
  assert.equal(socketMetadata.isSocket(), true);
  assert.equal(socketMetadata.mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);
  assert.throws(() => assertOwnedSocketMetadata(socketMetadata, socketMetadata.uid + 1), /owner/);

  const client = new OmpDirectWorkerTransport({ socketPath });
  await client.send(directEvent());
  const pendingRegistration = client.registerFocus({
    schemaVersion: 4,
    type: "focus.register",
    requestId: "slow-register",
    publicHandle: "A".repeat(32),
    hostGeneration: "B".repeat(32),
    target: {
      kind: "herdr",
      socketPath: "/run/user/1000/herdr.sock",
      paneId: "w2:p1",
      hyprlandInstance: "instance_1",
    },
  });
  await registrationStarted;
  releaseRegistration();
  await pendingRegistration;
  assert.equal(received.length, 1);
  assert.match(await sendRaw(socketPath, "{\n"), /rejected/);
  assert.match(
    await sendRaw(socketPath, `${"x".repeat(OMP_ATTENTION_LIMITS.jsonLineBytes)}\n`),
    /rejected/,
  );

  await server.close();
  await assert.rejects(() => lstat(socketPath), /ENOENT/);
});

test("direct server rejects client cap plus one and closes bounded state", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-direct-client-cap-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const server = await startOmpAttentionSocketServer({
    socketPath,
    maximumClients: 1,
    handleAttention: async () => undefined,
    registerFocus: async () => undefined,
    revokeFocus: async () => undefined,
  });
  const held = createConnection({ path: socketPath });
  held.on("error", () => undefined);
  await once(held, "connect");
  const overflow = createConnection({ path: socketPath });
  overflow.on("error", () => undefined);
  await once(overflow, "close");
  assert.equal(held.destroyed, false);
  const heldClosed = once(held, "close");
  await server.close();
  await heldClosed;
  assert.equal(held.destroyed, true);
  await assert.rejects(() => lstat(socketPath), /ENOENT/);
});

test("read timeout rejection is terminal for a half-open client", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-direct-read-timeout-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  let handlerCalls = 0;
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async () => {
      handlerCalls += 1;
    },
    registerFocus: async () => {
      handlerCalls += 1;
      return undefined;
    },
    revokeFocus: async () => {
      handlerCalls += 1;
    },
  });
  const client = createConnection({ path: socketPath, allowHalfOpen: true });
  client.on("error", () => undefined);
  const connected = once(client, "connect");
  const response = once(client, "data");
  const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
  await connected;
  const [chunk] = await response;
  assert.match(String(chunk), /"status":"rejected"/);
  client.write(`${JSON.stringify(directEvent())}\n`);
  await closed;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(handlerCalls, 0);
  assert.equal(client.destroyed, true);
  await server.close();
});

test("direct attention deadlines reject before commit and receipts stay terminal", async () => {
  for (const processingMilliseconds of [150, 250]) {
    const runtimeRoot = await mkdtemp("/tmp/ap-direct-receipt-timing-");
    const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
    let commits = 0;
    const server = await startOmpAttentionSocketServer({
      socketPath,
      handleAttention: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, processingMilliseconds));
        commits += 1;
      },
      registerFocus: async () => undefined,
      revokeFocus: async () => undefined,
    });
    const client = new OmpDirectWorkerTransport({ socketPath });
    assert.equal((await client.send(directEvent())).status, "accepted");
    assert.equal(commits, 1);
    await server.close();
  }

  const runtimeRoot = await mkdtemp("/tmp/ap-direct-processing-deadline-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  let calls = 0;
  let commits = 0;
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async (_event, signal) => {
      calls += 1;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 750);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
      commits += 1;
    },
    registerFocus: async () => undefined,
    revokeFocus: async () => undefined,
  });
  const client = new OmpDirectWorkerTransport({ socketPath });
  const event = { ...directEvent(), eventId: "deadline-event" };
  const startedAt = Date.now();
  const timedOut = (error: unknown) =>
    error instanceof Error &&
    error.name === "WorkerDirectRejectedError" &&
    (error as Error & { code?: unknown }).code === "processing_timeout";
  await assert.rejects(() => client.send(event), timedOut);
  assert(Date.now() - startedAt < 700);
  assert.equal(commits, 0);
  await assert.rejects(() => client.send(event), timedOut);
  assert.equal(calls, 1);
  assert.equal(commits, 0);
  await server.close();
});

test("post-write timeout and lost acknowledgement reuse one durable receipt", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-direct-receipt-retry-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const events = new EventEmitter();
  let commits = 0;
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      commits += 1;
      events.emit("committed");
    },
    registerFocus: async () => undefined,
    revokeFocus: async () => undefined,
  });
  const event = directEvent();
  const client = new OmpDirectWorkerTransport({ socketPath });
  await assert.rejects(
    () => client.send(event, 100),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "OmpDirectDeliveryError" &&
      (error as Error & { disposition?: unknown }).disposition === "acceptance-unknown",
  );
  const retry = await client.send(event, 1_000);
  assert.equal(retry.status, "accepted");
  assert.equal(commits, 1);

  const lostEvent = { ...directEvent(), eventId: "approval-event-ack-lost" };
  const committed = once(events, "committed");
  const lostClient = createConnection({ path: socketPath });
  lostClient.on("error", () => undefined);
  await once(lostClient, "connect");
  lostClient.write(`${JSON.stringify(lostEvent)}\n`, () => lostClient.destroy());
  await committed;
  const recovered = await client.send(lostEvent, 1_000);
  assert.equal(recovered.status, "accepted");
  assert.equal(commits, 2);
  await server.close();
});

test("pending direct receipts enforce capacity and settled receipts evict", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-direct-receipt-cap-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const events = new EventEmitter();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let commits = 0;
  const server = await startOmpAttentionSocketServer({
    socketPath,
    maximumReceipts: 1,
    handleAttention: async (event) => {
      if (event.eventId === "receipt-one") {
        events.emit("started");
        await gate;
      }
      commits += 1;
    },
    registerFocus: async () => undefined,
    revokeFocus: async () => undefined,
  });
  const client = new OmpDirectWorkerTransport({ socketPath });
  const started = once(events, "started");
  const first = client.send({ ...directEvent(), eventId: "receipt-one" });
  await started;
  await assert.rejects(
    () => client.send({ ...directEvent(), eventId: "receipt-overflow" }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "WorkerDirectRejectedError" &&
      (error as Error & { code?: unknown }).code === "capacity",
  );
  release();
  assert.equal((await first).status, "accepted");
  assert.equal(
    (await client.send({ ...directEvent(), eventId: "receipt-after-eviction" })).status,
    "accepted",
  );
  assert.equal(commits, 2);
  await server.close();
});

test("direct server aborts a stalled focus operation during shutdown", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-direct-stalled-shutdown-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const events = new EventEmitter();
  let aborted = false;
  const server = await startOmpAttentionSocketServer({
    socketPath,
    handleAttention: async () => undefined,
    registerFocus: async (_registration, signal) =>
      new Promise<undefined>((_resolve, reject) => {
        events.emit("started");
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
    revokeFocus: async () => undefined,
  });
  const client = new OmpDirectWorkerTransport({ socketPath });
  const started = once(events, "started");
  const pending = client.registerFocus({
    schemaVersion: 4,
    type: "focus.register",
    requestId: "stalled-register",
    publicHandle: "A".repeat(32),
    hostGeneration: "B".repeat(32),
    target: {
      kind: "herdr",
      socketPath: "/run/user/1000/herdr.sock",
      paneId: "w2:p1",
      hyprlandInstance: "instance_1",
    },
  });
  const rejected = assert.rejects(pending);
  await started;
  await server.close();
  await rejected;
  assert.equal(aborted, true);
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
    packageVersion: "0.10.0",
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

test("OMP-only worker rejects generic notifications and removes only regular legacy state", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-only-worker-");
  const stateDir = path.join(runtimeRoot, "state");
  await mkdir(stateDir, { mode: 0o700 });
  await writeFile(path.join(stateDir, "state.json"), "legacy-notification-state\n", {
    mode: 0o600,
  });
  const input = new PassThrough();
  const messages: Array<Record<string, unknown>> = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      messages.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      callback();
    },
  });
  const running = runNotificationWorkerStdio({
    packageVersion: "0.10.0",
    identities: [identity],
    stateDir,
    mode: "omp-only",
    input,
    output,
  });
  input.end(
    `${JSON.stringify(notificationInput("generic notification must remain disabled"))}\n${JSON.stringify(
      { type: "shutdown" },
    )}\n`,
  );
  await running;
  const hello = messages.find((message) => message.type === "hello");
  assert.deepEqual(hello?.capabilities, {
    notificationInput: false,
    ompDirectInput: true,
    snapshots: true,
    responses: false,
    focusActivation: true,
  });
  assert.equal(
    messages.some(
      (message) =>
        message.type === "error" &&
        message.code === "invalid_input" &&
        String(message.message).includes("disabled in OMP-only mode"),
    ),
    true,
  );
  assert.equal(
    messages
      .filter((message) => message.type === "snapshot")
      .every((message) => {
        const totals = message.totals;
        return Boolean(
          totals && typeof totals === "object" && "ambient" in totals && totals.ambient === 0,
        );
      }),
    true,
  );
  await assert.rejects(() => lstat(path.join(stateDir, "state.json")), /ENOENT/);

  const unsafeRoot = await mkdtemp("/tmp/ap-omp-only-state-link-");
  const unsafeStateDir = path.join(unsafeRoot, "state");
  const externalState = path.join(unsafeRoot, "external-state");
  await mkdir(unsafeStateDir, { mode: 0o700 });
  await writeFile(externalState, "must-survive\n", { mode: 0o600 });
  await symlink(externalState, path.join(unsafeStateDir, "state.json"));
  const unsafeInput = new PassThrough();
  unsafeInput.end(`${JSON.stringify({ type: "shutdown" })}\n`);
  const discardedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  await assert.rejects(
    () =>
      runNotificationWorkerStdio({
        packageVersion: "0.10.0",
        identities: [identity],
        stateDir: unsafeStateDir,
        mode: "omp-only",
        input: unsafeInput,
        output: discardedOutput,
      }),
    /not an owned regular file/,
  );
  assert.equal(await readFile(externalState, "utf8"), "must-survive\n");
});

test("worker closes a published socket when readiness output fails", async () => {
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-worker-ready-failure-");
  const stateDir = path.join(runtimeRoot, "state");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const input = new PassThrough();
  let outputCount = 0;
  let markReadyWrite!: () => void;
  let releaseReadyWrite!: () => void;
  const readyWrite = new Promise<void>((resolve) => {
    markReadyWrite = resolve;
  });
  const readyWriteCanFail = new Promise<void>((resolve) => {
    releaseReadyWrite = resolve;
  });
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      outputCount += 1;
      if (outputCount !== 3) {
        callback();
        return;
      }
      markReadyWrite();
      void readyWriteCanFail.then(() => callback(new Error("ready output failed")));
    },
  });
  output.on("error", () => undefined);
  const running = runNotificationWorkerStdio({
    packageVersion: "0.10.0",
    identities: [identity],
    stateDir,
    socketPath,
    input,
    output,
  });
  await readyWrite;
  assert.equal((await lstat(socketPath)).isSocket(), true);
  releaseReadyWrite();
  await assert.rejects(running, /ready output failed/);
  await assert.rejects(() => lstat(socketPath), /ENOENT/);
});

test("socket startup rejects unsafe paths and recovers an inactive owned socket", async () => {
  const uid = process.getuid!();
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-safety-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(path.join(runtimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(socketPath), 0o700);
  const target = path.join(runtimeRoot, "target");
  await writeFile(target, "not a socket", "utf8");
  await symlink(target, socketPath);
  await assert.rejects(() => listenOnOwnedSocket(createServer(), socketPath, uid), /symlink/);

  const fileRuntimeRoot = await mkdtemp("/tmp/ap-omp-file-");
  const filePath = path.join(fileRuntimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.join(fileRuntimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(filePath), 0o700);
  await writeFile(filePath, "unsafe replacement", "utf8");
  await assert.rejects(() => listenOnOwnedSocket(createServer(), filePath, uid), /not a socket/);

  const staleRuntimeRoot = await mkdtemp("/tmp/ap-omp-stale-");
  const stalePath = path.join(staleRuntimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(stalePath), { recursive: true, mode: 0o700 });
  await chmod(path.join(staleRuntimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(stalePath), 0o700);
  const staleProcess = spawn(
    process.execPath,
    [
      "-e",
      "const net=require('node:net');const server=net.createServer();" +
        "server.listen(process.argv[1],()=>process.stdout.write('ready\\n'));" +
        "setInterval(()=>{},1000)",
      stalePath,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await once(staleProcess.stdout!, "data");
  staleProcess.kill("SIGKILL");
  await once(staleProcess, "exit");
  assert.equal((await lstat(stalePath)).isSocket(), true);

  const replacementServer = createServer();
  const replacementIdentity = await listenOnOwnedSocket(
    replacementServer,
    stalePath,
    uid,
    async () => false,
  );
  assert.equal((await lstat(stalePath)).isSocket(), true);
  await closeOwnedSocketServer(replacementServer, stalePath, uid, replacementIdentity, 1_500);
  await assert.rejects(() => lstat(stalePath), /ENOENT/);
});

test("owned socket cleanup distinguishes absent, stale, active, replaced, and unsafe paths", async () => {
  const uid = process.getuid!();
  const absentRoot = await mkdtemp("/tmp/ap-omp-cleanup-absent-");
  const absentPath = path.join(absentRoot, "omarchy", "aperture", "attention.sock");
  assert.equal(await cleanupOwnedSocket(absentPath, uid), "absent");

  const staleRoot = await mkdtemp("/tmp/ap-omp-cleanup-stale-");
  const stalePath = path.join(staleRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(stalePath), { recursive: true, mode: 0o700 });
  const staleServer = createServer();
  staleServer.listen(stalePath);
  await once(staleServer, "listening");
  assert.equal(await cleanupOwnedSocket(stalePath, uid, async () => false), "removed");
  staleServer.close();
  await once(staleServer, "close");

  const activeRoot = await mkdtemp("/tmp/ap-omp-cleanup-active-");
  const activePath = path.join(activeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(activePath), { recursive: true, mode: 0o700 });
  const activeServer = createServer();
  activeServer.listen(activePath);
  await once(activeServer, "listening");
  let activeElapsed = 0;
  await assert.rejects(
    () =>
      cleanupOwnedSocket(activePath, uid, async () => true, {
        now: () => activeElapsed,
        sleep: async (milliseconds) => {
          activeElapsed += milliseconds;
        },
      }),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 75,
  );
  assert.equal(activeElapsed, OWNED_SOCKET_CLEANUP_DEADLINE_MS);
  activeServer.close();
  await once(activeServer, "close");

  const retryRoot = await mkdtemp("/tmp/ap-omp-cleanup-retry-");
  const retryPath = path.join(retryRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(retryPath), { recursive: true, mode: 0o700 });
  const retryServer = createServer();
  retryServer.listen(retryPath);
  await once(retryServer, "listening");
  let retryElapsed = 0;
  let probeCount = 0;
  assert.equal(
    await cleanupOwnedSocket(
      retryPath,
      uid,
      async () => {
        probeCount += 1;
        return probeCount === 1;
      },
      {
        now: () => retryElapsed,
        sleep: async (milliseconds) => {
          retryElapsed += milliseconds;
        },
      },
    ),
    "removed",
  );
  assert.equal(retryElapsed, 50);
  retryServer.close();
  await once(retryServer, "close");

  const replacedRoot = await mkdtemp("/tmp/ap-omp-cleanup-replaced-");
  const replacedPath = path.join(replacedRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(replacedPath), { recursive: true, mode: 0o700 });
  const replacedServer = createServer();
  replacedServer.listen(replacedPath);
  await once(replacedServer, "listening");
  let replacedElapsed = 0;
  await assert.rejects(
    () =>
      cleanupOwnedSocket(
        replacedPath,
        uid,
        async () => {
          await unlink(replacedPath);
          await writeFile(replacedPath, "replacement", "utf8");
          return false;
        },
        {
          now: () => replacedElapsed,
          sleep: async (milliseconds) => {
            replacedElapsed += milliseconds;
          },
        },
      ),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 75,
  );
  assert.equal(replacedElapsed, OWNED_SOCKET_CLEANUP_DEADLINE_MS);
  replacedServer.close();
  await once(replacedServer, "close");

  const unsafeRoot = await mkdtemp("/tmp/ap-omp-cleanup-unsafe-");
  const unsafePath = path.join(unsafeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(unsafePath), { recursive: true, mode: 0o700 });
  await writeFile(unsafePath, "not a socket", "utf8");
  await assert.rejects(
    () => cleanupOwnedSocket(unsafePath, uid),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 74,
  );
  const symlinkRoot = await mkdtemp("/tmp/ap-omp-cleanup-symlink-");
  const symlinkPath = path.join(symlinkRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(symlinkPath), { recursive: true, mode: 0o700 });
  await symlink(unsafePath, symlinkPath);
  await assert.rejects(
    () => cleanupOwnedSocket(symlinkPath, uid),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 74,
  );
  const parentSymlinkRoot = await mkdtemp("/tmp/ap-omp-cleanup-parent-link-");
  const parentSymlinkTarget = await mkdtemp("/tmp/ap-omp-cleanup-parent-target-");
  await mkdir(path.join(parentSymlinkTarget, "aperture"), { recursive: true, mode: 0o700 });
  await symlink(parentSymlinkTarget, path.join(parentSymlinkRoot, "omarchy"));
  await assert.rejects(
    () =>
      cleanupOwnedSocket(
        path.join(parentSymlinkRoot, "omarchy", "aperture", "attention.sock"),
        uid,
      ),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 74,
  );

  const foreignRoot = await mkdtemp("/tmp/ap-omp-cleanup-foreign-");
  const foreignPath = path.join(foreignRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(foreignPath), { recursive: true, mode: 0o700 });
  const foreignServer = createServer();
  foreignServer.listen(foreignPath);
  await once(foreignServer, "listening");
  await assert.rejects(
    () => cleanupOwnedSocket(foreignPath, uid + 1, async () => false),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 74,
  );
  foreignServer.close();
  await once(foreignServer, "close");
});

test("cleanup serializes a cooperating socket replacement", async () => {
  const uid = process.getuid!();
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-cleanup-lock-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(path.join(runtimeRoot, "omarchy"), 0o700);
  await chmod(path.dirname(socketPath), 0o700);
  const staleProcess = spawn(
    process.execPath,
    [
      "-e",
      "const net=require('node:net');const server=net.createServer();" +
        "server.listen(process.argv[1],()=>process.stdout.write('ready\\n'));" +
        "setInterval(()=>{},1000)",
      socketPath,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await once(staleProcess.stdout!, "data");
  staleProcess.kill("SIGKILL");
  await once(staleProcess, "exit");

  let releaseProbe!: () => void;
  let markProbeEntered!: () => void;
  const probeEntered = new Promise<void>((resolve) => {
    markProbeEntered = resolve;
  });
  const probeCanFinish = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  const cleanup = cleanupOwnedSocket(socketPath, uid, async () => {
    markProbeEntered();
    await probeCanFinish;
    return false;
  });
  await probeEntered;

  const replacementServer = createServer();
  let replacementStarted = false;
  const replacement = listenOnOwnedSocket(
    replacementServer,
    socketPath,
    uid,
    async () => false,
  ).then((replacementSocketIdentity) => {
    replacementStarted = true;
    return replacementSocketIdentity;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replacementStarted, false);

  releaseProbe();
  assert.equal(await cleanup, "removed");
  const replacementIdentity = await replacement;
  assert.equal(replacementStarted, true);
  assert.equal((await lstat(socketPath)).isSocket(), true);
  await closeOwnedSocketServer(replacementServer, socketPath, uid, replacementIdentity, 1_500);
  await assert.rejects(
    () => lstat(path.join(path.dirname(socketPath), ".attention.sock.lifecycle.lock")),
    /ENOENT/,
  );
});

test("cleanup recovers the hard-link lock publication crash window", async () => {
  const uid = process.getuid!();
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-cleanup-lock-crash-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const socketDirectory = path.dirname(socketPath);
  await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
  await chmod(path.join(runtimeRoot, "omarchy"), 0o700);
  await chmod(socketDirectory, 0o700);
  const deadPid = 2_147_483_647;
  const token = "A".repeat(24);
  const ownerPath = path.join(
    socketDirectory,
    `.attention.sock.lifecycle.owner-${deadPid}-${token}`,
  );
  const lockPath = path.join(socketDirectory, ".attention.sock.lifecycle.lock");
  await writeFile(ownerPath, `${JSON.stringify({ pid: deadPid, token })}\n`, {
    mode: 0o600,
  });
  await chmod(ownerPath, 0o600);
  await link(ownerPath, lockPath);
  assert.equal((await lstat(lockPath)).nlink, 2);

  assert.equal(await cleanupOwnedSocket(socketPath, uid), "absent");
  await assert.rejects(() => lstat(ownerPath), /ENOENT/);
  await assert.rejects(() => lstat(lockPath), /ENOENT/);
});

test("cleanup retains a socket when its activity probe is inconclusive", async () => {
  const uid = process.getuid!();
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-cleanup-inconclusive-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  const server = createServer();
  const identityBefore = await listenOnOwnedSocket(server, socketPath, uid);

  await assert.rejects(
    () => cleanupOwnedSocket(socketPath, uid, () => new Promise<boolean>(() => undefined)),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 75,
  );
  const identityAfter = await lstat(socketPath);
  assert.equal(identityAfter.dev, identityBefore.dev);
  assert.equal(identityAfter.ino, identityBefore.ino);
  await closeOwnedSocketServer(server, socketPath, uid, identityBefore, 1_500);
});

test("cleanup rejects non-private socket directories", async () => {
  const uid = process.getuid!();
  const runtimeRoot = await mkdtemp("/tmp/ap-omp-cleanup-mode-");
  const socketPath = path.join(runtimeRoot, "omarchy", "aperture", "attention.sock");
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(path.join(runtimeRoot, "omarchy"), 0o755);
  await assert.rejects(
    () => cleanupOwnedSocket(socketPath, uid),
    (error: unknown) => error instanceof OwnedSocketCleanupError && error.exitCode === 74,
  );
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
