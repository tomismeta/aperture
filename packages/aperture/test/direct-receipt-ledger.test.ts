import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises, { mkdtemp, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertOmpAttentionEvent, type OmpAttentionEvent } from "../src/omp-attention-event.js";
import {
  DirectAttentionPrecommitError,
  executeDirectMessage,
} from "../src/notification-worker/direct-message-execution.js";
import { DirectReceiptLedger } from "../src/notification-worker/direct-receipt-ledger.js";
import { OmpWorkerEngine } from "../src/notification-worker/omp-engine.js";
import { OmpSessionLiveness } from "../src/notification-worker/session-liveness.js";
import type { WorkerDirectAcknowledgement } from "../src/worker-direct-message.js";

const occurredAt = "2026-09-01T16:00:00.000Z";

function directEvent(eventId = "receipt-event"): OmpAttentionEvent {
  return assertOmpAttentionEvent({
    schemaVersion: 4,
    type: "omp.attention-event",
    eventId,
    occurredAt,
    sessionId: "receipt-session",
    focus: { kind: "opaque-focus", handle: "A".repeat(32) },
    interactionId: "receipt-interaction",
    classification: "approval_requested",
    title: "OMP needs approval",
    summary: "Waiting for an operator decision.",
    transition: "requested",
  });
}

function executionBoundary(
  ledger: DirectReceiptLedger,
  handleAttention: (event: OmpAttentionEvent, signal: AbortSignal) => Promise<void>,
): (event: OmpAttentionEvent) => Promise<WorkerDirectAcknowledgement> {
  const activeOperations = new Set<AbortController>();
  const handlers = {
    handleAttention,
    registerFocus: async () => undefined,
    revokeFocus: async () => undefined,
  };
  return (event) =>
    ledger.execute(event, () =>
      executeDirectMessage(event, handlers, activeOperations, "A".repeat(32)),
    );
}

function assertRejected(acknowledgement: WorkerDirectAcknowledgement, code: string): void {
  assert.equal(acknowledgement.status, "rejected");
  if (acknowledgement.status === "rejected") assert.equal(acknowledgement.code, code);
}

