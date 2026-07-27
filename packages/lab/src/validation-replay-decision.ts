import type {
  ReplayDecisionExpectation,
  ReplayDecisionSnapshot,
  ReplayObservationStep,
} from "./scenario.js";
import {
  buildKernelDecisionRecordProjectionFromSnapshot,
  fingerprintKernelDecisionRecordProjection,
  isKernelDecisionRecordFingerprint,
} from "./kernel-decision-contract.js";
import { hasShape, isBoolean, isNumber, isRecord, isString, isStringArray } from "./shape.js";
import {
  isKernelDecisionReasonCodeArray,
  isKernelDecisionRecordProjectionVersion,
  validateKernelDecisionRecordProjection,
} from "./kernel-decision-projection.js";
import {
  DECISION_KINDS,
  RESULT_BUCKETS,
  SEMANTIC_CONFIDENCE,
  STEP_KINDS,
  isStringOrNull,
} from "./validation-support.js";
import {
  isReplayDecisionValueComponents,
  isReplayEpisodeEvidenceScore,
  isReplayEpisodeSize,
  isReplayEpisodeState,
  validateReplayDecisionAmbiguity,
  validateReplayEpisodeExpectationEvidence,
  validateReplayEpisodeSnapshotEvidence,
} from "./validation-replay-decision-support.js";

const PLANNED_LANES = new Set(["now", "next", "ambient", "none"]);
const OPERATOR_PRESENCE = new Set(["present", "absent"]);
const COORDINATION_KINDS = new Set([...DECISION_KINDS, "suppressed"]);

