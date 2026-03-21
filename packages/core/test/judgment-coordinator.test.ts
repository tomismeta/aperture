import test from "node:test";
import assert from "node:assert/strict";

import type { Frame } from "../src/index.js";

import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import type { AttentionView } from "../src/frame.js";
import { AttentionPolicy } from "../src/attention-policy.js";
import type { AttentionPressure } from "../src/attention-pressure.js";
import { AttentionPlanner } from "../src/attention-planner.js";
import { AttentionValue } from "../src/attention-value.js";

const coordinator = new JudgmentCoordinator();

function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame:current",
    taskId: "task:1",
    interactionId: "interaction:current",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Current review",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    timing: {
      createdAt: "2026-03-08T12:00:00.000Z",
      updatedAt: "2026-03-08T12:00:00.000Z",
    },
    ...overrides,
  };
}

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:1",
    interactionId: "interaction:new",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "New review",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    priority: "high",
    blocking: true,
    timestamp: "2026-03-08T12:01:00.000Z",
    ...overrides,
  };
}

function createAttentionPressure(overrides: Partial<AttentionPressure> = {}): AttentionPressure {
  return {
    level: "elevated",
    overloadRisk: "rising",
    score: 3,
    metrics: {
      recentDemand: 5,
      interruptiveVisible: 1,
      averageResponseLatencyMs: 9_000,
      deferredCount: 2,
      suppressedCount: 1,
      ...(overrides.metrics ?? {}),
    },
    reasons: ["incoming demand is climbing"],
    ...overrides,
  };
}

test("activates a candidate when nothing is active", () => {
  const decision = coordinator.coordinate(null, createCandidate());
  assert.equal(decision.kind, "activate");
});

test("queues ambiguous non-blocking work when the surface is empty", () => {
  const decision = coordinator.coordinate(
    null,
    createCandidate({
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("operator absence keeps blocking work queued instead of activating immediately", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate(),
    {
      operatorPresence: "absent",
    },
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.criterion?.ambiguity, null);
  assert.ok(
    explanation.reasons.includes(
      "operator absence keeps interruptive work peripheral until active attention returns",
    ),
  );
});

test("keeps background work ambient while a blocking frame is waiting", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "ambient");
});

test("keeps background work ambient even when it outranks a weak current frame", () => {
  const explanation = coordinator.explain(
    createFrame({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T11:59:00.000Z",
        updatedAt: "2026-03-08T11:59:00.000Z",
      },
    }),
    createCandidate({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
      attentionScoreOffset: 100,
    }),
  );

  assert.equal(explanation.decision.kind, "ambient");
  assert.equal(explanation.criterion?.peripheralResolution, "ambient");
  assert.equal(explanation.policyCriterionEvaluations[1]?.rule, "interrupt_eligibility");
});

test("falls back to queue when a surface cannot render ambient work", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      surfaceCapabilities: {
        topology: {
          supportsAmbient: false,
        },
        responses: {
          supportsSingleChoice: true,
          supportsMultipleChoice: false,
          supportsForm: true,
          supportsTextResponse: false,
        },
      },
    },
  );

  assert.equal(decision.kind, "queue");
});

