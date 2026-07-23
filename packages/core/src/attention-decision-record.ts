import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionEvidenceContext } from "./attention-evidence.js";
import type {
  AttentionLane,
  AttentionInterruptCriterionVerdict,
  AttentionPolicyVerdict,
} from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { AttentionValueBreakdown } from "./attention-value.js";
import type { ContinuityRuleEvaluation, ContinuityRuleName } from "./continuity/continuity-rule.js";
import {
  buildAttentionClaim,
  type AttentionClaim,
  type AttentionClaimPriority,
} from "./attention-claim.js";
import type { AttentionResponse } from "./frame-response.js";
import type {
  AttentionCandidate,
  AttentionPriority as InternalAttentionPriority,
} from "./interaction-candidate.js";
import { cloneRecordValue } from "./attention-record-json.js";
import type { PolicyCriterionRuleEvaluation } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRuleEvaluation } from "./policy/policy-gate-rule.js";

export const ATTENTION_DECISION_RECORD_SCHEMA_VERSION = 1 as const;

export type AttentionOperatorPresence = "present" | "absent";

export type AttentionDecisionRoute = "auto_approve" | "activate" | "queue" | "ambient";

export type AttentionCandidateDecision =
  | { kind: "auto_approve"; candidate: AttentionCandidate; response: AttentionResponse }
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate };

export type AttentionDecision = AttentionCandidateDecision | { kind: "clear" };

export type AttentionDecisionRecordDecision =
  | { kind: "auto_approve"; response: AttentionResponse }
  | { kind: "activate" }
  | { kind: "queue" }
  | { kind: "ambient" };

export type AttentionDecisionRecordContinuityEvaluation =
  | {
      rule: ContinuityRuleName;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: ContinuityRuleName;
      kind: "override";
      decision: { kind: AttentionDecisionRoute };
      currentPriority: AttentionClaimPriority | null;
      currentScore: number | null;
      rationale: string[];
    };

export type AttentionDecisionPlannedLane = "now" | "next" | "ambient" | "none";

export type AttentionDecisionReasonCode =
  | `route:${AttentionDecisionRoute}`
  | `lane:${AttentionDecisionPlannedLane}`
  | `policy:minimum_lane:${AttentionLane}`
  | `policy_gate:${PolicyGateRuleEvaluation["rule"]}:${PolicyGateRuleEvaluation["kind"]}`
  | `policy_criterion:${PolicyCriterionRuleEvaluation["rule"]}:${PolicyCriterionRuleEvaluation["kind"]}`
  | `criterion:peripheral_resolution:${NonNullable<AttentionInterruptCriterionVerdict["peripheralResolution"]>}`
  | `criterion:ambiguity:${NonNullable<AttentionDecisionAmbiguity["reason"]>}`
  | `continuity:${ContinuityRuleName}:override`
  | `pressure:level:${AttentionPressure["level"]}`
  | `pressure:overload:${AttentionPressure["overloadRisk"]}`
  | `evidence:operator_presence:${AttentionOperatorPresence}`
  | "evidence:current_frame:present"
  | "evidence:current_frame:absent"
  | "evidence:current_episode:present"
  | "evidence:current_episode:absent"
  | "policy:auto_approve"
  | "policy:may_interrupt"
  | "policy:peripheral_only"
  | "policy:requires_operator_response";

export type AttentionDecisionRecord = {
  schemaVersion: typeof ATTENTION_DECISION_RECORD_SCHEMA_VERSION;
  evaluatedAt: string;
  decision: AttentionDecisionRecordDecision;
  claim: AttentionClaim;
  evidenceSnapshot: {
    pressureForecast: AttentionPressure;
    attentionBurden: AttentionBurden;
    operatorPresence: AttentionOperatorPresence;
    currentFrameId: string | null;
    currentEpisodeId: string | null;
  };
  policy: {
    verdict: AttentionPolicyVerdict;
    gateEvaluations: PolicyGateRuleEvaluation[];
    criterion: AttentionInterruptCriterionVerdict | null;
    criterionEvaluations: PolicyCriterionRuleEvaluation[];
  };
  value: {
    breakdown: AttentionValueBreakdown;
    claimScore: number;
    currentScore: number | null;
    currentPriority: AttentionClaimPriority | null;
  };
  planning: {
    route: AttentionDecisionRoute;
    plannedLane: AttentionDecisionPlannedLane;
    ambiguity: AttentionDecisionAmbiguity | null;
    reasons: string[];
    reasonCodes: AttentionDecisionReasonCode[];
    continuityEvaluations: AttentionDecisionRecordContinuityEvaluation[];
  };
};

