import { buildAttentionClaim } from "./attention-claim.js";
import type {
  AttentionDecisionExplanation,
  AttentionDecisionExplanationInput,
  AttentionDecisionRecord,
} from "./attention-decision-record.js";
import { ATTENTION_DECISION_RECORD_SCHEMA_VERSION } from "./attention-decision-record-schema.js";
import { cloneRecordValue } from "./attention-record-json.js";
import {
  buildAttentionDecisionReasonCodes,
  buildRecordDecision,
  plannedLaneForCandidateDecision,
  projectContinuityEvaluations,
} from "./attention-decision-record-projection.js";

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
