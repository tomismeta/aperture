import type {
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type {
  SemanticInterpretation,
  SemanticOntologyDiagnostic,
} from "@tomismeta/aperture-core/semantic";
import type { ApertureTrace } from "../../core/src/trace-types.js";

import type {
  ReplayArtifactSource,
  ReplayDecisionExpectation,
  ReplayDecisionSnapshot,
  ReplayExplanationExpectation,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplayScenarioExpectations,
  ReplayScenarioProvenance,
  ReplaySemanticExpectation,
  ReplaySemanticSnapshot,
  ReplayTraceExpectation,
  ReplayViewSnapshot,
} from "./scenario.js";
import {
  isReplaySemanticCalibrationFamily,
  SEMANTIC_CALIBRATION_FAMILIES,
  type ReplaySemanticCalibrationFamily,
} from "./semantic-calibration.js";
import {
  hasShape,
  isBoolean,
  isNumber,
  isNullable,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";

const EVENT_TYPES = new Set<ApertureEvent["type"]>([
  "task.started",
  "task.updated",
  "human.input.requested",
  "task.completed",
  "task.cancelled",
]);

const STEP_KINDS = new Set<ReplayObservationStep["kind"]>([
  "publish",
  "publishSource",
  "submit",
  "signal",
  "markViewed",
  "markTimedOut",
  "markContextExpanded",
  "markContextSkipped",
]);

const SIGNAL_KINDS = new Set<AttentionSignal["kind"]>([
  "presented",
  "viewed",
  "responded",
  "dismissed",
  "deferred",
  "context_expanded",
  "context_skipped",
  "timed_out",
  "returned",
  "attention_shifted",
]);

const RESPONSE_KINDS = new Set<AttentionResponse["response"]["kind"]>([
  "acknowledged",
  "approved",
  "rejected",
  "option_selected",
  "text_submitted",
  "form_submitted",
  "dismissed",
]);

const TRACE_EVALUATION_KINDS = new Set<ApertureTrace["evaluation"]["kind"]>([
  "noop",
  "clear",
  "candidate",
]);

const RESULT_BUCKETS = new Set(["now", "next", "ambient", "none"]);
const DECISION_KINDS = new Set(["auto_approve", "activate", "queue", "ambient", "clear"]);
const FRAME_MODES = new Set(["status", "approval", "choice", "form"]);
const TONES = new Set(["ambient", "focused", "critical"]);
const CONSEQUENCE_LEVELS = new Set(["low", "medium", "high"]);
const TASK_STATUSES = new Set(["running", "blocked", "waiting", "completed", "failed"]);
const REQUEST_KINDS = new Set(["approval", "choice", "form"]);
const SELECTION_MODES = new Set(["single", "multiple"]);
const FIELD_TYPES = new Set(["text", "textarea", "number", "select", "boolean"]);
const SIGNAL_RESPONSE_KINDS = new Set(["acknowledged", "approved", "rejected", "option_selected", "text_submitted", "form_submitted"]);
const DEFERRED_REASONS = new Set(["next", "suppressed", "manual"]);
const RETURNED_FROM = new Set(["next", "ambient"]);
const SEMANTIC_CONFIDENCE = new Set(["low", "medium", "high"]);
const SEMANTIC_FRAMES = new Set([
  "task_started",
  "status_update",
  "blocked_work",
  "failure",
  "approval_request",
  "question_request",
  "form_request",
  "completion",
  "cancellation",
]);
const SEMANTIC_ACTIVITY_CLASSES = new Set([
  "permission_request",
  "question_request",
  "follow_up",
  "tool_completion",
  "tool_failure",
  "session_status",
  "status_update",
]);
const SEMANTIC_ONTOLOGY_ASK = new Set(["approval", "choice", "form", "status", "none"]);
const SEMANTIC_ONTOLOGY_ACTIVITY = new Set([
  "decision_request",
  "question",
  "task_progress",
  "task_completion",
  "failure",
  "background_work",
]);
const SEMANTIC_ONTOLOGY_BLOCKING = new Set(["blocking", "waiting", "non_blocking"]);
const SEMANTIC_ONTOLOGY_EPISODE = new Set(["new", "same_issue", "resurfaced", "resolved", "unknown"]);
const SEMANTIC_ONTOLOGY_SOURCE = new Set(["explicit", "hinted", "inferred"]);
const RELATION_KINDS = new Set(["same_issue", "resolves", "supersedes", "repeats", "escalates"]);
const SEMANTIC_PROVENANCE_FIELDS = new Set([
  "intentFrame",
  "activityClass",
  "toolFamily",
  "consequence",
  "whyNow",
  "relationHints",
  "confidence",
  "abstained",
]);
const SEMANTIC_PROVENANCE_KINDS = new Set(["source", "inferred", "hint"]);
const SEMANTIC_CALIBRATION_FAMILY_SET = new Set<ReplaySemanticCalibrationFamily>(
  SEMANTIC_CALIBRATION_FAMILIES,
);

export { isRecord, isStringArray } from "./shape.js";

const isStringOrNull = isNullable(isString);
const isSemanticCalibrationFamilies = (
  value: unknown,
): value is ReplaySemanticCalibrationFamily[] =>
  Array.isArray(value)
  && value.every((entry) =>
    isReplaySemanticCalibrationFamily(entry)
    && SEMANTIC_CALIBRATION_FAMILY_SET.has(entry)
  );
const isStep = validateWith(validateReplayObservationStep);
const isReplaySemanticExpectationGuard = validateWith(validateReplaySemanticExpectation);
const isReplayDecisionExpectationGuard = validateWith(validateReplayDecisionExpectation);
const isReplayExplanationExpectationGuard = validateWith(validateReplayExplanationExpectation);
const isReplayTraceExpectationGuard = validateWith(validateReplayTraceExpectation);
const isAttentionFrameGuard = validateWith(validateAttentionFrame);
const isContextGuard = validateWith(validateContext);
const isProvenanceGuard = validateWith(validateProvenance);
const isSourceRefGuard = validateWith(validateSourceRef);
const isHumanInputRequestGuard = validateWith(validateHumanInputRequest);
const isSemanticInterpretationGuard = validateWith(validateSemanticInterpretation);
const isActivityClass = (value: unknown): boolean => value === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value));
const isDecisionAmbiguity = (value: unknown): boolean => validateReplayDecisionAmbiguity(value);