export function validateReplayDecisionSnapshot(value: unknown): ReplayDecisionSnapshot | null {
  if (
    !isRecord(value) ||
    !hasShape(
      value,
      {
        stepIndex: isNumber,
        stepKind: isString,
      },
      {
        stepLabel: isString,
        interactionId: isString,
        semanticAbstained: isBoolean,
        decisionRecordProjectionVersion: isKernelDecisionRecordProjectionVersion,
        episodeId: isStringOrNull,
        episodeKey: isStringOrNull,
        episodeState: isReplayEpisodeState,
        episodeSize: isReplayEpisodeSize,
        episodeEvidenceScore: isReplayEpisodeEvidenceScore,
        episodeEvidenceReasons: isStringArray,
        episodeObsolete: isBoolean,
        decisionRecordCurrentFrameId: isStringOrNull,
        decisionRecordCurrentEpisodeId: isStringOrNull,
        decisionRecordCandidateScore: isNumber,
        decisionRecordValueComponents: isReplayDecisionValueComponents,
        decisionRecordReasons: isStringArray,
        decisionRecordReasonCodes: isKernelDecisionReasonCodeArray,
        decisionRecordFingerprint: isKernelDecisionRecordFingerprint,
      },
    ) ||
    !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"]) ||
    !["candidate", "clear", "noop"].includes(String(value.evaluationKind)) ||
    (value.decisionKind !== undefined && !COORDINATION_KINDS.has(String(value.decisionKind))) ||
    (value.decisionRecordRoute !== undefined &&
      !DECISION_KINDS.has(String(value.decisionRecordRoute))) ||
    (value.plannedLane !== undefined && !PLANNED_LANES.has(String(value.plannedLane))) ||
    (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane))) ||
    (value.decisionKind === "suppressed" && value.resultLane !== "none") ||
    (value.semanticConfidence !== undefined &&
      !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence))) ||
    (value.decisionRecordOperatorPresence !== undefined &&
      !OPERATOR_PRESENCE.has(String(value.decisionRecordOperatorPresence))) ||
    !validateReplayDecisionAmbiguity(value.ambiguity) ||
    !validateReplayEpisodeSnapshotEvidence(value) ||
    (value.decisionRecordProjectionVersion !== undefined &&
      !validateKernelDecisionRecordProjection(value)) ||
    !validateDecisionRecordFingerprint(value as ReplayDecisionSnapshot)
  ) {
    return null;
  }

  return value as ReplayDecisionSnapshot;
}
export function validateReplayDecisionExpectation(
  value: unknown,
): ReplayDecisionExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.stepIndex !== undefined && typeof value.stepIndex !== "number") ||
    (value.stepLabel !== undefined && typeof value.stepLabel !== "string") ||
    (value.evaluationKind !== undefined &&
      !["candidate", "clear", "noop"].includes(String(value.evaluationKind))) ||
    (value.decisionRecordProjectionVersion !== undefined &&
      !isKernelDecisionRecordProjectionVersion(value.decisionRecordProjectionVersion)) ||
    (value.decisionKind !== undefined && !COORDINATION_KINDS.has(String(value.decisionKind))) ||
    (value.decisionRecordRoute !== undefined &&
      !DECISION_KINDS.has(String(value.decisionRecordRoute))) ||
    (value.plannedLane !== undefined && !PLANNED_LANES.has(String(value.plannedLane))) ||
    (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane))) ||
    (value.decisionKind === "suppressed" && value.resultLane !== "none") ||
    (value.semanticConfidence !== undefined &&
      !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence))) ||
    (value.semanticAbstained !== undefined && typeof value.semanticAbstained !== "boolean") ||
    (value.semanticInfluenceIncludes !== undefined &&
      !isStringArray(value.semanticInfluenceIncludes)) ||
    (value.semanticImpactDecisionBearingIncludes !== undefined &&
      !isStringArray(value.semanticImpactDecisionBearingIncludes)) ||
    (value.semanticImpactExplanatoryIncludes !== undefined &&
      !isStringArray(value.semanticImpactExplanatoryIncludes)) ||
    (value.ambiguityReason !== undefined &&
      !(
        value.ambiguityReason === null ||
        value.ambiguityReason === "low_signal" ||
        value.ambiguityReason === "small_score_gap"
      )) ||
    (value.ambiguityResolution !== undefined &&
      !(
        value.ambiguityResolution === null ||
        value.ambiguityResolution === "queue" ||
        value.ambiguityResolution === "ambient"
      )) ||
    (value.episodeId !== undefined && !isStringOrNull(value.episodeId)) ||
    (value.episodeKey !== undefined && !isStringOrNull(value.episodeKey)) ||
    (value.episodeState !== undefined && !isReplayEpisodeState(value.episodeState)) ||
    (value.episodeObsolete !== undefined && typeof value.episodeObsolete !== "boolean") ||
    (value.decisionRecordCurrentFrameId !== undefined &&
      !isStringOrNull(value.decisionRecordCurrentFrameId)) ||
    (value.decisionRecordCurrentEpisodeId !== undefined &&
      !isStringOrNull(value.decisionRecordCurrentEpisodeId)) ||
    (value.decisionRecordOperatorPresence !== undefined &&
      !OPERATOR_PRESENCE.has(String(value.decisionRecordOperatorPresence))) ||
    (value.decisionRecordCandidateScore !== undefined &&
      typeof value.decisionRecordCandidateScore !== "number") ||
    (value.decisionRecordValueComponentsInclude !== undefined &&
      !isReplayDecisionValueComponents(value.decisionRecordValueComponentsInclude)) ||
    (value.decisionRecordReasonsInclude !== undefined &&
      !isStringArray(value.decisionRecordReasonsInclude)) ||
    (value.decisionRecordReasonCodesInclude !== undefined &&
      !isKernelDecisionReasonCodeArray(value.decisionRecordReasonCodesInclude)) ||
    !validateReplayEpisodeExpectationEvidence(value)
  ) {
    return null;
  }

  return value as ReplayDecisionExpectation;
}

function validateDecisionRecordFingerprint(value: ReplayDecisionSnapshot): boolean {
  if (value.decisionRecordFingerprint === undefined) {
    return true;
  }

  if (value.decisionRecordProjectionVersion === undefined) {
    return false;
  }

  const projection = buildKernelDecisionRecordProjectionFromSnapshot(value);

  return (
    projection !== null &&
    value.decisionRecordFingerprint === fingerprintKernelDecisionRecordProjection(projection)
  );
}