export type AttentionDecisionExplanation = {
  decision: AttentionCandidateDecision;
  evaluatedAt: string;
  policy: AttentionPolicyVerdict;
  policyGateEvaluations: PolicyGateRuleEvaluation[];
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  policyCriterionEvaluations: PolicyCriterionRuleEvaluation[];
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: InternalAttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  reasonCodes: AttentionDecisionReasonCode[];
  continuityEvaluations: ContinuityRuleEvaluation[];
  record: AttentionDecisionRecord;
};

export type AttentionDecisionExplanationInput = {
  decision: AttentionCandidateDecision;
  candidate: AttentionCandidate;
  evaluatedAt: string;
  recordClaim?: AttentionClaim;
  evidence: AttentionEvidenceContext;
  policy: AttentionPolicyVerdict;
  policyGateEvaluations: PolicyGateRuleEvaluation[];
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  policyCriterionEvaluations: PolicyCriterionRuleEvaluation[];
  candidateScore: number;
  currentScore: number | null;
  currentPriority: InternalAttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  continuityEvaluations: ContinuityRuleEvaluation[];
};

export function buildAttentionDecisionExplanation(
  input: AttentionDecisionExplanationInput,
): AttentionDecisionExplanation {
  const record = buildAttentionDecisionRecord(input);

  return {
    decision: input.decision,
    evaluatedAt: input.evaluatedAt,
    policy: input.policy,
    policyGateEvaluations: input.policyGateEvaluations,
    utility: input.utility,
    criterion: input.criterion,
    policyCriterionEvaluations: input.policyCriterionEvaluations,
    pressureForecast: input.evidence.pressureForecast,
    attentionBurden: input.evidence.attentionBurden,
    candidateScore: input.candidateScore,
    currentScore: input.currentScore,
    currentPriority: input.currentPriority,
    ambiguity: input.ambiguity,
    reasons: input.reasons,
    reasonCodes: record.planning.reasonCodes,
    continuityEvaluations: input.continuityEvaluations,
    record,
  };
}

export function buildAttentionDecisionRecord(
  input: AttentionDecisionExplanationInput,
): AttentionDecisionRecord {
  const plannedLane = plannedLaneForCandidateDecision(input.decision);
  const reasonCodes = buildAttentionDecisionReasonCodes(input, plannedLane);

  return {
    schemaVersion: ATTENTION_DECISION_RECORD_SCHEMA_VERSION,
    evaluatedAt: input.evaluatedAt,
    decision: cloneRecordValue(buildRecordDecision(input.decision), "decision"),
    claim: cloneRecordValue(input.recordClaim ?? buildAttentionClaim(input.candidate), "claim"),
    evidenceSnapshot: cloneRecordValue(
      {
        pressureForecast: input.evidence.pressureForecast,
        attentionBurden: input.evidence.attentionBurden,
        operatorPresence: input.evidence.operatorPresence,
        currentFrameId: input.evidence.currentFrame?.id ?? null,
        currentEpisodeId: input.evidence.currentEpisode?.id ?? null,
      },
      "evidenceSnapshot",
    ),
    policy: cloneRecordValue(
      {
        verdict: input.policy,
        gateEvaluations: input.policyGateEvaluations,
        criterion: input.criterion,
        criterionEvaluations: input.policyCriterionEvaluations,
      },
      "policy",
    ),
    value: cloneRecordValue(
      {
        breakdown: input.utility,
        claimScore: input.candidateScore,
        currentScore: input.currentScore,
        currentPriority: input.currentPriority,
      },
      "value",
    ),
    planning: cloneRecordValue(
      {
        route: input.decision.kind,
        plannedLane,
        ambiguity: input.ambiguity,
        reasons: input.reasons,
        reasonCodes,
        continuityEvaluations: projectContinuityEvaluations(input.continuityEvaluations),
      },
      "planning",
    ),
  };
}

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

function buildRecordDecision(
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

function projectContinuityEvaluations(
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
