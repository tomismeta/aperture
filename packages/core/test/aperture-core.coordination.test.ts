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
  assert.match(
    candidateTrace.coordination.reasons.join(" "),
    /current work still outranks the new candidate/,
  );
});
