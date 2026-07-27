import test from "node:test";
import assert from "node:assert/strict";

import { buildAttentionClaim } from "../src/attention-claim.js";
import { EventEvaluator } from "../src/event-evaluator.js";
import { normalizePublicEvaluationInput } from "../src/attention-evaluator-input.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";

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
    context: {
      items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Work is blocked and may require operator attention.",
  );
  assert.deepEqual(result.candidate.context, {
    progress: 45,
    items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
  });
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

test("failed-status routine bash observations route as non-interruptive status", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-routine-observation",
      taskId: "task:failed-routine-observation",
      timestamp: "2026-03-08T12:02:15.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.provenance?.whyNow, undefined);
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.equal(
    buildAttentionClaim(result.candidate).judgment?.routineObservationalStatusConflict,
    true,
  );
  assert.equal(
    normalizePublicEvaluationInput({ claim: buildAttentionClaim(result.candidate) }).candidate
      .judgmentInput.routineObservationalStatusConflict,
    true,
  );
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "non_blocking",
    episode: "unknown",
    confidence: "high",
    source: "inferred",
  });
});

test("mixed bash success and terminal failure text keeps failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:mixed-bash-failure",
      taskId: "task:mixed-bash-failure",
      timestamp: "2026-03-08T12:02:20.000Z",
      type: "task.updated",
      title: "bash failure",
      summary:
        "Your command ran successfully and did not produce any output. Traceback follows from the repro step.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("medium-confidence routine bash observations keep failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:medium-confidence-routine-observation",
      taskId: "task:medium-confidence-routine-observation",
      timestamp: "2026-03-08T12:02:25.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
      semanticHints: {
        confidence: "medium",
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("low-consequence failed read observations do not trigger bash status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-read-log-observation",
      taskId: "task:failed-read-log-observation",
      timestamp: "2026-03-08T12:02:28.000Z",
      type: "task.updated",
      title: "read failure",
      summary:
        "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
      status: "failed",
      toolFamily: "read",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
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
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Waiting for operator approval before continuing.",
  );
  assert.deepEqual(
    result.candidate.relationHints?.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
});

test("diagnostic status semantics do not change task.updated routing", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status:baseline",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      factors: ["task.updated", "waiting"],
      relationHints: [],
      confidence: "high",
      reasons: ["baseline semantic read"],
    },
  });

  const diagnosticVariant = evaluation.evaluate({
    id: "evt:status:diagnostic",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      whyNow: "Status text implies the operator may need to respond.",
      factors: ["task.updated", "waiting", "implied operator ask"],
      relationHints: [],
      confidence: "low",
      reasons: ["diagnostic semantic read"],
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(diagnosticVariant.kind, "candidate");
  if (baseline.kind !== "candidate" || diagnosticVariant.kind !== "candidate") {
    return;
  }

  assert.equal(diagnosticVariant.candidate.priority, baseline.candidate.priority);
  assert.equal(diagnosticVariant.candidate.tone, baseline.candidate.tone);
  assert.equal(diagnosticVariant.candidate.consequence, baseline.candidate.consequence);
  assert.equal(diagnosticVariant.candidate.responseSpec.kind, baseline.candidate.responseSpec.kind);
});

test("semantic blocking on waiting statuses lifts status posture without making it a request", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:status:blocking-diagnostic",
      taskId: "task:status:blocking-diagnostic",
      timestamp: "2026-03-08T12:02:35.000Z",
      type: "task.updated",
      title: "Cannot continue until credentials are provided",
      summary: "Work is waiting but cannot proceed until the operator provides credentials.",
      status: "waiting",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.blocking, false);
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "medium",
    blocking: "blocking",
    episode: "unknown",
    confidence: "medium",
    source: "inferred",
  });
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Work is blocked and may require operator attention.",
  );
});

test("request-like semantic hints on running statuses stay status-shaped during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:status:running-approval-hint",
    taskId: "task:status:running-approval-hint",
    timestamp: "2026-03-08T12:02:36.000Z",
    type: "task.updated",
    title: "Approval checkpoint reached",
    summary: "A higher-level source marked this as an approval checkpoint.",
    status: "running",
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "low",
      whyNow: "A higher-level source marked this as an approval checkpoint.",
      factors: ["task.updated", "running", "semantic approval checkpoint"],
      relationHints: [],
      confidence: "high",
      reasons: ["source marked the status as an approval checkpoint"],
      provenance: {
        intentFrame: "hint",
        activityClass: "hint",
        consequence: "hint",
        whyNow: "hint",
        confidence: "hint",
      },
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.blocking, false);
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "approval",
    activity: "decision_request",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "high",
    source: "hinted",
  });
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

