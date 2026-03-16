import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";

test("global urgent backlog demotes lower-value queued status into ambient", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve agent hire",
    summary: "A hire request needs approval.",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:blocked",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    title: "Additional background context",
    summary: "Supporting status update.",
    status: "blocked",
  });

  core.publish({
    id: "evt:failed",
    taskId: "task:failed",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    title: "Bash failed",
    summary: "The deploy command failed.",
    status: "failed",
  });

  const attentionView = core.getAttentionView();

  assert.equal(attentionView.active?.interactionId, "interaction:approval");
  assert.equal(attentionView.queued.length, 0);
  assert.deepEqual(
    attentionView.ambient.map((frame) => frame.title),
    ["Bash failed", "Additional background context"],
  );
});

test("absent operator keeps blocking requests queued in the shared view", () => {
  const core = new ApertureCore({ operatorPresence: "absent" });

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve agent hire",
    summary: "A hire request needs approval.",
    request: { kind: "approval" },
  });

  const attentionView = core.getAttentionView();

  assert.equal(attentionView.active, null);
  assert.equal(attentionView.queued.length, 1);
  assert.equal(attentionView.queued[0]?.interactionId, "interaction:approval");
});

test("trace reasons explain why lower-priority work is queued", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:trace",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve force push",
    summary: "A force push needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:queued",
    taskId: "task:trace",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:queued",
    title: "Choose fallback path",
    summary: "A fallback path is needed.",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultBucket, "queued");
  assert.match(
    candidateTrace.coordination.reasons.join(" "),
    /current work still outranks the new candidate/,
  );
});

test("trace includes attention pressure for candidate decisions", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:pressure",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:status",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    title: "Background sync",
    summary: "A background sync is still running.",
    status: "running",
    progress: 50,
  });

  core.publish({
    id: "evt:choice",
    taskId: "task:choice",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:choice",
    title: "Choose rollout option",
    summary: "A rollout option is needed.",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.ok(candidateTrace.pressureForecast.score >= 0);
  assert.ok(["low", "rising", "high"].includes(candidateTrace.pressureForecast.overloadRisk));
});

test("related episode updates merge into an existing queued frame instead of adding fragments", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:queued:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fix",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const firstQueued = core.getAttentionView().queued[0];
  assert.ok(firstQueued);
  if (!firstQueued) {
    return;
  }

  core.publish({
    id: "evt:queued:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:b",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fallback",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "fallback", label: "Fallback" }],
    },
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.queued.length, 1);
  assert.equal(core.getTaskView("task:episode:a").queued.length, 0);
  assert.equal(core.getTaskView("task:episode:b").queued.length, 1);
  assert.equal(core.getTaskView("task:episode:b").queued[0]?.id, firstQueued.id);
  assert.equal(core.getTaskView("task:episode:b").queued[0]?.interactionId, "interaction:episode:b");
});

test("queue-worthy episode updates can promote an ambient episode frame into the queue", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:ambient",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync running",
    summary: "config.ts",
    status: "running",
    progress: 25,
  });

  core.publish({
    id: "evt:queue",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed",
    summary: "config.ts",
    status: "failed",
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.queued.length, 1);
  assert.equal(attentionView.ambient.length, 0);
  assert.equal(attentionView.queued[0]?.interactionId, "interaction:task:episode:b:status");
});

test("completed tasks clear ambient-only task state", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:ambient",
    taskId: "task:ambient",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    source: { id: "custom-agent:vps", kind: "custom-agent" },
    title: "Remote approval needed",
    summary: "A remote agent needs a human decision.",
    status: "blocked",
  });

  assert.ok(core.getAttentionView().active);

  core.publish({
    id: "evt:complete",
    taskId: "task:ambient",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.completed",
    summary: "Handled.",
  });

  assert.equal(core.getAttentionView().active, null);
  assert.equal(core.getTaskView("task:ambient").ambient.length, 0);
});

test("same-interaction status updates can demote an active frame into ambient", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:blocked",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    title: "Claude is waiting for follow-up",
    summary: "A follow-up question needs input.",
    status: "blocked",
  });

  assert.equal(core.getAttentionView().active?.title, "Claude is waiting for follow-up");

  core.publish({
    id: "evt:running",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:01.000Z",
    type: "task.updated",
    title: "Read completed",
    summary: "Read completed successfully.",
    status: "running",
  });

  assert.equal(core.getAttentionView().active, null);
  assert.equal(core.getAttentionView().ambient[0]?.title, "Read completed");

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "ambient");
  assert.equal(candidateTrace.coordination.resultBucket, "ambient");
});

test("committed bucket matches queued routing under operator absence", () => {
  const core = new ApertureCore({ operatorPresence: "absent" });
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    request: { kind: "approval" },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultBucket, "queued");
  assert.equal(core.getAttentionView().queued[0]?.interactionId, "interaction:approval");
});

test("committed bucket matches ambient routing for passive status", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:status",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    title: "Read completed",
    summary: "Read completed successfully.",
    toolFamily: "read",
    activityClass: "tool_completion",
    status: "running",
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "ambient");
  assert.equal(candidateTrace.coordination.resultBucket, "ambient");
  assert.equal(core.getAttentionView().active, null);
  assert.equal(core.getAttentionView().ambient[0]?.interactionId, "interaction:task:status:status");
});
