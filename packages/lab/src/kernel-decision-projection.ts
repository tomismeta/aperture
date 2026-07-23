import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import { DECISION_KINDS } from "./validation-support.js";

const DECISION_PLANNED_LANES = new Set(["now", "next", "ambient", "none"]);
const POLICY_MINIMUM_LANES = new Set(["now", "next", "ambient"]);
const POLICY_GATE_EVALUATION_KINDS = new Set(["noop", "verdict"]);
const POLICY_CRITERION_EVALUATION_KINDS = new Set(["noop", "adjust", "verdict"]);
const PERIPHERAL_RESOLUTIONS = new Set(["queue", "ambient"]);
const AMBIGUITY_REASONS = new Set(["low_signal", "small_score_gap"]);
const PRESSURE_LEVELS = new Set(["steady", "elevated", "high"]);
const PRESSURE_OVERLOAD_RISKS = new Set(["low", "rising", "high"]);
const OPERATOR_PRESENCE = new Set(["present", "absent"]);
const EVIDENCE_PRESENCE = new Set(["present", "absent"]);
const SIMPLE_RULE_NAME = /^[a-z][a-z0-9_]*$/;

type KernelDecisionProjectionCandidate = {
  evaluationKind?: unknown;
  decisionKind?: unknown;
  decisionRecordProjectionVersion?: unknown;
  decisionRecordRoute?: unknown;
  plannedLane?: unknown;
  decisionRecordCurrentFrameId?: unknown;
  decisionRecordCurrentEpisodeId?: unknown;
  decisionRecordOperatorPresence?: unknown;
  decisionRecordCandidateScore?: unknown;
  decisionRecordValueComponents?: unknown;
  decisionRecordReasons?: unknown;
  decisionRecordReasonCodes?: unknown;
};

export function isKernelDecisionRecordProjectionVersion(
  value: unknown,
): value is typeof KERNEL_DECISION_RECORD_PROJECTION_VERSION {
  return value === KERNEL_DECISION_RECORD_PROJECTION_VERSION;
}

export function isKernelDecisionReasonCode(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");
  switch (parts[0]) {
    case "route":
      return parts.length === 2 && DECISION_KINDS.has(part(parts, 1));
    case "lane":
      return parts.length === 2 && DECISION_PLANNED_LANES.has(part(parts, 1));
    case "policy":
      return isPolicyDecisionReasonCode(parts);
    case "policy_gate":
      return (
        parts.length === 3 &&
        SIMPLE_RULE_NAME.test(parts[1] ?? "") &&
        POLICY_GATE_EVALUATION_KINDS.has(part(parts, 2))
      );
    case "policy_criterion":
      return (
        parts.length === 3 &&
        SIMPLE_RULE_NAME.test(parts[1] ?? "") &&
        POLICY_CRITERION_EVALUATION_KINDS.has(part(parts, 2))
      );
    case "criterion":
      return isCriterionDecisionReasonCode(parts);
    case "continuity":
      return parts.length === 3 && SIMPLE_RULE_NAME.test(parts[1] ?? "") && parts[2] === "override";
    case "pressure":
      return isPressureDecisionReasonCode(parts);
    case "evidence":
      return isEvidenceDecisionReasonCode(parts);
    default:
      return false;
  }
}

export function isKernelDecisionReasonCodeArray(value: unknown): value is string[] {
  return isStringArray(value) && value.every(isKernelDecisionReasonCode);
}