test("surface capability fallback still keeps lower-ranked work queued when ambient is unsupported", () => {
  const decision = coordinator.coordinate(
    createFrame({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
    createCandidate({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      surfaceCapabilities: {
        topology: {
          supportsAmbient: false,
        },
        responses: {
          supportsSingleChoice: true,
          supportsMultipleChoice: false,
          supportsForm: true,
          supportsTextResponse: false,
        },
      },
    },
  );

  assert.equal(decision.kind, "queue");
});

test("tool-oriented configured policy does not preserve passive status routing even with explicit tool metadata", () => {
  const configuredCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      judgmentConfig: {
        version: 1,
        updatedAt: "2026-03-12T10:15:00.000Z",
        policy: {
          lowRiskRead: {
            mayInterrupt: false,
            minimumPresentation: "ambient",
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = configuredCoordinator.explain(
    createFrame({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T11:59:00.000Z",
        updatedAt: "2026-03-08T11:59:00.000Z",
      },
    }),
    createCandidate({
      mode: "status",
      title: "Read config file",
      summary: "Open config for review",
      tone: "ambient",
      consequence: "low",
      priority: "normal",
      blocking: false,
      toolFamily: "read",
      responseSpec: { kind: "none" },
      attentionScoreOffset: 100,
    }),
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.equal(explanation.policy.minimumPresentation, "ambient");
  assert.equal(explanation.criterion?.peripheralResolution ?? null, null);
  assert.equal(explanation.policyCriterionEvaluations[1]?.rule, "interrupt_eligibility");
});

test("passive status ignores ambient-surface fallback when no sticky peripheral rule applies", () => {
  const configuredCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      judgmentConfig: {
        version: 1,
        updatedAt: "2026-03-12T10:15:00.000Z",
        policy: {
          lowRiskRead: {
            mayInterrupt: false,
            minimumPresentation: "ambient",
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = configuredCoordinator.explain(
    createFrame({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T11:59:00.000Z",
        updatedAt: "2026-03-08T11:59:00.000Z",
      },
    }),
    createCandidate({
      mode: "status",
      title: "Read config file",
      summary: "Open config for review",
      tone: "ambient",
      consequence: "low",
      priority: "normal",
      blocking: false,
      toolFamily: "read",
      responseSpec: { kind: "none" },
      attentionScoreOffset: 100,
    }),
    {
      surfaceCapabilities: {
        topology: {
          supportsAmbient: false,
        },
        responses: {
          supportsSingleChoice: true,
          supportsMultipleChoice: false,
          supportsForm: true,
          supportsTextResponse: false,
        },
      },
    },
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.equal(explanation.policy.minimumPresentation, "ambient");
  assert.equal(explanation.criterion?.peripheralResolution ?? null, null);
});

test("queues lower-consequence candidates at equal priority", () => {
  const decision = coordinator.coordinate(
    createFrame({ consequence: "high" }),
    createCandidate({ consequence: "medium" }),
  );

  assert.equal(decision.kind, "queue");
});

test("activates higher-consequence candidates at equal priority", () => {
  const decision = coordinator.coordinate(
    createFrame({ consequence: "medium" }),
    createCandidate({ consequence: "high" }),
  );

  assert.equal(decision.kind, "activate");
});

test("keeps the current interrupt active when a competing interrupt is only equally urgent", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate(),
  );

  assert.equal(decision.kind, "queue");
});

test("conflicting interrupt resolution yields when the challenger is clearly stronger", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      consequence: "high",
      attentionScoreOffset: 8,
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("non-blocking approvals still count as interrupt-class challengers", () => {
  const decision = coordinator.coordinate(
    createFrame({
      mode: "status",
      tone: "critical",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      mode: "approval",
      blocking: false,
      priority: "normal",
      consequence: "medium",
      tone: "focused",
      attentionScoreOffset: 40,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("informational non-status candidates still participate in conflicting interrupt resolution", () => {
  const decision = coordinator.coordinate(
    createFrame({
      mode: "choice",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      mode: "choice",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      attentionScoreOffset: -5,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("planner defaults can disable conflicting interrupt resolution", () => {
  const interruptConflictDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        conflictingInterruptMargin: 0,
      },
    }),
  );

  const decision = interruptConflictDisabledCoordinator.coordinate(
    createFrame(),
    createCandidate(),
  );

  assert.equal(decision.kind, "activate");
});

test("keeps narrow score gains queued instead of stealing focus immediately", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "ambient",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("keeps freshly surfaced non-blocking work active during the minimum dwell window", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("planner defaults can disable the minimum dwell window", () => {
  const dwellDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        minimumDwellMs: 0,
      },
    }),
  );

  const decision = dwellDisabledCoordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("disabled continuity rules bypass the minimum dwell override", () => {
  const continuityDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        disabledContinuityRules: ["minimum_dwell"],
      },
    }),
  );

  const explanation = continuityDisabledCoordinator.explain(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.deepEqual(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "minimum_dwell"),
    {
      rule: "minimum_dwell",
      kind: "noop",
      rationale: ["operator disabled the minimum_dwell continuity rule"],
    },
  );
});

test("disabling one continuity rule still allows others to fire", () => {
  const selectivelyDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        disabledContinuityRules: ["minimum_dwell"],
      },
    }),
  );

  const explanation = selectivelyDisabledCoordinator.explain(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(explanation.decision.kind, "ambient");
  assert.deepEqual(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "minimum_dwell"),
    {
      rule: "minimum_dwell",
      kind: "noop",
      rationale: ["operator disabled the minimum_dwell continuity rule"],
    },
  );
  const streamContinuityEvaluation = explanation.continuityEvaluations?.find((evaluation) =>
    evaluation.rule === "decision_stream_continuity"
  );
  assert.equal(streamContinuityEvaluation?.kind, "override");
  assert.equal(streamContinuityEvaluation?.decision.kind, "ambient");
  assert.match(streamContinuityEvaluation?.rationale?.[0] ?? "", /current decision stream stays active/);
});

test("disabling multiple continuity rules bypasses both overrides together", () => {
  const multiplyDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        disabledContinuityRules: ["minimum_dwell", "decision_stream_continuity"],
      },
    }),
  );

  const explanation = multiplyDisabledCoordinator.explain(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.deepEqual(
    explanation.continuityEvaluations?.filter((evaluation) => evaluation.kind === "noop"),
    [
      {
        rule: "visible_episode",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "same_episode",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "minimum_dwell",
        kind: "noop",
        rationale: ["operator disabled the minimum_dwell continuity rule"],
      },
      {
        rule: "burst_dampening",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "same_interaction",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "deferral_escalation",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "conflicting_interrupt",
        kind: "noop",
        rationale: [],
      },
      {
        rule: "decision_stream_continuity",
        kind: "noop",
        rationale: ["operator disabled the decision_stream_continuity continuity rule"],
      },
      {
        rule: "context_patience",
        kind: "noop",
        rationale: [],
      },
    ],
  );
});

test("keeps cross-stream work peripheral when the current stream is still close in value", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "ambient");
});

test("decision-stream continuity ignores incidental tool wording without explicit metadata", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      title: "Read current file",
      summary: "Inspect the current result",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      title: "Read completed",
      summary: "Read completed successfully.",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "ambient");
});

