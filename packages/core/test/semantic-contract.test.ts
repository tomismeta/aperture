import assert from "node:assert/strict";
import test from "node:test";

import { EventEvaluator } from "../src/event-evaluator.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { readBoundedToolFamily } from "../src/interaction-taxonomy.js";

const evaluation = new EventEvaluator();
const timestamp = "2026-03-27T17:00:00.000Z";

function candidateShape(candidate: {
  mode: string;
  priority: string;
  tone: string;
  consequence: string;
  blocking: boolean;
  responseSpec: { kind: string };
}) {
  return {
    mode: candidate.mode,
    priority: candidate.priority,
    tone: candidate.tone,
    consequence: candidate.consequence,
    blocking: candidate.blocking,
    responseSpec: candidate.responseSpec.kind,
  };
}

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

test("explanation-only semantic fields do not change task.updated routing", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status-explanation:baseline",
    taskId: "task:status-explanation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const variants = [
    {
      name: "intentFrame",
      semantic: {
        intentFrame: "approval_request" as const,
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "whyNow",
      semantic: {
        whyNow: "Semantic layer thinks this resembles an approval checkpoint.",
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "factors",
      semantic: {
        factors: ["task.updated", "waiting", "diagnostic factor"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "reasons",
      semantic: {
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic reason"],
      },
    },
  ];

  assert.equal(baseline.kind, "candidate");
  if (baseline.kind !== "candidate") {
    return;
  }

  for (const variant of variants) {
    const result = evaluation.evaluate({
      id: `evt:status-explanation:${variant.name}`,
      taskId: "task:status-explanation",
      timestamp,
      type: "task.updated",
      title: "Waiting for approval",
      summary: "Approval required before deploy can continue.",
      status: "waiting",
      semantic: variant.semantic,
    });

    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      continue;
    }

    assert.deepEqual(candidateShape(result.candidate), candidateShape(baseline.candidate));
  }
});

test("relation hints stay continuity-bearing without changing status routing shape", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status-relation:baseline",
    taskId: "task:status-relation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const related = evaluation.evaluate({
    id: "evt:status-relation:related",
    taskId: "task:status-relation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval again",
    summary: "Approval required again before deploy can continue.",
    status: "waiting",
    semantic: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "high",
      reasons: ["diagnostic continuity read"],
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(related.kind, "candidate");
  if (baseline.kind !== "candidate" || related.kind !== "candidate") {
    return;
  }

  assert.deepEqual(candidateShape(related.candidate), candidateShape(baseline.candidate));
  assert.deepEqual(related.candidate.relationHints?.map((hint) => hint.kind), ["same_issue", "repeats"]);
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

test("tool family remains decision-bearing on approvals but explanatory on choice requests", () => {
  const approvalBaseline = normalizeSourceEvent({
    id: "evt:approval-no-tool-family",
    type: "human.input.requested",
    taskId: "task:approval-tool-family",
    interactionId: "interaction:approval-no-tool-family",
    timestamp,
    title: "Approve proposed step",
    summary: "Continue with the proposed action.",
    request: { kind: "approval" },
  });
  const approvalRead = normalizeSourceEvent({
    id: "evt:approval-read-tool-family",
    type: "human.input.requested",
    taskId: "task:approval-tool-family",
    interactionId: "interaction:approval-read-tool-family",
    timestamp,
    title: "Approve proposed step",
    summary: "Continue with the proposed action.",
    toolFamily: "read",
    request: { kind: "approval" },
  });

  assert.equal(approvalBaseline.type, "human.input.requested");
  assert.equal(approvalRead.type, "human.input.requested");
  if (approvalBaseline.type !== "human.input.requested" || approvalRead.type !== "human.input.requested") {
    return;
  }

  assert.equal(approvalBaseline.consequence, "medium");
  assert.equal(approvalRead.consequence, "low");

  const choiceBaseline = normalizeSourceEvent({
    id: "evt:choice-no-tool-family",
    type: "human.input.requested",
    taskId: "task:choice-tool-family",
    interactionId: "interaction:choice-no-tool-family",
    timestamp,
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });
  const choiceRead = normalizeSourceEvent({
    id: "evt:choice-read-tool-family",
    type: "human.input.requested",
    taskId: "task:choice-tool-family",
    interactionId: "interaction:choice-read-tool-family",
    timestamp,
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    toolFamily: "read",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  assert.equal(choiceBaseline.type, "human.input.requested");
  assert.equal(choiceRead.type, "human.input.requested");
  if (choiceBaseline.type !== "human.input.requested" || choiceRead.type !== "human.input.requested") {
    return;
  }

  const evaluatedBaseline = evaluation.evaluate(choiceBaseline);
  const evaluatedRead = evaluation.evaluate(choiceRead);
  assert.equal(evaluatedBaseline.kind, "candidate");
  assert.equal(evaluatedRead.kind, "candidate");
  if (evaluatedBaseline.kind !== "candidate" || evaluatedRead.kind !== "candidate") {
    return;
  }

  assert.deepEqual(candidateShape(evaluatedRead.candidate), candidateShape(evaluatedBaseline.candidate));
  assert.equal(evaluatedRead.candidate.toolFamily, "read");
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
