import type { AttentionView } from "@tomismeta/aperture-core";
import type { SemanticOntologyDiagnostic } from "@tomismeta/aperture-core/semantic";

import { hasShape, isNumber, isNullable, isRecord, isString, isStringArray } from "./shape.js";

export const EVENT_TYPES = new Set<string>([
  "task.started",
  "task.updated",
  "human.input.requested",
  "task.completed",
  "task.cancelled",
]);

export const STEP_KINDS = new Set<string>([
  "publish",
  "publishSource",
  "submit",
  "signal",
  "markViewed",
  "markTimedOut",
  "markContextExpanded",
  "markContextSkipped",
]);

export const SIGNAL_KINDS = new Set<string>([
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

export const RESPONSE_KINDS = new Set<string>([
  "acknowledged",
  "approved",
  "rejected",
  "option_selected",
  "text_submitted",
  "form_submitted",
  "dismissed",
]);

export const TRACE_EVALUATION_KINDS = new Set<string>(["noop", "clear", "candidate"]);

export const RESULT_BUCKETS = new Set(["now", "next", "ambient", "none"]);
export const DECISION_KINDS = new Set(["auto_approve", "activate", "queue", "ambient", "clear"]);
export const FRAME_MODES = new Set(["status", "approval", "choice", "form"]);
export const TONES = new Set(["ambient", "focused", "critical"]);
export const CONSEQUENCE_LEVELS = new Set(["low", "medium", "high"]);
export const TASK_STATUSES = new Set(["running", "blocked", "waiting", "completed", "failed"]);
export const REQUEST_KINDS = new Set(["approval", "choice", "form"]);
export const SELECTION_MODES = new Set(["single", "multiple"]);
export const FIELD_TYPES = new Set(["text", "textarea", "number", "select", "boolean"]);
export const SIGNAL_RESPONSE_KINDS = new Set([
  "acknowledged",
  "approved",
  "rejected",
  "option_selected",
  "text_submitted",
  "form_submitted",
]);
export const DEFERRED_REASONS = new Set(["next", "suppressed", "manual"]);
export const RETURNED_FROM = new Set(["next", "ambient"]);
export const SEMANTIC_CONFIDENCE = new Set(["low", "medium", "high"]);
export const SEMANTIC_FRAMES = new Set([
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
export const SEMANTIC_ACTIVITY_CLASSES = new Set([
  "permission_request",
  "question_request",
  "follow_up",
  "tool_completion",
  "tool_failure",
  "session_status",
  "status_update",
]);
export const SEMANTIC_ONTOLOGY_ASK = new Set(["approval", "choice", "form", "status", "none"]);
export const SEMANTIC_ONTOLOGY_ACTIVITY = new Set([
  "decision_request",
  "question",
  "task_progress",
  "task_completion",
  "failure",
  "background_work",
]);
export const SEMANTIC_ONTOLOGY_BLOCKING = new Set(["blocking", "waiting", "non_blocking"]);
export const SEMANTIC_ONTOLOGY_EPISODE = new Set([
  "new",
  "same_issue",
  "resurfaced",
  "resolved",
  "unknown",
]);
export const SEMANTIC_ONTOLOGY_SOURCE = new Set(["explicit", "hinted", "inferred"]);
export const RELATION_KINDS = new Set([
  "same_issue",
  "resolves",
  "supersedes",
  "repeats",
  "escalates",
]);
export const SEMANTIC_PROVENANCE_FIELDS = new Set([
  "intentFrame",
  "activityClass",
  "toolFamily",
  "consequence",
  "whyNow",
  "relationHints",
  "confidence",
  "abstained",
]);
export const SEMANTIC_PROVENANCE_KINDS = new Set(["source", "inferred", "hint"]);

export const isStringOrNull = isNullable(isString);

export function validateSemanticOntologyDiagnostic(
  value: unknown,
): SemanticOntologyDiagnostic | null {
  if (
    !isRecord(value) ||
    typeof value.ask !== "string" ||
    !SEMANTIC_ONTOLOGY_ASK.has(value.ask) ||
    typeof value.activity !== "string" ||
    !SEMANTIC_ONTOLOGY_ACTIVITY.has(value.activity) ||
    typeof value.blocking !== "string" ||
    !SEMANTIC_ONTOLOGY_BLOCKING.has(value.blocking) ||
    typeof value.episode !== "string" ||
    !SEMANTIC_ONTOLOGY_EPISODE.has(value.episode) ||
    typeof value.confidence !== "string" ||
    !SEMANTIC_CONFIDENCE.has(value.confidence) ||
    typeof value.source !== "string" ||
    !SEMANTIC_ONTOLOGY_SOURCE.has(value.source) ||
    (value.consequence !== undefined && !CONSEQUENCE_LEVELS.has(String(value.consequence)))
  ) {
    return null;
  }

  return value as SemanticOntologyDiagnostic;
}

export function isPartialSemanticOntologyDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.ask === undefined || SEMANTIC_ONTOLOGY_ASK.has(String(value.ask))) &&
    (value.activity === undefined || SEMANTIC_ONTOLOGY_ACTIVITY.has(String(value.activity))) &&
    (value.consequence === undefined || CONSEQUENCE_LEVELS.has(String(value.consequence))) &&
    (value.blocking === undefined || SEMANTIC_ONTOLOGY_BLOCKING.has(String(value.blocking))) &&
    (value.episode === undefined || SEMANTIC_ONTOLOGY_EPISODE.has(String(value.episode))) &&
    (value.confidence === undefined || SEMANTIC_CONFIDENCE.has(String(value.confidence))) &&
    (value.source === undefined || SEMANTIC_ONTOLOGY_SOURCE.has(String(value.source)))
  );
}

export function validateSourceRef(value: unknown): unknown | null {
  if (!isRecord(value) || !hasShape(value, { id: isString }, { kind: isString, label: isString })) {
    return null;
  }

  return value;
}

export function validateHumanInputRequest(value: unknown): unknown | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !REQUEST_KINDS.has(value.kind)) {
    return null;
  }

  switch (value.kind) {
    case "approval":
      return value.requireReason === undefined || typeof value.requireReason === "boolean"
        ? value
        : null;
    case "choice":
      return typeof value.selectionMode === "string" &&
        SELECTION_MODES.has(value.selectionMode) &&
        (value.allowTextResponse === undefined || typeof value.allowTextResponse === "boolean") &&
        Array.isArray(value.options) &&
        value.options.every(
          (option) =>
            isRecord(option) &&
            typeof option.id === "string" &&
            typeof option.label === "string" &&
            (option.summary === undefined || typeof option.summary === "string"),
        )
        ? value
        : null;
    case "form":
      return Array.isArray(value.fields) &&
        value.fields.every(
          (field) =>
            isRecord(field) &&
            typeof field.id === "string" &&
            typeof field.label === "string" &&
            typeof field.type === "string" &&
            FIELD_TYPES.has(field.type) &&
            (field.required === undefined || typeof field.required === "boolean") &&
            (field.options === undefined ||
              (Array.isArray(field.options) &&
                field.options.every(
                  (option) =>
                    isRecord(option) &&
                    typeof option.value === "string" &&
                    typeof option.label === "string",
                ))),
        )
        ? value
        : null;
  }
}