function validateBaseEvent(
  value: Record<string, unknown>,
  extras: {
    semantic?: boolean;
    semanticHints?: boolean;
  } = {},
): boolean {
  return hasShape(
    value,
    {
      type: isString,
      id: isString,
      taskId: isString,
      timestamp: isString,
    },
    {
      source: isSourceRefGuard,
    },
  )
    && EVENT_TYPES.has(value.type as ApertureEvent["type"])
    && (extras.semantic ? value.semantic === undefined || isSemanticInterpretationGuard(value.semantic) : true)
    && (extras.semanticHints ? value.semanticHints === undefined || isRecord(value.semanticHints) : true);
}

function validateTaskUpdatedLike(value: Record<string, unknown>): boolean {
  return hasShape(
    value,
    {
      title: isString,
      status: isString,
    },
    {
      summary: isString,
      toolFamily: isString,
      progress: isNumber,
    },
  )
    && TASK_STATUSES.has(value.status as string)
    && isActivityClass(value.activityClass);
}

function validateHumanInputRequestedLike(
  value: Record<string, unknown>,
  extras: {
    tone?: boolean;
    consequence?: boolean;
    riskHint?: boolean;
  } = {},
): boolean {
  return hasShape(
    value,
    {
      interactionId: isString,
      title: isString,
      summary: isString,
      request: isHumanInputRequestGuard,
    },
    {
      toolFamily: isString,
      context: isContextGuard,
      provenance: isProvenanceGuard,
    },
  )
    && isActivityClass(value.activityClass)
    && (!extras.tone || value.tone === undefined || TONES.has(String(value.tone)))
    && (!extras.consequence || value.consequence === undefined || CONSEQUENCE_LEVELS.has(String(value.consequence)))
    && (!extras.riskHint || value.riskHint === undefined || CONSEQUENCE_LEVELS.has(String(value.riskHint)));
}

function validateAttentionCollection(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.next)
    && Array.isArray(value.ambient)
    && (value.now === null || isAttentionFrameGuard(value.now))
    && value.next.every(isAttentionFrameGuard)
    && value.ambient.every(isAttentionFrameGuard);
}

