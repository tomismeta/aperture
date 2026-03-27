import type {
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type { SemanticInterpretation } from "@tomismeta/aperture-core/semantic";
import type { ApertureTrace } from "../../core/src/trace.js";

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

type UnknownRecord = Record<string, unknown>;

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

const RESULT_BUCKETS = new Set(["active", "queued", "ambient", "none"]);
const DECISION_KINDS = new Set(["auto_approve", "activate", "queue", "ambient", "clear"]);
const FRAME_MODES = new Set(["status", "approval", "choice", "form"]);
const TONES = new Set(["ambient", "focused", "critical"]);
const CONSEQUENCE_LEVELS = new Set(["low", "medium", "high"]);
const TASK_STATUSES = new Set(["running", "blocked", "waiting", "completed", "failed"]);
const REQUEST_KINDS = new Set(["approval", "choice", "form"]);
const SELECTION_MODES = new Set(["single", "multiple"]);
const FIELD_TYPES = new Set(["text", "textarea", "number", "select", "boolean"]);
const SIGNAL_RESPONSE_KINDS = new Set(["acknowledged", "approved", "rejected", "option_selected", "text_submitted", "form_submitted"]);
const DEFERRED_REASONS = new Set(["queued", "suppressed", "manual"]);
const RETURNED_FROM = new Set(["queued", "ambient"]);
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

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validateReplayScenario(value: unknown): ReplayScenario | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string"
    || typeof value.title !== "string"
    || !Array.isArray(value.steps)
    || !value.steps.every((step) => validateReplayObservationStep(step) !== null)
  ) {
    return null;
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    return null;
  }

  if (value.doctrineTags !== undefined && !isStringArray(value.doctrineTags)) {
    return null;
  }

  if (value.source !== undefined && validateReplayArtifactSource(value.source) === null) {
    return null;
  }

  if (value.provenance !== undefined && validateReplayScenarioProvenance(value.provenance) === null) {
    return null;
  }

  if (value.expectations !== undefined && validateReplayScenarioExpectations(value.expectations) === null) {
    return null;
  }

  if (value.core !== undefined && !isRecord(value.core)) {
    return null;
  }

  return value as ReplayScenario;
}

export function validateReplayObservationStep(value: unknown): ReplayObservationStep | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !STEP_KINDS.has(value.kind as ReplayObservationStep["kind"])) {
    return null;
  }

  if (value.label !== undefined && typeof value.label !== "string") {
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
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.stepIndex !== "number"
    || typeof value.stepKind !== "string"
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || !(value.activeInteractionId === null || typeof value.activeInteractionId === "string")
    || !isStringArray(value.queuedInteractionIds)
    || !isStringArray(value.ambientInteractionIds)
    || validateAttentionView(value.attentionView) === null
  ) {
    return null;
  }

  return value as ReplayViewSnapshot;
}

