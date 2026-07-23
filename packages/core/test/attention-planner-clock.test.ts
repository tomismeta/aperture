import assert from "node:assert/strict";
import test from "node:test";

import { AttentionPlanner, type AttentionPlanningContext } from "../src/attention-planner.js";
import type { AttentionPolicyVerdict } from "../src/attention-policy.js";
import type { AttentionPressure } from "../src/attention-pressure.js";
import type { AttentionValueBreakdown } from "../src/attention-value.js";
import type { AttentionFrame, AttentionView } from "../src/frame.js";
import { scoreAttentionFrame } from "../src/frame-score.js";
import type { AttentionCandidate } from "../src/interaction-candidate.js";
import type { AttentionSignalSummary } from "../src/signal-summary.js";

test("planner uses reference clock to expire urgent backlog suppression", () => {
  const planner = new AttentionPlanner();
  const current = createFrame({
    id: "frame:current",
    taskId: "task:current",
    interactionId: "interaction:current",
    tone: "ambient",
    consequence: "low",
  });
  const candidate = createCandidate({
    taskId: "task:incoming",
    interactionId: "interaction:incoming",
    timestamp: "2026-03-08T12:01:00.000Z",
  });
  const attentionView = createUrgentBacklogView();

  const recentBacklog = planner.explain(
    current,
    candidate,
    createPlanningContext({
      attentionView,
      currentScore: scoreAttentionFrame(current, { now: candidate.timestamp }),
      referenceTimestamp: candidate.timestamp,
    }),
  );
  const expiredBacklog = planner.explain(
    current,
    candidate,
    createPlanningContext({
      attentionView,
      currentScore: scoreAttentionFrame(current, { now: "2026-03-08T12:05:00.000Z" }),
      referenceTimestamp: "2026-03-08T12:05:00.000Z",
    }),
  );

  assert.equal(recentBacklog.decision.kind, "ambient");
  assert.ok(recentBacklog.reasons.some((reason) => reason.includes("existing urgent backlog")));
  assert.equal(expiredBacklog.decision.kind, "activate");
});

test("planner uses reference clock when aging a resurfacing deferral frame", () => {
  const planner = new AttentionPlanner();
  const current = createFrame({
    id: "frame:current",
    taskId: "task:current",
    interactionId: "interaction:current",
    tone: "focused",
    consequence: "medium",
  });
  const surfaceFrame = createFrame({
    id: "frame:surface-now",
    taskId: "task:surface",
    interactionId: "interaction:surface",
    tone: "focused",
    consequence: "medium",
  });
  const candidate = createCandidate({
    taskId: "task:resurfacing",
    interactionId: "interaction:resurfacing",
    tone: "ambient",
    consequence: "low",
    attentionScoreOffset: -10,
    timestamp: "2026-03-08T12:01:00.000Z",
  });
  const attentionView: AttentionView = { now: surfaceFrame, next: [], ambient: [] };
  const continuitySignalSummary = createSignalSummary({ deferred: 3, returned: 0 });
  const immediateContext = createPlanningContext({
    attentionView,
    continuitySignalSummary,
    candidateScore: 90,
    currentScore: scoreAttentionFrame(current, { now: candidate.timestamp }),
    referenceTimestamp: candidate.timestamp,
    utility: createUtility(90),
  });
  const delayedContext = createPlanningContext({
    attentionView,
    continuitySignalSummary,
    candidateScore: 90,
    currentScore: scoreAttentionFrame(current, { now: "2026-03-08T13:00:00.000Z" }),
    referenceTimestamp: "2026-03-08T13:00:00.000Z",
    utility: createUtility(90),
  });

  const immediate = planner.explain(current, candidate, immediateContext);
  const delayed = planner.explain(current, candidate, delayedContext);

  assert.equal(immediate.decision.kind, "ambient");
  assert.equal(findDeferralEscalation(immediate)?.kind, "noop");
  assert.equal(delayed.decision.kind, "activate");
  assert.equal(findDeferralEscalation(delayed)?.kind, "override");
});