export function validateReplayScenario(value: unknown): ReplayScenario | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      id: isString,
      title: isString,
    }, {
      description: isString,
      doctrineTags: isStringArray,
      semanticFamilies: isSemanticCalibrationFamilies,
      source: validateWith(validateReplayArtifactSource),
      provenance: validateWith(validateReplayScenarioProvenance),
      expectations: validateWith(validateReplayScenarioExpectations),
      core: isRecord,
    })
    || !Array.isArray(value.steps)
    || !value.steps.every(isStep)
  ) {
    return null;
  }

  return value as ReplayScenario;
}

export function validateReplayObservationStep(value: unknown): ReplayObservationStep | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      kind: isString,
    }, {
      label: isString,
    })
    || !STEP_KINDS.has(value.kind as ReplayObservationStep["kind"])
  ) {
    return null;
  }

  switch (value.kind) {
    case "publish":
      return validateApertureEvent(value.event) !== null ? value as ReplayObservationStep : null;
    case "publishSource":
      return validateSourceEvent(value.event) !== null ? value as ReplayObservationStep : null;
    case "submit":
      return validateAttentionResponse(value.response) !== null ? value as ReplayObservationStep : null;
    case "signal":
      return validateAttentionSignal(value.signal) !== null ? value as ReplayObservationStep : null;
    case "markViewed":
      return typeof value.taskId === "string"
        && typeof value.interactionId === "string"
        && (value.surface === undefined || typeof value.surface === "string")
        ? value as ReplayObservationStep
        : null;
    case "markTimedOut":
      return typeof value.taskId === "string"
        && typeof value.interactionId === "string"
        && (value.surface === undefined || typeof value.surface === "string")
        && (value.timeoutMs === undefined || typeof value.timeoutMs === "number")
        ? value as ReplayObservationStep
        : null;
    case "markContextExpanded":
    case "markContextSkipped":
      return typeof value.taskId === "string"
        && typeof value.interactionId === "string"
        && (value.surface === undefined || typeof value.surface === "string")
        && (value.section === undefined || typeof value.section === "string")
        ? value as ReplayObservationStep
        : null;
  }

  return null;
}

export function validateReplayViewSnapshot(value: unknown): ReplayViewSnapshot | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      stepKind: isString,
      nowInteractionId: isStringOrNull,
      nextInteractionIds: isStringArray,
      ambientInteractionIds: isStringArray,
    })
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || validateAttentionView(value.attentionView) === null
  ) {
    return null;
  }

  return value as ReplayViewSnapshot;
}

export function validateReplaySemanticSnapshot(value: unknown): ReplaySemanticSnapshot | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      stepKind: isString,
      interpretation: isSemanticInterpretationGuard,
    }, {
      ontology: isRecord,
      stepLabel: isString,
    })
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || validateSemanticInterpretation(value.interpretation) === null
    || (value.ontology !== undefined && validateSemanticOntologyDiagnostic(value.ontology) === null)
  ) {
    return null;
  }

  return value as ReplaySemanticSnapshot;
}

export function validateReplayNormalizedEventSnapshot(value: unknown): ReplayNormalizedEventSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.stepIndex !== "number"
    || value.stepKind !== "publishSource"
    || (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || validateApertureEvent(value.event) === null
  ) {
    return null;
  }

  return value as ReplayNormalizedEventSnapshot;
}

export function validateReplayDecisionSnapshot(value: unknown): ReplayDecisionSnapshot | null {
  if (
    !isRecord(value)
    || !hasShape(value, {
      stepIndex: isNumber,
      stepKind: isString,
    }, {
      stepLabel: isString,
      interactionId: isString,
      semanticAbstained: isBoolean,
    })
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || !["candidate", "clear", "noop"].includes(String(value.evaluationKind))
    || (value.decisionKind !== undefined && !DECISION_KINDS.has(String(value.decisionKind)))
    || (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane)))
    || (value.semanticConfidence !== undefined && !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence)))
    || !isDecisionAmbiguity(value.ambiguity)
  ) {
    return null;
  }

  return value as ReplayDecisionSnapshot;
}

export function validateApertureTrace(value: unknown): ApertureTrace | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.timestamp !== "string"
    || validateApertureEvent(value.event) === null
    || !isRecord(value.evaluation)
    || typeof value.evaluation.kind !== "string"
    || !TRACE_EVALUATION_KINDS.has(value.evaluation.kind as ApertureTrace["evaluation"]["kind"])
    || validateAttentionView(value.attentionView) === null
    || validateTaskViewLike(value.taskView) === null
  ) {
    return null;
  }

  if (value.evaluation.kind === "candidate") {
    if (
      !isRecord(value.coordination)
      || typeof value.coordination.kind !== "string"
      || !DECISION_KINDS.has(value.coordination.kind)
      || !RESULT_BUCKETS.has(String(value.coordination.resultLane))
    ) {
      return null;
    }
  }

  return value as ApertureTrace;
}