test("blocking work bypasses decision-stream continuity", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: true,
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("decision-stream continuity yields when cross-stream work is clearly stronger", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      attentionScoreOffset: 24,
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("planner defaults can disable decision-stream continuity", () => {
  const streamContinuityDisabledCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        streamContinuityMargin: 0,
      },
    }),
  );

  const decision = streamContinuityDisabledCoordinator.coordinate(
    createFrame({
      taskId: "task:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      source: { id: "session:claude", kind: "claude-code" },
      metadata: {
        toolFamily: "read",
      },
    }),
    createCandidate({
      taskId: "task:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      source: { id: "session:open", kind: "opencode" },
      toolFamily: "bash",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("explanation marks ambiguity when low-signal work stays peripheral", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.deepEqual(explanation.ambiguity, {
    kind: "interrupt",
    reason: "low_signal",
    resolution: "queue",
  });
  assert.ok(explanation.reasons.includes("uncertain interruptive work stays peripheral until its signal is stronger"));
});

test("low-confidence non-blocking work stays queued through semantic ambiguity handling", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      mode: "status",
      tone: "critical",
      consequence: "high",
      priority: "high",
      blocking: false,
      responseSpec: { kind: "none" },
      semanticConfidence: "low",
      attentionScoreOffset: 160,
    }),
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.deepEqual(explanation.ambiguity, {
    kind: "interrupt",
    reason: "low_signal",
    resolution: "queue",
  });
  assert.ok(
    explanation.reasons.includes(
      "low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer",
    ),
  );
  assert.deepEqual(
    explanation.policyCriterionEvaluations.map((evaluation) => evaluation.rule),
    [
      "operator_absence",
      "interrupt_eligibility",
      "source_trust",
      "attention_budget",
      "semantic_uncertainty",
    ],
  );
});