function createFrame(overrides: Partial<AttentionFrame> = {}): AttentionFrame {
  return {
    id: "frame",
    taskId: "task",
    interactionId: "interaction",
    version: 1,
    mode: "status",
    tone: "focused",
    consequence: "medium",
    title: "Status update",
    responseSpec: { kind: "none" },
    timing: {
      createdAt: "2026-03-08T12:00:00.000Z",
      updatedAt: "2026-03-08T12:00:00.000Z",
    },
    ...overrides,
  };
}

function createCandidate(overrides: Partial<AttentionCandidate> = {}): AttentionCandidate {
  return {
    taskId: "task:incoming",
    interactionId: "interaction:incoming",
    mode: "status",
    tone: "focused",
    consequence: "medium",
    title: "Incoming update",
    judgmentInput: { blockedLikeStatus: false },
    responseSpec: { kind: "none" },
    priority: "normal",
    blocking: false,
    timestamp: "2026-03-08T12:01:00.000Z",
    ...overrides,
  };
}

function createPlanningContext(
  overrides: Partial<AttentionPlanningContext> = {},
): AttentionPlanningContext {
  return {
    policyVerdict: createPolicyVerdict(),
    utility: createUtility(111),
    pressureForecast: createSteadyPressure(),
    candidateScore: 111,
    currentScore: 0,
    ...overrides,
  };
}

function createPolicyVerdict(
  overrides: Partial<AttentionPolicyVerdict> = {},
): AttentionPolicyVerdict {
  return {
    autoApprove: false,
    mayInterrupt: false,
    requiresOperatorResponse: false,
    minimumLane: "ambient",
    minimumLaneIsSticky: false,
    rationale: [],
    ...overrides,
  };
}

function createUtility(total: number): AttentionValueBreakdown {
  return {
    total,
    components: {
      priority: total,
      consequence: 0,
      tone: 0,
      blocking: 0,
      heuristics: 0,
      sourceTrust: 0,
      consequenceCalibration: 0,
      responseAffinity: 0,
      contextCost: 0,
      deferralAffinity: 0,
    },
    rationale: [],
  };
}

function createSteadyPressure(): AttentionPressure {
  return {
    level: "steady",
    overloadRisk: "low",
    score: 0,
    metrics: {
      recentDemand: 0,
      interruptiveVisible: 0,
      averageResponseLatencyMs: null,
      deferredCount: 0,
      suppressedCount: 0,
    },
    reasons: [],
  };
}

function createUrgentBacklogView(): AttentionView {
  return {
    now: createFrame({
      id: "frame:urgent:1",
      taskId: "task:urgent:1",
      interactionId: "interaction:urgent:1",
      tone: "critical",
      consequence: "high",
      timing: {
        createdAt: "2026-03-08T12:00:00.000Z",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    }),
    next: [
      createFrame({
        id: "frame:urgent:2",
        taskId: "task:urgent:2",
        interactionId: "interaction:urgent:2",
        tone: "critical",
        consequence: "high",
        timing: {
          createdAt: "2026-03-08T12:00:30.000Z",
          updatedAt: "2026-03-08T12:00:30.000Z",
        },
      }),
    ],
    ambient: [],
  };
}

function createSignalSummary(overrides: {
  deferred: number;
  returned: number;
}): AttentionSignalSummary {
  return {
    recentSignals: overrides.deferred + overrides.returned,
    lifetimeSignals: overrides.deferred + overrides.returned,
    counts: {
      presented: 0,
      viewed: 0,
      responded: 0,
      dismissed: 0,
      deferred: overrides.deferred,
      contextExpanded: 0,
      contextSkipped: 0,
      timedOut: 0,
      returned: overrides.returned,
      attentionShifted: 0,
    },
    deferred: {
      next: overrides.deferred,
      suppressed: 0,
      manual: 0,
    },
    responseRate: 0,
    dismissalRate: 0,
    averageResponseLatencyMs: null,
    averageDismissalLatencyMs: null,
    lastSignalAt: "2026-03-08T12:00:30.000Z",
  };
}

function findDeferralEscalation(
  explanation: ReturnType<AttentionPlanner["explain"]>,
): NonNullable<ReturnType<AttentionPlanner["explain"]>["continuityEvaluations"]>[number] | null {
  return (
    explanation.continuityEvaluations?.find(
      (evaluation) => evaluation.rule === "deferral_escalation",
    ) ?? null
  );
}