export function validateAttentionResponse(value: unknown): AttentionResponse | null {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.interactionId !== "string" || !isRecord(value.response)) {
    return null;
  }

  const kind = value.response.kind;
  if (typeof kind !== "string" || !RESPONSE_KINDS.has(kind as AttentionResponse["response"]["kind"])) {
    return null;
  }

  switch (kind) {
    case "acknowledged":
    case "dismissed":
      return value as AttentionResponse;
    case "approved":
    case "rejected":
      return value.response.reason === undefined || typeof value.response.reason === "string"
        ? value as AttentionResponse
        : null;
    case "option_selected":
      return isStringArray(value.response.optionIds) ? value as AttentionResponse : null;
    case "text_submitted":
      return typeof value.response.text === "string" ? value as AttentionResponse : null;
    case "form_submitted":
      return isRecord(value.response.values) ? value as AttentionResponse : null;
  }

  return null;
}

export function validateAttentionSignal(value: unknown): AttentionSignal | null {
  if (
    !isRecord(value)
    || typeof value.taskId !== "string"
    || typeof value.interactionId !== "string"
    || typeof value.timestamp !== "string"
    || typeof value.kind !== "string"
    || !SIGNAL_KINDS.has(value.kind as AttentionSignal["kind"])
  ) {
    return null;
  }

  switch (value.kind) {
    case "responded":
      return typeof value.responseKind === "string" && SIGNAL_RESPONSE_KINDS.has(value.responseKind) ? value as AttentionSignal : null;
    case "deferred":
      return value.reason === undefined || (typeof value.reason === "string" && DEFERRED_REASONS.has(value.reason))
        ? value as AttentionSignal
        : null;
    case "timed_out":
      return value.timeoutMs === undefined || typeof value.timeoutMs === "number" ? value as AttentionSignal : null;
    case "returned":
      return typeof value.from === "string" && RETURNED_FROM.has(value.from) ? value as AttentionSignal : null;
    case "attention_shifted":
      return typeof value.fromInteractionId === "string" && typeof value.toInteractionId === "string"
        ? value as AttentionSignal
        : null;
    case "context_expanded":
    case "context_skipped":
      return value.section === undefined || typeof value.section === "string" ? value as AttentionSignal : null;
    case "presented":
    case "viewed":
    case "dismissed":
      return value as AttentionSignal;
  }

  return null;
}

export function validateApertureEvent(value: unknown): ApertureEvent | null {
  if (!isRecord(value) || !validateBaseEvent(value, { semantic: true })) {
    return null;
  }

  switch (value.type) {
    case "task.started":
      return hasShape(value, { title: isString }, { summary: isString })
        ? value as ApertureEvent
        : null;
    case "task.updated":
      return validateTaskUpdatedLike(value)
        ? value as ApertureEvent
        : null;
    case "human.input.requested":
      return validateHumanInputRequestedLike(value, { tone: true, consequence: true })
        ? value as ApertureEvent
        : null;
    case "task.completed":
      return value.summary === undefined || isString(value.summary)
        ? value as ApertureEvent
        : null;
    case "task.cancelled":
      return value.reason === undefined || isString(value.reason)
        ? value as ApertureEvent
        : null;
  }

  return null;
}

export function validateSourceEvent(value: unknown): SourceEvent | null {
  if (!isRecord(value) || !validateBaseEvent(value, { semanticHints: true })) {
    return null;
  }

  switch (value.type) {
    case "task.started":
      return hasShape(value, { title: isString }, { summary: isString })
        ? value as SourceEvent
        : null;
    case "task.updated":
      return validateTaskUpdatedLike(value)
        ? value as SourceEvent
        : null;
    case "human.input.requested":
      return validateHumanInputRequestedLike(value, { riskHint: true })
        ? value as SourceEvent
        : null;
    case "task.completed":
      return value.summary === undefined || isString(value.summary)
        ? value as SourceEvent
        : null;
    case "task.cancelled":
      return value.reason === undefined || isString(value.reason)
        ? value as SourceEvent
        : null;
  }

  return null;
}

