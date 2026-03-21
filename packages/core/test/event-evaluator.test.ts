import test from "node:test";
import assert from "node:assert/strict";

import { EventEvaluator } from "../src/event-evaluator.js";

const evaluation = new EventEvaluator();

test("task.started becomes a background status candidate", () => {
  const result = evaluation.evaluate({
    id: "evt:start",
    taskId: "task:1",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.started",
    title: "Preparing repository scan",
    summary: "Collecting context.",
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.responseSpec.kind, "none");
});

test("task.updated blocked becomes a focused normal-priority status", () => {
  const result = evaluation.evaluate({
    id: "evt:blocked",
    taskId: "task:1",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "task.updated",
    title: "Blocked on credentials",
    summary: "Waiting for operator input.",
    status: "blocked",
    progress: 45,
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.provenance?.whyNow, "Work is blocked and may require operator attention.");
});

test("task.updated failed becomes a critical high-priority status", () => {
  const result = evaluation.evaluate({
    id: "evt:failed",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:00.000Z",
    type: "task.updated",
    title: "Patch application failed",
    summary: "The repository is in a conflicted state.",
    status: "failed",
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
});

test("task.updated semantics enrich provenance without overriding status routing", () => {
  const result = evaluation.evaluate({
    id: "evt:waiting-semantic",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      operatorActionRequired: true,
      requestExplicitness: "implied",
      consequence: "high",
      whyNow: "Waiting for operator approval before continuing.",
      factors: ["task.updated", "waiting", "implied operator ask"],
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "low",
      reasons: ["status text implies an operator ask"],
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.provenance?.whyNow, "Waiting for operator approval before continuing.");
  assert.deepEqual(result.candidate.relationHints?.map((hint) => hint.kind), ["same_issue", "repeats"]);
});

test("approval requests become blocking approval candidates", () => {
  const result = evaluation.evaluate({
    id: "evt:approval",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve workspace write",
    summary: "This change modifies production configuration.",
    request: {
      kind: "approval",
      requireReason: true,
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "approval");
  assert.equal(result.candidate.blocking, true);
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.responseSpec.kind, "approval");
  assert.equal(result.candidate.responseSpec.requireReason, true);
  assert.deepEqual(
    result.candidate.responseSpec.actions.map((action) => action.id),
    ["approve", "reject"],
  );
});

test("low-risk approvals become normal-priority blocking candidates", () => {
  const result = evaluation.evaluate({
    id: "evt:approval:read",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:read",
    title: "Approve read",
    summary: "Read src/index.ts",
    consequence: "low",
    request: {
      kind: "approval",
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "approval");
  assert.equal(result.candidate.blocking, true);
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.consequence, "low");
});

test("completed tasks clear current interaction state", () => {
  const result = evaluation.evaluate({
    id: "evt:complete",
    taskId: "task:1",
    timestamp: "2026-03-08T12:04:00.000Z",
    type: "task.completed",
  });

  assert.deepEqual(result, { kind: "clear", taskId: "task:1" });
});
