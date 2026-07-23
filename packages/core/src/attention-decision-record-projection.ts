import type {
  AttentionCandidateDecision,
  AttentionDecision,
  AttentionDecisionExplanationInput,
  AttentionDecisionPlannedLane,
  AttentionDecisionReasonCode,
  AttentionDecisionRecordContinuityEvaluation,
  AttentionDecisionRecordDecision,
  AttentionDecisionRoute,
} from "./attention-decision-record.js";
import type { ContinuityRuleEvaluation } from "./continuity/continuity-rule.js";

export function buildAttentionDecisionReasonCodes(
  input: AttentionDecisionExplanationInput,
  plannedLane: AttentionDecisionPlannedLane,
): AttentionDecisionReasonCode[] {
  const codes = new Set<AttentionDecisionReasonCode>();

  codes.add(`route:${input.decision.kind}`);
  codes.add(`lane:${plannedLane}`);
  codes.add(`policy:minimum_lane:${input.policy.minimumLane}`);
  codes.add(`pressure:level:${input.evidence.pressureForecast.level}`);
  codes.add(`pressure:overload:${input.evidence.pressureForecast.overloadRisk}`);
  codes.add(`evidence:operator_presence:${input.evidence.operatorPresence}`);
  codes.add(
    input.evidence.currentFrame
      ? "evidence:current_frame:present"
      : "evidence:current_frame:absent",
  );
  codes.add(
    input.evidence.currentEpisode
      ? "evidence:current_episode:present"
      : "evidence:current_episode:absent",
  );

  if (input.policy.autoApprove) {
    codes.add("policy:auto_approve");
  }
  if (input.policy.mayInterrupt) {
    codes.add("policy:may_interrupt");
  } else {
    codes.add("policy:peripheral_only");
  }
  if (input.policy.requiresOperatorResponse) {
    codes.add("policy:requires_operator_response");
  }
  if (input.criterion?.peripheralResolution) {
    codes.add(`criterion:peripheral_resolution:${input.criterion.peripheralResolution}`);
  }
  if (input.ambiguity) {
    codes.add(`criterion:ambiguity:${input.ambiguity.reason}`);
  }

  for (const evaluation of input.policyGateEvaluations) {
    codes.add(`policy_gate:${evaluation.rule}:${evaluation.kind}`);
  }
  for (const evaluation of input.policyCriterionEvaluations) {
    codes.add(`policy_criterion:${evaluation.rule}:${evaluation.kind}`);
  }
  for (const evaluation of input.continuityEvaluations) {
    if (evaluation.kind === "override") {
      codes.add(`continuity:${evaluation.rule}:override`);
    }
  }

  return [...codes].sort();
}

export function plannedLaneForDecision(decision: AttentionDecision): AttentionDecisionPlannedLane {
  switch (decision.kind) {
    case "activate":
      return "now";
    case "queue":
      return "next";
    case "ambient":
      return "ambient";
    case "auto_approve":
    case "clear":
      return "none";
    default:
      return unreachableAttentionDecision(decision);
  }
}

export function plannedLaneForCandidateDecision(
  decision: AttentionCandidateDecision,
): AttentionDecisionPlannedLane {
  return plannedLaneForDecision(decision);
}

export function buildRecordDecision(
  decision: AttentionCandidateDecision,
): AttentionDecisionRecordDecision {
  switch (decision.kind) {
    case "auto_approve":
      return {
        kind: "auto_approve",
        response: decision.response,
      };
    case "activate":
      return { kind: "activate" };
    case "queue":
      return { kind: "queue" };
    case "ambient":
      return { kind: "ambient" };
    default:
      return unreachableAttentionDecision(decision);
  }
}

export function projectContinuityEvaluations(
  evaluations: ContinuityRuleEvaluation[],
): AttentionDecisionRecordContinuityEvaluation[] {
  return evaluations.map((evaluation) => {
    if (evaluation.kind === "noop") {
      return {
        rule: evaluation.rule,
        kind: "noop",
        rationale: evaluation.rationale,
      };
    }

    return {
      rule: evaluation.rule,
      kind: "override",
      decision: { kind: assertContinuityDecisionRoute(evaluation.decision.kind) },
      currentPriority: evaluation.currentPriority,
      currentScore: evaluation.currentScore,
      rationale: evaluation.rationale,
    };
  });
}

function assertContinuityDecisionRoute(route: AttentionDecision["kind"]): AttentionDecisionRoute {
  if (route === "clear") {
    throw new Error("Attention decision record continuity cannot project a clear transition.");
  }

  return route;
}

function unreachableAttentionDecision(decision: never): never {
  throw new Error(`Unhandled attention decision in decision record: ${JSON.stringify(decision)}`);
}