test("a precommit disk failure retries through the production execution boundary exactly once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-receipt-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { engine } = await OmpWorkerEngine.restore({
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  let attempts = 0;
  let commits = 0;
  const deliver = executionBoundary(new DirectReceiptLedger(4), async (event, signal) => {
    attempts += 1;
    await engine.handleOmpAttention(event, undefined, signal);
    commits += 1;
  });
  const event = directEvent();
  const diskFull = t.mock.method(fsPromises, "open", async () => {
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  syncBuiltinESMExports();
  try {
    assertRejected(await deliver(event), "attention_engine_failed");
  } finally {
    diskFull.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(engine.snapshot().view.now ?? null, null);
  await assert.rejects(readFile(path.join(root, "omp-direct-state.json")), { code: "ENOENT" });
  assertRejected(
    await deliver({ ...event, summary: "Different causal content" }),
    "request_identity_conflict",
  );
  const accepted = await deliver(event);
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(await deliver(event), accepted);
  assert.equal(attempts, 2);
  assert.equal(commits, 1);
  const state = JSON.parse(await readFile(path.join(root, "omp-direct-state.json"), "utf8")) as {
    active: Array<{ revisions: unknown[] }>;
  };
  assert.equal(state.active.length, 1);
  assert.equal(state.active[0]?.revisions.length, 1);
});

test("an ambiguous installation failure is retained even when its IO error is transient", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-receipt-ambiguous-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { engine } = await OmpWorkerEngine.restore({
    stateDir: root,
    now: () => Date.parse(occurredAt),
  });
  let attempts = 0;
  const deliver = executionBoundary(new DirectReceiptLedger(4), async (event, signal) => {
    attempts += 1;
    await engine.handleOmpAttention(event, undefined, signal);
  });
  const rename = fs.renameSync;
  const ambiguousRename = t.mock.method(fs, "renameSync", (...args: Parameters<typeof rename>) => {
    rename(...args);
    throw Object.assign(new Error("installation outcome unavailable"), { code: "EIO" });
  });
  syncBuiltinESMExports();
  const event = directEvent();
  let rejected: WorkerDirectAcknowledgement;
  try {
    rejected = await deliver(event);
    assertRejected(rejected, "processing_failed");
  } finally {
    ambiguousRename.mock.restore();
    syncBuiltinESMExports();
  }
  const installed = await readFile(path.join(root, "omp-direct-state.json"), "utf8");
  assert.deepEqual(await deliver(event), rejected);
  assert.equal(attempts, 1);
  assert.equal(await readFile(path.join(root, "omp-direct-state.json"), "utf8"), installed);
});

test("unclassified engine failures remain terminal despite matching the retry wire code", async () => {
  let attempts = 0;
  const deliver = executionBoundary(new DirectReceiptLedger(2), async () => {
    attempts += 1;
    throw new Error("Aperture attention engine failed");
  });
  const event = directEvent();
  const rejected = await deliver(event);
  assertRejected(rejected, "attention_engine_failed");
  assert.deepEqual(await deliver(event), rejected);
  assertRejected(await deliver({ ...event, title: "Conflict" }), "request_identity_conflict");
  assert.equal(attempts, 1);
});

test("in-flight original and recovery attempts deduplicate while conflicts remain terminal", async () => {
  let release!: () => void;
  let pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const deliver = executionBoundary(new DirectReceiptLedger(1), async () => {
    const attempt = ++attempts;
    await pending;
    if (attempt === 1) throw new DirectAttentionPrecommitError(new Error("temporary failure"));
  });
  const event = directEvent();
  const first = deliver(event);
  const duplicate = deliver(event);
  assert.equal(first, duplicate);
  assertRejected(await deliver({ ...event, summary: "Conflict" }), "request_identity_conflict");
  release();
  assertRejected(await first, "attention_engine_failed");
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const retry = deliver(event);
  assert.equal(deliver(event), retry);
  assertRejected(await deliver({ ...event, summary: "Conflict" }), "request_identity_conflict");
  release();
  assert.equal((await retry).status, "accepted");
  assert.equal((await deliver(event)).status, "accepted");
  assert.equal(attempts, 2);
});

test("session capacity rejected before the engine can recover on the same receipt identity", async () => {
  let clock = 0;
  const liveness = new OmpSessionLiveness({
    monotonicNow: () => clock,
    reconnectGraceMilliseconds: 10,
    leaseMilliseconds: 20,
    maximumSessions: 1,
  });
  liveness.observe("other-session");
  let commits = 0;
  const deliver = executionBoundary(new DirectReceiptLedger(1), async (event) => {
    liveness.observe(event.sessionId);
    commits += 1;
  });
  const event = directEvent();
  assertRejected(await deliver(event), "capacity");
  assert.equal(commits, 0);
  clock = 21;
  liveness.commitExpired(liveness.expired());
  assert.equal((await deliver(event)).status, "accepted");
  assert.equal((await deliver(event)).status, "accepted");
  assert.equal(commits, 1);
});

test("receipt eviction skips pending work and the limit rejects excess concurrent identities", async () => {
  const release = new Map<string, () => void>();
  const attempts = new Map<string, number>();
  const deliver = executionBoundary(new DirectReceiptLedger(2), async (event) => {
    attempts.set(event.eventId, (attempts.get(event.eventId) ?? 0) + 1);
    if (event.eventId !== "settled") {
      await new Promise<void>((resolve) => {
        release.set(event.eventId, resolve);
      });
    }
  });
  const first = deliver(directEvent("first"));
  const settled = await deliver(directEvent("settled"));
  assert.equal(settled.status, "accepted");
  assert.deepEqual(await deliver(directEvent("settled")), settled);
  const third = deliver(directEvent("third"));
  assert.equal(deliver(directEvent("first")), first);
  assertRejected(await deliver(directEvent("fourth")), "capacity");
  assert.equal(attempts.has("fourth"), false);
  release.get("first")!();
  release.get("third")!();
  assert.equal((await first).status, "accepted");
  assert.equal((await third).status, "accepted");
  assert.equal((await deliver(directEvent("settled"))).status, "accepted");
  assert.equal(attempts.get("settled"), 2);
  assert.equal(attempts.get("first"), 1);
  assert.equal(attempts.get("third"), 1);
});
