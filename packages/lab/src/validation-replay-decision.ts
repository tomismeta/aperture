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

const PLANNED_LANES = new Set(["now", "next", "ambient", "none"]);
const OPERATOR_PRESENCE = new Set(["present", "absent"]);

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
    (value.decisionKind !== undefined && !DECISION_KINDS.has(String(value.decisionKind))) ||
    (value.decisionRecordRoute !== undefined &&
      !DECISION_KINDS.has(String(value.decisionRecordRoute))) ||
    (value.plannedLane !== undefined && !PLANNED_LANES.has(String(value.plannedLane))) ||
    (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane))) ||
    (value.semanticConfidence !== undefined &&
      !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence))) ||
    (value.decisionRecordOperatorPresence !== undefined &&
      !OPERATOR_PRESENCE.has(String(value.decisionRecordOperatorPresence))) ||
    !validateReplayDecisionAmbiguity(value.ambiguity) ||
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
    (value.decisionKind !== undefined && !DECISION_KINDS.has(String(value.decisionKind))) ||
    (value.decisionRecordRoute !== undefined &&
      !DECISION_KINDS.has(String(value.decisionRecordRoute))) ||
    (value.plannedLane !== undefined && !PLANNED_LANES.has(String(value.plannedLane))) ||
    (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane))) ||
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
      !isKernelDecisionReasonCodeArray(value.decisionRecordReasonCodesInclude))
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

function isReplayDecisionValueComponents(
  value: unknown,
): value is NonNullable<ReplayDecisionSnapshot["decisionRecordValueComponents"]> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([, componentValue]) => typeof componentValue === "number" && Number.isFinite(componentValue),
  );
}

function validateReplayDecisionAmbiguity(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      value.kind === "interrupt" &&
      (value.reason === "low_signal" || value.reason === "small_score_gap") &&
      (value.resolution === "queue" || value.resolution === "ambient"))
  );
}
