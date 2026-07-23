import type { ReplayApertureTrace } from "./replay-trace.js";
import { isRecord, isStringArray } from "./shape.js";
import { validateApertureEvent } from "./validation-events.js";
import {
  DECISION_KINDS,
  RESULT_BUCKETS,
  TRACE_EVALUATION_KINDS,
  isStringOrNull,
  validateAttentionView,
  validateTaskViewLike,
} from "./validation-support.js";

const TRACE_PLANNED_LANES = new Set(["now", "next", "ambient", "none"]);
const TRACE_OPERATOR_PRESENCE = new Set(["present", "absent"]);

export function validateApertureTrace(value: unknown): ReplayApertureTrace | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.timestamp !== "string" ||
    validateApertureEvent(value.event) === null ||
    !isRecord(value.evaluation) ||
    typeof value.evaluation.kind !== "string" ||
    !TRACE_EVALUATION_KINDS.has(value.evaluation.kind) ||
    validateAttentionView(value.attentionView) === null ||
    validateTaskViewLike(value.taskView) === null
  ) {
    return null;
  }

  if (value.evaluation.kind === "candidate") {
    if (
      !isRecord(value.coordination) ||
      typeof value.coordination.kind !== "string" ||
      !DECISION_KINDS.has(value.coordination.kind) ||
      !RESULT_BUCKETS.has(String(value.coordination.resultLane)) ||
      (value.decisionRecord !== undefined && !validateReplayDecisionRecord(value.decisionRecord))
    ) {
      return null;
    }
  }

  return value as ReplayApertureTrace;
}

function validateReplayDecisionRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const planning = value.planning;
  const evidenceSnapshot = value.evidenceSnapshot;
  const decisionValue = value.value;
  const breakdown = isRecord(decisionValue) ? decisionValue.breakdown : undefined;
  const components = isRecord(breakdown) ? breakdown.components : undefined;

  return (
    isRecord(planning) &&
    DECISION_KINDS.has(String(planning.route)) &&
    TRACE_PLANNED_LANES.has(String(planning.plannedLane)) &&
    isStringArray(planning.reasons) &&
    (planning.reasonCodes === undefined || isStringArray(planning.reasonCodes)) &&
    isRecord(evidenceSnapshot) &&
    TRACE_OPERATOR_PRESENCE.has(String(evidenceSnapshot.operatorPresence)) &&
    isStringOrNull(evidenceSnapshot.currentFrameId) &&
    isStringOrNull(evidenceSnapshot.currentEpisodeId) &&
    isRecord(decisionValue) &&
    typeof decisionValue.candidateScore === "number" &&
    isRecord(components) &&
    Object.values(components).every((component) => typeof component === "number")
  );
}