export function validateSemanticInterpretation(value: unknown): SemanticInterpretation | null {
  if (
    !isRecord(value)
    || typeof value.intentFrame !== "string"
    || !SEMANTIC_FRAMES.has(value.intentFrame)
    || !Array.isArray(value.factors)
    || !isStringArray(value.factors)
    || !Array.isArray(value.relationHints)
    || !value.relationHints.every((hint) => isRecord(hint) && typeof hint.kind === "string" && RELATION_KINDS.has(hint.kind))
    || typeof value.confidence !== "string"
    || !SEMANTIC_CONFIDENCE.has(value.confidence)
    || !Array.isArray(value.reasons)
    || !isStringArray(value.reasons)
  ) {
    return null;
  }

  if (
    (value.activityClass !== undefined && !SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
    || (value.toolFamily !== undefined && typeof value.toolFamily !== "string")
    || (value.consequence !== undefined && !CONSEQUENCE_LEVELS.has(String(value.consequence)))
    || (value.whyNow !== undefined && typeof value.whyNow !== "string")
    || (value.abstained !== undefined && typeof value.abstained !== "boolean")
  ) {
    return null;
  }

  return value as SemanticInterpretation;
}

function validateSemanticOntologyDiagnostic(
  value: unknown,
): SemanticOntologyDiagnostic | null {
  if (
    !isRecord(value)
    || typeof value.ask !== "string"
    || !SEMANTIC_ONTOLOGY_ASK.has(value.ask)
    || typeof value.activity !== "string"
    || !SEMANTIC_ONTOLOGY_ACTIVITY.has(value.activity)
    || typeof value.blocking !== "string"
    || !SEMANTIC_ONTOLOGY_BLOCKING.has(value.blocking)
    || typeof value.episode !== "string"
    || !SEMANTIC_ONTOLOGY_EPISODE.has(value.episode)
    || typeof value.confidence !== "string"
    || !SEMANTIC_CONFIDENCE.has(value.confidence)
    || typeof value.source !== "string"
    || !SEMANTIC_ONTOLOGY_SOURCE.has(value.source)
    || (value.consequence !== undefined && !CONSEQUENCE_LEVELS.has(String(value.consequence)))
  ) {
    return null;
  }

  return value as SemanticOntologyDiagnostic;
}

function isPartialSemanticOntologyDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.ask === undefined || SEMANTIC_ONTOLOGY_ASK.has(String(value.ask)))
    && (value.activity === undefined || SEMANTIC_ONTOLOGY_ACTIVITY.has(String(value.activity)))
    && (value.consequence === undefined || CONSEQUENCE_LEVELS.has(String(value.consequence)))
    && (value.blocking === undefined || SEMANTIC_ONTOLOGY_BLOCKING.has(String(value.blocking)))
    && (value.episode === undefined || SEMANTIC_ONTOLOGY_EPISODE.has(String(value.episode)))
    && (value.confidence === undefined || SEMANTIC_CONFIDENCE.has(String(value.confidence)))
    && (value.source === undefined || SEMANTIC_ONTOLOGY_SOURCE.has(String(value.source)))
  );
}

function validateReplayScenarioExpectations(value: unknown): ReplayScenarioExpectations | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      finalNowInteractionId: isStringOrNull,
      nextInteractionIds: isStringArray,
      ambientInteractionIds: isStringArray,
      explanationExpectation: isReplayExplanationExpectationGuard,
      traceExpectations: isReplayTraceExpectationGuard,
    })
    || (value.semanticReadings !== undefined && (!Array.isArray(value.semanticReadings) || !value.semanticReadings.every(isReplaySemanticExpectationGuard)))
    || (value.decisionReadings !== undefined && (!Array.isArray(value.decisionReadings) || !value.decisionReadings.every(isReplayDecisionExpectationGuard)))
  ) {
    return null;
  }

  if (value.resultLaneCounts !== undefined) {
    if (
      !isRecord(value.resultLaneCounts)
      || (value.resultLaneCounts.now !== undefined && typeof value.resultLaneCounts.now !== "number")
      || (value.resultLaneCounts.next !== undefined && typeof value.resultLaneCounts.next !== "number")
      || (value.resultLaneCounts.ambient !== undefined && typeof value.resultLaneCounts.ambient !== "number")
    ) {
      return null;
    }
  }

  return value as ReplayScenarioExpectations;
}

