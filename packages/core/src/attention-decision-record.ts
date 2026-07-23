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
import type { AttentionClaim, AttentionClaimPriority } from "./attention-claim.js";
import { ATTENTION_DECISION_RECORD_SCHEMA_VERSION } from "./attention-decision-record-schema.js";
import type { AttentionResponse } from "./frame-response.js";
import type {
  AttentionCandidate,
  AttentionPriority as InternalAttentionPriority,
} from "./interaction-candidate.js";
import type { PolicyCriterionRuleEvaluation } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRuleEvaluation } from "./policy/policy-gate-rule.js";

export { ATTENTION_DECISION_RECORD_SCHEMA_VERSION } from "./attention-decision-record-schema.js";
export {
  buildAttentionDecisionExplanation,
  buildAttentionDecisionRecord,
} from "./attention-decision-record-builder.js";
export {
  buildAttentionDecisionReasonCodes,
  plannedLaneForCandidateDecision,
  plannedLaneForDecision,
} from "./attention-decision-record-projection.js";

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