export function validateReplaySemanticSnapshot(value: unknown): ReplaySemanticSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.stepIndex !== "number"
    || typeof value.stepKind !== "string"
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || validateSemanticInterpretation(value.interpretation) === null
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
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.stepIndex !== "number"
    || typeof value.stepKind !== "string"
    || !STEP_KINDS.has(value.stepKind as ReplayObservationStep["kind"])
    || (value.stepLabel !== undefined && typeof value.stepLabel !== "string")
    || !["candidate", "clear", "noop"].includes(String(value.evaluationKind))
    || (value.decisionKind !== undefined && !DECISION_KINDS.has(String(value.decisionKind)))
    || (value.resultBucket !== undefined && !RESULT_BUCKETS.has(String(value.resultBucket)))
    || (value.interactionId !== undefined && typeof value.interactionId !== "string")
    || (value.semanticConfidence !== undefined && !SEMANTIC_CONFIDENCE.has(String(value.semanticConfidence)))
    || (value.semanticAbstained !== undefined && typeof value.semanticAbstained !== "boolean")
    || !validateReplayDecisionAmbiguity(value.ambiguity)
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
      || !RESULT_BUCKETS.has(String(value.coordination.resultBucket))
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
  if (!isRecord(value) || typeof value.type !== "string" || !EVENT_TYPES.has(value.type as ApertureEvent["type"])) {
    return null;
  }

  if (
    typeof value.id !== "string"
    || typeof value.taskId !== "string"
    || typeof value.timestamp !== "string"
    || (value.source !== undefined && validateSourceRef(value.source) === null)
    || (value.semantic !== undefined && validateSemanticInterpretation(value.semantic) === null)
  ) {
    return null;
  }

  switch (value.type) {
    case "task.started":
      return typeof value.title === "string" && (value.summary === undefined || typeof value.summary === "string")
        ? value as ApertureEvent
        : null;
    case "task.updated":
      return typeof value.title === "string"
        && (value.summary === undefined || typeof value.summary === "string")
        && typeof value.status === "string"
        && TASK_STATUSES.has(value.status)
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
        && (value.progress === undefined || typeof value.progress === "number")
        ? value as ApertureEvent
        : null;
    case "human.input.requested":
      return typeof value.interactionId === "string"
        && typeof value.title === "string"
        && typeof value.summary === "string"
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
        && (value.tone === undefined || TONES.has(String(value.tone)))
        && (value.consequence === undefined || CONSEQUENCE_LEVELS.has(String(value.consequence)))
        && validateHumanInputRequest(value.request) !== null
        && (value.context === undefined || validateContext(value.context))
        && (value.provenance === undefined || validateProvenance(value.provenance))
        ? value as ApertureEvent
        : null;
    case "task.completed":
      return value.summary === undefined || typeof value.summary === "string"
        ? value as ApertureEvent
        : null;
    case "task.cancelled":
      return value.reason === undefined || typeof value.reason === "string"
        ? value as ApertureEvent
        : null;
  }

  return null;
}

export function validateSourceEvent(value: unknown): SourceEvent | null {
  if (!isRecord(value) || typeof value.type !== "string" || !EVENT_TYPES.has(value.type as SourceEvent["type"])) {
    return null;
  }

  if (
    typeof value.id !== "string"
    || typeof value.taskId !== "string"
    || typeof value.timestamp !== "string"
    || (value.source !== undefined && validateSourceRef(value.source) === null)
    || (value.semanticHints !== undefined && !isRecord(value.semanticHints))
  ) {
    return null;
  }

  switch (value.type) {
    case "task.started":
      return typeof value.title === "string" && (value.summary === undefined || typeof value.summary === "string")
        ? value as SourceEvent
        : null;
    case "task.updated":
      return typeof value.title === "string"
        && (value.summary === undefined || typeof value.summary === "string")
        && typeof value.status === "string"
        && TASK_STATUSES.has(value.status)
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
        && (value.progress === undefined || typeof value.progress === "number")
        ? value as SourceEvent
        : null;
    case "human.input.requested":
      return typeof value.interactionId === "string"
        && typeof value.title === "string"
        && typeof value.summary === "string"
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value.activityClass)))
        && validateHumanInputRequest(value.request) !== null
        && (value.context === undefined || validateContext(value.context))
        && (value.provenance === undefined || validateProvenance(value.provenance))
        && (value.riskHint === undefined || CONSEQUENCE_LEVELS.has(String(value.riskHint)))
        ? value as SourceEvent
        : null;
    case "task.completed":
      return value.summary === undefined || typeof value.summary === "string"
        ? value as SourceEvent
        : null;
    case "task.cancelled":
      return value.reason === undefined || typeof value.reason === "string"
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