export function validateKernelDecisionRecordProjection(
  value: KernelDecisionProjectionCandidate,
): boolean {
  if (!isKernelDecisionRecordProjectionVersion(value.decisionRecordProjectionVersion)) {
    return false;
  }

  const route = value.decisionRecordRoute;
  const lane = value.plannedLane;
  const operatorPresence = value.decisionRecordOperatorPresence;
  const reasonCodes = value.decisionRecordReasonCodes;

  if (
    value.evaluationKind !== "candidate" ||
    typeof value.decisionKind !== "string" ||
    typeof route !== "string" ||
    route !== value.decisionKind ||
    typeof lane !== "string" ||
    plannedLaneForDecisionRoute(route) !== lane ||
    !hasOwn(value, "decisionRecordCurrentFrameId") ||
    !isStringOrNull(value.decisionRecordCurrentFrameId) ||
    !hasOwn(value, "decisionRecordCurrentEpisodeId") ||
    !isStringOrNull(value.decisionRecordCurrentEpisodeId) ||
    typeof operatorPresence !== "string" ||
    !OPERATOR_PRESENCE.has(operatorPresence) ||
    typeof value.decisionRecordCandidateScore !== "number" ||
    !isNumberMap(value.decisionRecordValueComponents) ||
    !isStringArray(value.decisionRecordReasons) ||
    !isKernelDecisionReasonCodeArray(reasonCodes) ||
    new Set(reasonCodes).size !== reasonCodes.length
  ) {
    return false;
  }

  return (
    hasExactReasonCode(reasonCodes, "route:", `route:${route}`) &&
    hasExactReasonCode(reasonCodes, "lane:", `lane:${lane}`) &&
    hasExactReasonCode(
      reasonCodes,
      "evidence:operator_presence:",
      `evidence:operator_presence:${operatorPresence}`,
    ) &&
    hasExactReasonCode(
      reasonCodes,
      "evidence:current_frame:",
      `evidence:current_frame:${value.decisionRecordCurrentFrameId === null ? "absent" : "present"}`,
    ) &&
    hasExactReasonCode(
      reasonCodes,
      "evidence:current_episode:",
      `evidence:current_episode:${value.decisionRecordCurrentEpisodeId === null ? "absent" : "present"}`,
    ) &&
    hasOneReasonCodeForPrefix(reasonCodes, "policy:minimum_lane:") &&
    hasOneReasonCodeForPrefix(reasonCodes, "pressure:level:") &&
    hasOneReasonCodeForPrefix(reasonCodes, "pressure:overload:")
  );
}

function isPolicyDecisionReasonCode(parts: string[]): boolean {
  return (
    (parts.length === 2 &&
      (parts[1] === "auto_approve" ||
        parts[1] === "may_interrupt" ||
        parts[1] === "peripheral_only" ||
        parts[1] === "requires_operator_response")) ||
    (parts.length === 3 && parts[1] === "minimum_lane" && POLICY_MINIMUM_LANES.has(part(parts, 2)))
  );
}

function isCriterionDecisionReasonCode(parts: string[]): boolean {
  return (
    (parts.length === 3 &&
      parts[1] === "peripheral_resolution" &&
      PERIPHERAL_RESOLUTIONS.has(part(parts, 2))) ||
    (parts.length === 3 && parts[1] === "ambiguity" && AMBIGUITY_REASONS.has(part(parts, 2)))
  );
}

function isPressureDecisionReasonCode(parts: string[]): boolean {
  return (
    (parts.length === 3 && parts[1] === "level" && PRESSURE_LEVELS.has(part(parts, 2))) ||
    (parts.length === 3 && parts[1] === "overload" && PRESSURE_OVERLOAD_RISKS.has(part(parts, 2)))
  );
}

function isEvidenceDecisionReasonCode(parts: string[]): boolean {
  return (
    (parts.length === 3 &&
      parts[1] === "operator_presence" &&
      OPERATOR_PRESENCE.has(part(parts, 2))) ||
    (parts.length === 3 && parts[1] === "current_frame" && EVIDENCE_PRESENCE.has(part(parts, 2))) ||
    (parts.length === 3 && parts[1] === "current_episode" && EVIDENCE_PRESENCE.has(part(parts, 2)))
  );
}

function part(parts: string[], index: number): string {
  return parts[index] ?? "";
}

function plannedLaneForDecisionRoute(route: string): string | null {
  switch (route) {
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
      return null;
  }
}

function hasExactReasonCode(reasonCodes: string[], prefix: string, expected: string): boolean {
  const matches = reasonCodes.filter((reasonCode) => reasonCode.startsWith(prefix));

  return matches.length === 1 && matches[0] === expected;
}

function hasOneReasonCodeForPrefix(reasonCodes: string[], prefix: string): boolean {
  return reasonCodes.filter((reasonCode) => reasonCode.startsWith(prefix)).length === 1;
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNumberMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "number")
  );
}
