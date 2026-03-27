import assert from "node:assert/strict";
import test from "node:test";

import { EventEvaluator } from "../src/event-evaluator.js";
import { readBoundedToolFamily } from "../src/interaction-taxonomy.js";

const evaluation = new EventEvaluator();

test("task.updated keeps status routing authoritative even when semantic fields are richer", () => {
  const result = evaluation.evaluate({
    id: "evt:status-contract",
    taskId: "task:status-contract",
    timestamp: "2026-03-27T17:00:00.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "approval_request",
      activityClass: "question_request",
      consequence: "high",
      whyNow: "Semantic layer thinks this resembles an approval checkpoint.",
      factors: ["task.updated", "waiting", "semantic approval checkpoint"],
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "low",
      reasons: ["diagnostic semantic read"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(result.candidate.relationHints?.map((hint) => hint.kind), ["same_issue", "repeats"]);
  assert.equal(result.candidate.provenance?.whyNow, "Semantic layer thinks this resembles an approval checkpoint.");
});

test("bounded tool-family use stays available for approval requests", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "approval",
      title: "Approve read",
      summary: "Read src/index.ts",
    }),
    "read",
  );
});

test("bounded tool-family use does not apply to explicit question requests", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "choice",
      activityClass: "question_request",
      toolFamily: "read",
      title: "Should we read the config first?",
      summary: "Choose the next step.",
    }),
    null,
  );
});

test("bounded tool-family use still preserves explicit status metadata", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "status",
      activityClass: "tool_completion",
      toolFamily: "read",
      title: "Read completed",
      summary: "Read completed successfully.",
    }),
    "read",
  );
});