function validateReplaySemanticExpectation(value: unknown): ReplaySemanticExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.stepIndex !== undefined && typeof value.stepIndex !== "number")
    || (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || (value.intentFrame !== undefined && !SEMANTIC_FRAMES.has(String(value.intentFrame)))
    || (value.activityClass !== undefined && !SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
    || (value.toolFamily !== undefined && !(value.toolFamily === null || typeof value.toolFamily === "string"))
    || (value.consequence !== undefined && !CONSEQUENCE_LEVELS.has(String(value.consequence)))
    || (value.confidence !== undefined && !SEMANTIC_CONFIDENCE.has(String(value.confidence)))
    || (value.abstained !== undefined && typeof value.abstained !== "boolean")
    || (value.relationKindsInclude !== undefined && !isStringArray(value.relationKindsInclude))
    || (value.relationKindsExact !== undefined && !isStringArray(value.relationKindsExact))
    || (value.whyNowIncludes !== undefined && typeof value.whyNowIncludes !== "string")
    || (value.reasonsInclude !== undefined && !isStringArray(value.reasonsInclude))
    || (value.factorsInclude !== undefined && !isStringArray(value.factorsInclude))
    || (value.provenanceIncludes !== undefined && !isReplaySemanticProvenanceExpectation(value.provenanceIncludes))
    || (value.ontology !== undefined && !isPartialSemanticOntologyDiagnostic(value.ontology))
  ) {
    return null;
  }

  return value as ReplaySemanticExpectation;
}

function validateReplayDecisionExpectation(value: unknown): ReplayDecisionExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.stepIndex !== undefined && typeof value.stepIndex !== "number")
    || (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || (value.evaluationKind !== undefined && !["candidate", "clear", "noop"].includes(String(value.evaluationKind)))
    || (value.decisionKind !== undefined && !DECISION_KINDS.has(String(value.decisionKind)))
    || (value.resultLane !== undefined && !RESULT_BUCKETS.has(String(value.resultLane)))
    || (value.semanticConfidence !== undefined && !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence)))
    || (value.semanticAbstained !== undefined && typeof value.semanticAbstained !== "boolean")
    || (value.semanticInfluenceIncludes !== undefined && !isStringArray(value.semanticInfluenceIncludes))
    || (value.semanticImpactDecisionBearingIncludes !== undefined && !isStringArray(value.semanticImpactDecisionBearingIncludes))
    || (value.semanticImpactExplanatoryIncludes !== undefined && !isStringArray(value.semanticImpactExplanatoryIncludes))
    || (value.ambiguityReason !== undefined && !(value.ambiguityReason === null || value.ambiguityReason === "low_signal" || value.ambiguityReason === "small_score_gap"))
    || (value.ambiguityResolution !== undefined && !(value.ambiguityResolution === null || value.ambiguityResolution === "queue" || value.ambiguityResolution === "ambient"))
  ) {
    return null;
  }

  return value as ReplayDecisionExpectation;
}

function validateReplayExplanationExpectation(value: unknown): ReplayExplanationExpectation | null {
  if (!isRecord(value) || !hasShape(value, {}, {
    whyNowIncludes: isString,
    continuityRationaleIncludes: isStringArray,
  })) {
    return null;
  }

  return value as ReplayExplanationExpectation;
}

function isReplaySemanticProvenanceExpectation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([field, origin]) =>
    SEMANTIC_PROVENANCE_FIELDS.has(field)
    && typeof origin === "string"
    && SEMANTIC_PROVENANCE_KINDS.has(origin),
  );
}

function validateReplayTraceExpectation(value: unknown): ReplayTraceExpectation | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = [
    "ambiguousDecisions",
    "ambiguousNext",
    "ambiguousAmbient",
    "ambiguousLowConfidence",
    "ambiguousAbstained",
    "ambiguousNextThenActivated",
    "ambiguousAmbientThenActivated",
    "actionableEpisodes",
    "actionableSurfaced",
    "actionableActivated",
    "deferredThenActivated",
    "suppressedThenActivated",
    "mergedEpisodeUpdates",
  ] as const;

  for (const key of keys) {
    if (value[key] !== undefined && typeof value[key] !== "number") {
      return null;
    }
  }

  return value as ReplayTraceExpectation;
}