test("semantic abstention keeps passive work ambient through the ambiguity lane", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
      semanticAbstained: true,
    }),
  );

  assert.equal(explanation.decision.kind, "ambient");
  assert.deepEqual(explanation.ambiguity, {
    kind: "interrupt",
    reason: "low_signal",
    resolution: "ambient",
  });
  assert.ok(
    explanation.reasons.includes(
      "semantic interpretation abstained, so non-blocking work stays peripheral until stronger explicit evidence arrives",
    ),
  );
});

test("explicit blocking work is not downgraded by low semantic confidence", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      semanticConfidence: "low",
    }),
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.equal(explanation.ambiguity, null);
  assert.deepEqual(
    explanation.policyCriterionEvaluations.map((evaluation) => evaluation.rule),
    [
      "operator_absence",
      "interrupt_eligibility",
    ],
  );
});

test("re-activates updates to the same interaction id", () => {
  const decision = coordinator.coordinate(
    createFrame({ interactionId: "interaction:same" }),
    createCandidate({ interactionId: "interaction:same" }),
  );

  assert.equal(decision.kind, "activate");
});

test("rapid same-interaction status refreshes stay peripheral instead of forcing focus", () => {
  const explanation = coordinator.explain(
    createFrame({
      taskId: "task:refresh",
      interactionId: "interaction:refresh",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:00.000Z",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    }),
    createCandidate({
      taskId: "task:refresh",
      interactionId: "interaction:refresh",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      timestamp: "2026-03-08T12:00:00.746Z",
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(explanation.decision.kind, "ambient");
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "same_interaction")?.kind,
    "override",
  );
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "minimum_dwell")?.kind,
    "override",
  );
  assert.match(
    explanation.reasons.join(" "),
    /recently surfaced work keeps focus|rapid successive updates/,
  );
});

test("queues non-blocking high-status work while a blocking frame is waiting", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      mode: "status",
      tone: "critical",
      consequence: "high",
      priority: "high",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("promotes blocking work over non-blocking status frames", () => {
  const decision = coordinator.coordinate(
    createFrame({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: true,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("uses stored attention offsets to keep more important current work active", () => {
  const decision = coordinator.coordinate(
    createFrame({
      metadata: {
        attention: {
          scoreOffset: 20,
          rationale: ["history indicates this work matters quickly"],
        },
      },
    }),
    createCandidate({
      consequence: "medium",
      attentionScoreOffset: 0,
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("keeps low-value status ambient when urgent backlog is already present", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "critical",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
    {
      attentionView: {
        active: createFrame({
          taskId: "task:critical:1",
          interactionId: "interaction:critical:1",
          mode: "status",
          tone: "critical",
          consequence: "high",
          responseSpec: { kind: "none" },
          timing: {
            createdAt: "2026-03-08T12:00:20.000Z",
            updatedAt: "2026-03-08T12:00:20.000Z",
          },
        }),
        queued: [
          createFrame({
            taskId: "task:critical:2",
            interactionId: "interaction:critical:2",
            mode: "status",
            tone: "critical",
            consequence: "high",
            responseSpec: { kind: "none" },
            timing: {
              createdAt: "2026-03-08T12:00:30.000Z",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
    },
  );

  assert.equal(decision.kind, "ambient");
});

test("escalates repeatedly deferred status when scores are otherwise tied", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:stuck",
      interactionId: "interaction:stuck",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      taskSignalSummary: {
        recentSignals: 6,
        lifetimeSignals: 12,
        counts: {
          presented: 2,
          viewed: 0,
          responded: 0,
          dismissed: 0,
          deferred: 3,
          contextExpanded: 0,
          contextSkipped: 0,
          timedOut: 0,
          returned: 2,
          attentionShifted: 0,
        },
        deferred: {
          queued: 3,
          suppressed: 0,
          manual: 0,
        },
        responseRate: 0,
        dismissalRate: 0,
        averageResponseLatencyMs: null,
        averageDismissalLatencyMs: null,
        lastSignalAt: "2026-03-08T12:00:30.000Z",
      },
    },
  );

  assert.equal(decision.kind, "activate");
});

test("queues context-heavy work until it clearly outranks current work", () => {
  const contextAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        toolFamilies: {
          bash: {
            presentations: 5,
            responses: 3,
            dismissals: 0,
            contextExpansionRate: 0.7,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = contextAwareCoordinator.coordinate(
    createFrame({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:00.000Z",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    }),
    createCandidate({
      mode: "approval",
      toolFamily: "bash",
      title: "Run deployment cleanup",
      summary: "Shell command will remove stale build artifacts",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("durable source trust can lower the interrupt bar when no frame is active", () => {
  const trustAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        sourceTrust: {
          "claude-code": {
            medium: {
              confirmations: 4,
              disagreements: 0,
              trustAdjustment: 8,
            },
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = trustAwareCoordinator.explain(
    null,
    createCandidate({
      blocking: false,
      priority: "normal",
      consequence: "medium",
      tone: "focused",
      source: { id: "session:1", kind: "claude-code" },
      attentionScoreOffset: 65,
    }),
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.equal(explanation.criterion?.criterion.activationThreshold, 176);
  assert.deepEqual(explanation.criterion?.rationale, [
    "durable source trust lowers the interrupt bar for this source",
  ]);
  assert.equal(explanation.policyGateEvaluations.at(-1)?.rule, "interruptive_default");
  assert.deepEqual(
    explanation.policyCriterionEvaluations.map((evaluation) => evaluation.rule),
    [
      "operator_absence",
      "interrupt_eligibility",
      "source_trust",
      "attention_budget",
      "semantic_uncertainty",
      "no_active_frame",
    ],
  );
  assert.equal(explanation.policyCriterionEvaluations[2]?.kind, "adjust");
});

test("low-trust sources need a clearer margin before they interrupt current work", () => {
  const trustAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        sourceTrust: {
          "claude-code": {
            medium: {
              confirmations: 1,
              disagreements: 4,
              trustAdjustment: -8,
            },
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = trustAwareCoordinator.explain(
    createFrame({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:00.000Z",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    }),
    createCandidate({
      blocking: false,
      priority: "normal",
      consequence: "medium",
      tone: "focused",
      source: { id: "session:1", kind: "claude-code" },
      attentionScoreOffset: 22,
    }),
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.criterion?.criterion.promotionMargin, 24);
  assert.deepEqual(explanation.criterion?.rationale, [
    "low-trust source signals need a clearer margin before interrupting",
    "small score gaps resolve to the periphery instead of stealing focus immediately",
  ]);
  assert.deepEqual(
    explanation.policyCriterionEvaluations.map((evaluation) => evaluation.rule),
    [
      "operator_absence",
      "interrupt_eligibility",
      "source_trust",
      "attention_budget",
      "semantic_uncertainty",
      "no_active_frame",
      "small_score_gap",
    ],
  );
  assert.equal(explanation.policyCriterionEvaluations[2]?.kind, "adjust");
  assert.equal(explanation.policyCriterionEvaluations.at(-1)?.kind, "verdict");
});

test("sustained attention burden raises the interrupt bar for borderline work", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      blocking: false,
      priority: "normal",
      consequence: "medium",
      tone: "focused",
      attentionScoreOffset: 75,
    }),
    {
      attentionBurden: {
        level: "high",
        thresholdOffset: 12,
        metrics: {
          recentDecisions: 8,
          deferredCount: 3,
          averageResponseLatencyMs: 16_000,
          interruptiveVisible: 2,
          pressureLevel: "high",
          attentionState: "overloaded",
        },
        reasons: [
          "current pressure is already high",
          "recent operator behavior indicates overload",
        ],
      },
    },
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.criterion?.criterion.activationThreshold, 192);
  assert.deepEqual(explanation.criterion?.rationale, [
    "sustained attention burden raises the interrupt bar until the operator load eases",
    "uncertain interruptive work stays peripheral until its signal is stronger",
  ]);
  assert.equal(explanation.policyCriterionEvaluations[3]?.rule, "attention_budget");
  assert.equal(explanation.policyCriterionEvaluations[3]?.kind, "adjust");
  assert.equal(explanation.policyCriterionEvaluations.at(-1)?.rule, "no_active_frame");
  assert.equal(explanation.policyCriterionEvaluations.at(-1)?.kind, "verdict");
});

test("keeps deferred-returning work queued during pressure instead of ambient", () => {
  const memoryAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        toolFamilies: {
          bash: {
            presentations: 5,
            responses: 3,
            dismissals: 0,
            returnAfterDeferralRate: 0.8,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = memoryAwareCoordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "critical",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      toolFamily: "bash",
      title: "Run deploy command",
      summary: "Operator usually comes back to these after deferring",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
    {
      attentionView: {
        active: createFrame({
          taskId: "task:critical:1",
          interactionId: "interaction:critical:1",
          mode: "status",
          tone: "critical",
          consequence: "high",
          responseSpec: { kind: "none" },
          timing: {
            createdAt: "2026-03-08T12:00:20.000Z",
            updatedAt: "2026-03-08T12:00:20.000Z",
          },
        }),
        queued: [
          createFrame({
            taskId: "task:critical:2",
            interactionId: "interaction:critical:2",
            mode: "status",
            tone: "critical",
            consequence: "high",
            responseSpec: { kind: "none" },
            timing: {
              createdAt: "2026-03-08T12:00:30.000Z",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
    },
  );

  assert.equal(decision.kind, "queue");
});

test("keeps low consequence work queued during pressure when calibration says the band is understated", () => {
  const calibratedCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        consequenceProfiles: {
          low: {
            rejectionRate: 0.6,
            reviewedCount: 8,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = calibratedCoordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "critical",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "status",
      tone: "focused",
      consequence: "low",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
    {
      attentionView: {
        active: createFrame({
          taskId: "task:critical:1",
          interactionId: "interaction:critical:1",
          mode: "status",
          tone: "critical",
          consequence: "high",
          responseSpec: { kind: "none" },
          timing: {
            createdAt: "2026-03-08T12:00:20.000Z",
            updatedAt: "2026-03-08T12:00:20.000Z",
          },
        }),
        queued: [
          createFrame({
            taskId: "task:critical:2",
            interactionId: "interaction:critical:2",
            mode: "status",
            tone: "critical",
            consequence: "high",
            responseSpec: { kind: "none" },
            timing: {
              createdAt: "2026-03-08T12:00:30.000Z",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
    },
  );

  assert.equal(decision.kind, "queue");
});

test("preemptively suppresses low-value status when pressure is rising", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      pressureForecast: createAttentionPressure(),
    },
  );

  assert.equal(decision.kind, "ambient");
});

test("configured bounded approvals can auto-approve through the coordinator", () => {
  const autoApproveCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      judgmentConfig: {
        version: 1,
        updatedAt: "2026-03-12T10:15:00.000Z",
        policy: {
          lowRiskRead: {
            autoApprove: true,
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = autoApproveCoordinator.explain(
    null,
    createCandidate({
      mode: "approval",
      consequence: "low",
      title: "Read config.ts",
      summary: "config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
      blocking: true,
      priority: "normal",
      toolFamily: "read",
    }),
  );

  assert.equal(explanation.decision.kind, "auto_approve");
  if (explanation.decision.kind !== "auto_approve") {
    return;
  }
  assert.deepEqual(explanation.decision.response, {
    taskId: "task:1",
    interactionId: "interaction:new",
    response: { kind: "approved" },
  });
});

test("configured non-interruptive queue policy keeps optional approvals queued when the surface is empty", () => {
  const configuredCoordinator = new JudgmentCoordinator(
    new AttentionPolicy({
      judgmentConfig: {
        version: 1,
        updatedAt: "2026-03-12T10:15:00.000Z",
        policy: {
          lowRiskRead: {
            mayInterrupt: false,
            minimumPresentation: "queue",
          },
        },
      },
    }),
    new AttentionValue(),
    new AttentionPlanner(),
  );

  const explanation = configuredCoordinator.explain(
    null,
    createCandidate({
      mode: "approval",
      title: "Read config file",
      summary: "Open config for review",
      consequence: "low",
      priority: "normal",
      blocking: false,
      toolFamily: "read",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.policy.minimumPresentation, "queue");
  assert.equal(explanation.criterion?.peripheralResolution, "queue");
  assert.equal(explanation.policyCriterionEvaluations[1]?.rule, "interrupt_eligibility");
});