export function validateContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasShape(value, {}, { stage: isString, progress: isNumber }) &&
    (value.items === undefined ||
      (Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isRecord(item) &&
            hasShape(item, { id: isString, label: isString }, { value: isString }),
        )))
  );
}

export function validateProvenance(value: unknown): boolean {
  return isRecord(value) && hasShape(value, {}, { whyNow: isString, factors: isStringArray });
}

export function validateAttentionFrame(value: unknown): unknown | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.taskId !== "string" ||
    typeof value.interactionId !== "string" ||
    typeof value.version !== "number" ||
    typeof value.mode !== "string" ||
    !FRAME_MODES.has(value.mode) ||
    typeof value.tone !== "string" ||
    !TONES.has(value.tone) ||
    typeof value.consequence !== "string" ||
    !CONSEQUENCE_LEVELS.has(value.consequence) ||
    typeof value.title !== "string" ||
    !isRecord(value.timing) ||
    typeof value.timing.createdAt !== "string" ||
    typeof value.timing.updatedAt !== "string"
  ) {
    return null;
  }

  if (
    (value.summary !== undefined && typeof value.summary !== "string") ||
    (value.source !== undefined && validateSourceRef(value.source) === null) ||
    (value.context !== undefined && !validateContext(value.context)) ||
    (value.provenance !== undefined && !validateProvenance(value.provenance))
  ) {
    return null;
  }

  return value;
}

function validateAttentionCollection(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.next) &&
    Array.isArray(value.ambient) &&
    (value.now === null || validateAttentionFrame(value.now) !== null) &&
    value.next.every((entry) => validateAttentionFrame(entry) !== null) &&
    value.ambient.every((entry) => validateAttentionFrame(entry) !== null)
  );
}

export function validateAttentionView(value: unknown): AttentionView | null {
  if (!validateAttentionCollection(value)) {
    return null;
  }

  return value as AttentionView;
}

export function validateTaskViewLike(value: unknown): unknown | null {
  if (!validateAttentionCollection(value)) {
    return null;
  }

  return value;
}