function validateReplayArtifactSource(value: unknown): ReplayArtifactSource | null {
  if (!isRecord(value) || !hasShape(value, { id: isString }, {
    kind: isString,
    label: isString,
    redacted: isBoolean,
  })) {
    return null;
  }

  if (value.capture !== undefined) {
    if (
      !isRecord(value.capture)
      || !hasShape(value.capture, {}, {
        eventTransport: isString,
        semanticCapture: isString,
        responseBridge: isString,
        notes: isStringArray,
      })
    ) {
      return null;
    }
  }

  return value as ReplayArtifactSource;
}

function validateReplayScenarioProvenance(value: unknown): ReplayScenarioProvenance | null {
  if (!isRecord(value) || !hasShape(value, {}, {
    promotedAt: isString,
    promotedFromBundleSessionId: isString,
    promotedFromPath: isString,
  })) {
    return null;
  }

  return value as ReplayScenarioProvenance;
}

function validateReplayDecisionAmbiguity(value: unknown): boolean {
  return (
    value === undefined
    || value === null
    || (
      isRecord(value)
      && value.kind === "interrupt"
      && (value.reason === "low_signal" || value.reason === "small_score_gap")
      && (value.resolution === "queue" || value.resolution === "ambient")
    )
  );
}

function validateSourceRef(value: unknown): unknown | null {
  if (!isRecord(value) || !hasShape(value, { id: isString }, {
    kind: isString,
    label: isString,
  })) {
    return null;
  }

  return value;
}

function validateHumanInputRequest(value: unknown): unknown | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !REQUEST_KINDS.has(value.kind)) {
    return null;
  }

  switch (value.kind) {
    case "approval":
      return value.requireReason === undefined || typeof value.requireReason === "boolean" ? value : null;
    case "choice":
      return typeof value.selectionMode === "string"
        && SELECTION_MODES.has(value.selectionMode)
        && (value.allowTextResponse === undefined || typeof value.allowTextResponse === "boolean")
        && Array.isArray(value.options)
        && value.options.every((option) => isRecord(option) && typeof option.id === "string" && typeof option.label === "string" && (option.summary === undefined || typeof option.summary === "string"))
        ? value
        : null;
    case "form":
      return Array.isArray(value.fields)
        && value.fields.every((field) => (
          isRecord(field)
          && typeof field.id === "string"
          && typeof field.label === "string"
          && typeof field.type === "string"
          && FIELD_TYPES.has(field.type)
          && (field.required === undefined || typeof field.required === "boolean")
          && (field.options === undefined || (Array.isArray(field.options) && field.options.every((option) => isRecord(option) && typeof option.value === "string" && typeof option.label === "string")))
        ))
        ? value
        : null;
  }
}

function validateContext(value: unknown): boolean {
  return isRecord(value)
    && hasShape(value, {}, {
      stage: isString,
      progress: isNumber,
    })
    && (
      value.items === undefined
      || (
        Array.isArray(value.items)
        && value.items.every((item) => isRecord(item) && hasShape(item, {
          id: isString,
          label: isString,
        }, {
          value: isString,
        }))
      )
    );
}

function validateProvenance(value: unknown): boolean {
  return isRecord(value) && hasShape(value, {}, {
    whyNow: isString,
    factors: isStringArray,
  });
}

function validateAttentionFrame(value: unknown): unknown | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.taskId !== "string"
    || typeof value.interactionId !== "string"
    || typeof value.version !== "number"
    || typeof value.mode !== "string"
    || !FRAME_MODES.has(value.mode)
    || typeof value.tone !== "string"
    || !TONES.has(value.tone)
    || typeof value.consequence !== "string"
    || !CONSEQUENCE_LEVELS.has(value.consequence)
    || typeof value.title !== "string"
    || !isRecord(value.timing)
    || typeof value.timing.createdAt !== "string"
    || typeof value.timing.updatedAt !== "string"
  ) {
    return null;
  }

  if (
    (value.summary !== undefined && typeof value.summary !== "string")
    || (value.source !== undefined && validateSourceRef(value.source) === null)
    || (value.context !== undefined && !validateContext(value.context))
    || (value.provenance !== undefined && !validateProvenance(value.provenance))
  ) {
    return null;
  }

  return value;
}

function validateAttentionView(value: unknown): AttentionView | null {
  if (!validateAttentionCollection(value)) {
    return null;
  }

  return value as AttentionView;
}

function validateTaskViewLike(value: unknown): unknown | null {
  if (!validateAttentionCollection(value)) {
    return null;
  }

  return value;
}