test("event provenance whyNow remains authoritative over semantic whyNow on human input", () => {
  const result = evaluation.evaluate({
    id: "evt:approval:provenance",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:provenance",
    title: "Approve deploy",
    summary: "A deploy is waiting for approval.",
    consequence: "medium",
    provenance: {
      whyNow: "Adapter says release train is blocked.",
      factors: ["adapter release gate"],
    },
    semantic: {
      intentFrame: "approval_request",
      whyNow: "Semantic layer inferred a generic approval checkpoint.",
      factors: ["human.input.requested", "approval"],
      relationHints: [],
      confidence: "medium",
      reasons: ["request kind establishes an explicit operator decision point"],
    },
    request: {
      kind: "approval",
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.provenance?.whyNow, "Adapter says release train is blocked.");
  assert.deepEqual(result.candidate.provenance?.factors, [
    "adapter release gate",
    "human.input.requested",
    "approval",
  ]);
});

test("human-input explanation semantics do not change routing shape", () => {
  const baseline = evaluation.evaluate({
    id: "evt:approval:baseline",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:45.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:baseline",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    request: {
      kind: "approval",
    },
  });

  const explained = evaluation.evaluate({
    id: "evt:approval:explained",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:45.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:explained",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    semantic: {
      intentFrame: "approval_request",
      whyNow: "This deploy is waiting on an explicit approval checkpoint.",
      factors: ["approval", "deploy"],
      relationHints: [],
      confidence: "low",
      reasons: ["request kind establishes an explicit operator decision point"],
    },
    request: {
      kind: "approval",
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(explained.kind, "candidate");
  if (baseline.kind !== "candidate" || explained.kind !== "candidate") {
    return;
  }

  assert.equal(explained.candidate.mode, baseline.candidate.mode);
  assert.equal(explained.candidate.priority, baseline.candidate.priority);
  assert.equal(explained.candidate.tone, baseline.candidate.tone);
  assert.equal(explained.candidate.consequence, baseline.candidate.consequence);
  assert.equal(explained.candidate.blocking, baseline.candidate.blocking);
  assert.equal(explained.candidate.responseSpec.kind, baseline.candidate.responseSpec.kind);
  assert.equal(
    explained.candidate.provenance?.whyNow,
    "This deploy is waiting on an explicit approval checkpoint.",
  );
  assert.equal(explained.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("question wording about a tool does not project a tool family without explicit source truth", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:question:read-wording",
    taskId: "task:question:read-wording",
    timestamp: "2026-03-08T12:03:50.000Z",
    type: "human.input.requested",
    interactionId: "interaction:question:read-wording",
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type !== "human.input.requested") {
    return;
  }

  const result = evaluation.evaluate(normalized);
  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.mode, "choice");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("explicit question tool families stay semantic-only during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:question:explicit-tool-family",
    taskId: "task:question:explicit-tool-family",
    timestamp: "2026-03-08T12:03:40.000Z",
    type: "human.input.requested",
    interactionId: "interaction:question:explicit-tool-family",
    toolFamily: "read",
    activityClass: "question_request",
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
    semantic: {
      intentFrame: "question_request",
      activityClass: "question_request",
      toolFamily: "read",
      consequence: "medium",
      factors: ["human.input.requested", "choice"],
      relationHints: [],
      confidence: "low",
      reasons: ["tool family was supplied by the source or context"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("explicit form tool families stay semantic-only during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:form:explicit-tool-family",
    taskId: "task:form:explicit-tool-family",
    timestamp: "2026-03-08T12:03:50.000Z",
    type: "human.input.requested",
    interactionId: "interaction:form:explicit-tool-family",
    toolFamily: "read",
    activityClass: "question_request",
    title: "Fill out the release form",
    summary: "Provide the required deployment fields.",
    request: {
      kind: "form",
      fields: [{ id: "reason", label: "Reason", input: { kind: "text" } }],
    },
    semantic: {
      intentFrame: "question_request",
      activityClass: "question_request",
      toolFamily: "read",
      consequence: "medium",
      factors: ["human.input.requested", "form"],
      relationHints: [],
      confidence: "low",
      reasons: ["tool family was supplied by the source or context"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.mode, "form");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
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
