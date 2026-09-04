import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertOmpAttentionEvent, type OmpAttentionEvent } from "../src/omp-attention-event.js";
import { assertWorkerDirectMessage } from "../src/worker-direct-message.js";
import type { NotificationWorkerIdentity } from "../src/notification-worker/adapter.js";
import { NotificationWorkerEngine } from "../src/notification-worker/engine.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const fixtureRoot = path.join(packageRoot, "fixtures", "omp-direct");
const writeMode = process.argv.slice(2).includes("--write");
const occurredAt = "2026-09-01T16:00:00.000Z";
const sessionId = "01a0123456789abcdef";
const focusHandle = "A23456789_-bcdefghijklmnopqrstuv";
const identity: NotificationWorkerIdentity = {
  id: "omp",
  kind: "omp",
  label: "OMP",
  applicationNames: ["aperture-omp"],
};

const approval = event({
  eventId: "fixture:approval:1",
  interactionId: "tool-call-1",
  classification: "approval_requested",
  title: "OMP needs approval for bash",
  summary: "OMP is waiting for an operator decision.",
  transition: "requested",
});
const input = event({
  eventId: "fixture:input:1",
  occurredAt: "2026-09-01T16:00:01.000Z",
  interactionId: "ask-2",
  classification: "input_requested",
  title: "OMP needs your input",
  summary: "OMP is waiting for an operator response.",
  transition: "requested",
});
const approvalResolved = event({
  eventId: "fixture:approval:resolved",
  occurredAt: "2026-09-01T16:00:02.000Z",
  interactionId: "tool-call-1",
  classification: "approval_resolved",
  title: "OMP approval resolved",
  summary: "OMP resumed after operator approval.",
  transition: "resolved",
});
const failure = event({
  eventId: "fixture:failure:1",
  occurredAt: "2026-09-01T16:00:03.000Z",
  interactionId: "tool-failure-3",
  classification: "tool_failure",
  title: "OMP bash failed",
  summary: "OMP reported a terminal tool execution failure.",
  transition: "failed",
});
const completion = event({
  eventId: "fixture:completion:1",
  occurredAt: "2026-09-01T16:00:04.000Z",
  turnId: "4",
  interactionId: "turn:4",
  classification: "turn_completed",
  title: "OMP completed a turn",
  summary: "OMP settled the main agent session.",
  transition: "completed",
});
const status = event({
  eventId: "fixture:status:1",
  occurredAt: "2026-09-01T16:00:05.000Z",
  classification: "status_updated",
  title: "OMP is waiting",
  summary: "OMP is waiting for the authoritative session stop event.",
  transition: "updated",
  status: "waiting",
});
const focusRegistration = assertWorkerDirectMessage({
  schemaVersion: 4,
  type: "focus.register",
  requestId: "fixture-focus-register-1",
  publicHandle: focusHandle,
  hostGeneration: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  target: {
    kind: "herdr",
    socketPath: "/run/user/1000/herdr.sock",
    paneId: "wA:p1",
    hyprlandInstance: "instance_1",
  },
});
const focusDirectFootRegistration = assertWorkerDirectMessage({
  schemaVersion: 4,
  type: "focus.register",
  requestId: "fixture-focus-foot-1",
  publicHandle: focusHandle,
  hostGeneration: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  target: {
    kind: "direct-terminal",
    marker: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    hyprlandInstance: "instance_1",
  },
});
const focusTmuxRegistration = assertWorkerDirectMessage({
  schemaVersion: 4,
  type: "focus.register",
  requestId: "fixture-focus-tmux-1",
  publicHandle: focusHandle,
  hostGeneration: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  target: {
    kind: "tmux",
    socketPath: "/run/user/1000/tmux.sock",
    paneId: "%0",
    hyprlandInstance: "instance_1",
  },
});
const focusActivation = {
  type: "focus.activate",
  requestId: "fixture-focus-activate-1",
  handle: focusHandle,
} as const;
const focusResult = {
  type: "focus.result",
  requestId: "fixture-focus-activate-1",
  result: "focused",
} as const;

const stateRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-fixtures-"));
try {
  const restored = await NotificationWorkerEngine.restoreOmpOnly({
    identities: [identity],
    stateDir: path.join(stateRoot, "direct"),
    now: () => Date.parse(input.occurredAt),
  });
  await restored.engine.handleOmpAttention(approval, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  await restored.engine.handleOmpAttention(input, {
    kind: "opaque-focus",
    handle: focusHandle,
  });
  const nowNext = restored.engine.snapshot();
  await restored.engine.handleOmpAttention(approvalResolved);
  const resolved = restored.engine.snapshot();

  const snapshotFor = async (name: string, directEvent: OmpAttentionEvent) => {
    const instance = await NotificationWorkerEngine.restoreOmpOnly({
      identities: [identity],
      stateDir: path.join(stateRoot, name),
      now: () => Date.parse(directEvent.occurredAt),
    });
    await instance.engine.handleOmpAttention(directEvent, {
      kind: "opaque-focus",
      handle: focusHandle,
    });
    return instance.engine.snapshot();
  };
  const failureSnapshot = await snapshotFor("failure", failure);
  const completionSnapshot = await snapshotFor("completion", completion);
  const statusSnapshot = await snapshotFor("status", status);
  assert.equal(nowNext.view.now?.title, approval.title);
  assert.equal(nowNext.view.next[0]?.title, input.title);
  assert.equal(failureSnapshot.view.now?.title, failure.title);
  assert.equal(completionSnapshot.view.now, null);
  assert.deepEqual(completionSnapshot.view.next, []);
  assert.deepEqual(completionSnapshot.view.ambient, []);
  assert.equal(statusSnapshot.view.ambient[0]?.title, status.title);

  const fixtures = new Map<string, unknown>([
    ["approval-request.json", approval],
    ["input-request.json", input],
    ["failure-event.json", failure],
    ["completion-event.json", completion],
    ["status-event.json", status],
    ["snapshot-now-next.json", nowNext],
    ["snapshot-resolved.json", resolved],
    ["snapshot-failure.json", failureSnapshot],
    ["snapshot-completion.json", completionSnapshot],
    ["focus-registration.json", focusRegistration],
    ["focus-registration-direct-terminal.json", focusDirectFootRegistration],
    ["focus-registration-tmux.json", focusTmuxRegistration],
    ["focus-activation.json", focusActivation],
    ["focus-result.json", focusResult],
    ["snapshot-status.json", statusSnapshot],
  ]);
  await mkdir(fixtureRoot, { recursive: true });
  for (const [name, value] of fixtures) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const destination = path.join(fixtureRoot, name);
    if (writeMode) {
      await writeFile(destination, content, "utf8");
      continue;
    }
    let current = "";
    try {
      current = await readFile(destination, "utf8");
    } catch {
      // A missing fixture is reported by the exact comparison below.
    }
    if (current !== content) throw new Error(`OMP direct fixture is stale: ${name}`);
  }
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}

function event(
  facts: Omit<OmpAttentionEvent, "schemaVersion" | "type" | "occurredAt" | "sessionId"> & {
    occurredAt?: string;
  },
): OmpAttentionEvent {
  const { eventId, occurredAt: eventOccurredAt, ...rest } = facts;
  return assertOmpAttentionEvent({
    schemaVersion: 2,
    type: "omp.attention-event",
    eventId,
    occurredAt: eventOccurredAt ?? occurredAt,
    sessionId,
    focus: { kind: "opaque-focus", handle: focusHandle },
    ...rest,
  });
}
