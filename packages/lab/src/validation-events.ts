import type {
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type { ApertureTrace } from "@tomismeta/aperture-core/internal";
import type { SemanticInterpretation } from "@tomismeta/aperture-core/semantic";

import {
  hasShape,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";
import {
  DECISION_KINDS,
  CONSEQUENCE_LEVELS,
  DEFERRED_REASONS,
  EVENT_TYPES,
  RELATION_KINDS,
  RESPONSE_KINDS,
  RESULT_BUCKETS,
  RETURNED_FROM,
  SEMANTIC_ACTIVITY_CLASSES,
  SEMANTIC_CONFIDENCE,
  SEMANTIC_FRAMES,
  SIGNAL_KINDS,
  SIGNAL_RESPONSE_KINDS,
  TASK_STATUSES,
  TONES,
  TRACE_EVALUATION_KINDS,
  validateAttentionView,
  validateContext,
  validateHumanInputRequest,
  validateProvenance,
  validateSourceRef,
  validateTaskViewLike,
} from "./validation-support.js";

const isSourceRefGuard = validateWith(validateSourceRef);
const isHumanInputRequestGuard = validateWith(validateHumanInputRequest);
const isContextGuard = validateWith(validateContext);
const isProvenanceGuard = validateWith(validateProvenance);
const isSemanticInterpretationGuard = validateWith(validateSemanticInterpretation);
const isActivityClass = (value: unknown): boolean => value === undefined || SEMANTIC_ACTIVITY_CLASSES.has(String(value));

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
    && EVENT_TYPES.has(String(value.type))
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

export function validateApertureTrace(value: unknown): ApertureTrace | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.timestamp !== "string"
    || validateApertureEvent(value.event) === null
    || !isRecord(value.evaluation)
    || typeof value.evaluation.kind !== "string"
    || !TRACE_EVALUATION_KINDS.has(value.evaluation.kind)
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
  if (
    !isRecord(value)
    || typeof value.taskId !== "string"
    || typeof value.interactionId !== "string"
    || !isRecord(value.response)
  ) {
    return null;
  }

  const kind = value.response.kind;
  if (typeof kind !== "string" || !RESPONSE_KINDS.has(kind)) {
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
    || !SIGNAL_KINDS.has(value.kind)
  ) {
    return null;
  }

  switch (value.kind) {
    case "responded":
      return typeof value.responseKind === "string" && SIGNAL_RESPONSE_KINDS.has(value.responseKind)
        ? value as AttentionSignal
        : null;
    case "deferred":
      return value.reason === undefined || (typeof value.reason === "string" && DEFERRED_REASONS.has(value.reason))
        ? value as AttentionSignal
        : null;
    case "timed_out":
      return value.timeoutMs === undefined || typeof value.timeoutMs === "number"
        ? value as AttentionSignal
        : null;
    case "returned":
      return typeof value.from === "string" && RETURNED_FROM.has(value.from)
        ? value as AttentionSignal
        : null;
    case "attention_shifted":
      return typeof value.fromInteractionId === "string" && typeof value.toInteractionId === "string"
        ? value as AttentionSignal
        : null;
    case "context_expanded":
    case "context_skipped":
      return value.section === undefined || typeof value.section === "string"
        ? value as AttentionSignal
        : null;
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