function validateReplayScenarioExpectations(value: unknown): ReplayScenarioExpectations | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.finalActiveInteractionId !== undefined && !(value.finalActiveInteractionId === null || typeof value.finalActiveInteractionId === "string"))
    || (value.queuedInteractionIds !== undefined && !isStringArray(value.queuedInteractionIds))
    || (value.ambientInteractionIds !== undefined && !isStringArray(value.ambientInteractionIds))
    || (value.semanticReadings !== undefined && (!Array.isArray(value.semanticReadings) || !value.semanticReadings.every((entry) => validateReplaySemanticExpectation(entry) !== null)))
    || (value.decisionReadings !== undefined && (!Array.isArray(value.decisionReadings) || !value.decisionReadings.every((entry) => validateReplayDecisionExpectation(entry) !== null)))
    || (value.explanationExpectation !== undefined && validateReplayExplanationExpectation(value.explanationExpectation) === null)
    || (value.traceExpectations !== undefined && validateReplayTraceExpectation(value.traceExpectations) === null)
  ) {
    return null;
  }

  if (value.resultBucketCounts !== undefined) {
    if (
      !isRecord(value.resultBucketCounts)
      || (value.resultBucketCounts.active !== undefined && typeof value.resultBucketCounts.active !== "number")
      || (value.resultBucketCounts.queued !== undefined && typeof value.resultBucketCounts.queued !== "number")
      || (value.resultBucketCounts.ambient !== undefined && typeof value.resultBucketCounts.ambient !== "number")
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
    || (value.resultBucket !== undefined && !RESULT_BUCKETS.has(String(value.resultBucket)))
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
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.whyNowIncludes !== undefined && typeof value.whyNowIncludes !== "string")
    || (value.continuityRationaleIncludes !== undefined && !isStringArray(value.continuityRationaleIncludes))
  ) {
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
    "ambiguousQueued",
    "ambiguousAmbient",
    "ambiguousLowConfidence",
    "ambiguousAbstained",
    "ambiguousQueuedThenActivated",
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
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  if (
    (value.kind !== undefined && typeof value.kind !== "string")
    || (value.label !== undefined && typeof value.label !== "string")
    || (value.redacted !== undefined && typeof value.redacted !== "boolean")
  ) {
    return null;
  }

  if (value.capture !== undefined) {
    if (
      !isRecord(value.capture)
      || (value.capture.eventTransport !== undefined && typeof value.capture.eventTransport !== "string")
      || (value.capture.semanticCapture !== undefined && typeof value.capture.semanticCapture !== "string")
      || (value.capture.responseBridge !== undefined && typeof value.capture.responseBridge !== "string")
      || (value.capture.notes !== undefined && !isStringArray(value.capture.notes))
    ) {
      return null;
    }
  }

  return value as ReplayArtifactSource;
}

function validateReplayScenarioProvenance(value: unknown): ReplayScenarioProvenance | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.promotedAt !== undefined && typeof value.promotedAt !== "string")
    || (value.promotedFromBundleSessionId !== undefined && typeof value.promotedFromBundleSessionId !== "string")
    || (value.promotedFromPath !== undefined && typeof value.promotedFromPath !== "string")
  ) {
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
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  if (
    (value.kind !== undefined && typeof value.kind !== "string")
    || (value.label !== undefined && typeof value.label !== "string")
  ) {
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
  return (
    isRecord(value)
    && (value.stage === undefined || typeof value.stage === "string")
    && (value.progress === undefined || typeof value.progress === "number")
    && (
      value.items === undefined
      || (
        Array.isArray(value.items)
        && value.items.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.label === "string" && (item.value === undefined || typeof item.value === "string"))
      )
    )
  );
}

function validateProvenance(value: unknown): boolean {
  return (
    isRecord(value)
    && (value.whyNow === undefined || typeof value.whyNow === "string")
    && (value.factors === undefined || isStringArray(value.factors))
  );
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
  if (
    !isRecord(value)
    || !Array.isArray(value.queued)
    || !Array.isArray(value.ambient)
    || !(value.active === null || validateAttentionFrame(value.active) !== null)
    || !value.queued.every((frame) => validateAttentionFrame(frame) !== null)
    || !value.ambient.every((frame) => validateAttentionFrame(frame) !== null)
  ) {
    return null;
  }

  return value as AttentionView;
}

function validateTaskViewLike(value: unknown): unknown | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.queued)
    || !Array.isArray(value.ambient)
    || !(value.active === null || validateAttentionFrame(value.active) !== null)
    || !value.queued.every((frame) => validateAttentionFrame(frame) !== null)
    || !value.ambient.every((frame) => validateAttentionFrame(frame) !== null)
  ) {
    return null;
  }

  return value;
}
