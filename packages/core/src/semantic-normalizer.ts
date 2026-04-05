import type { SourceEvent } from "./source-event.js";
import type { ApertureEvent, HumanInputRequestedEvent } from "./events.js";
import type { AttentionConsequenceLevel, AttentionTone } from "./frame.js";
import { interpretSourceEvent } from "./semantic-interpreter.js";
import { mergeSemanticProvenance } from "./semantic-provenance.js";

export function normalizeSourceEvent(event: SourceEvent): ApertureEvent {
  const semantic = interpretSourceEvent(event);

  // Non-human-input source events stay intentionally bounded. Core enriches
  // tool family, activity class, provenance, and relation semantics here, but
  // task status remains the authoritative routing signal for status events.
  switch (event.type) {
    case "task.started":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        semantic,
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.updated":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.toolFamily !== undefined
          ? { toolFamily: event.toolFamily }
          : semantic.toolFamily !== undefined
            ? { toolFamily: semantic.toolFamily }
            : {}),
        ...(event.activityClass !== undefined
          ? { activityClass: event.activityClass }
          : semantic.activityClass !== undefined
            ? { activityClass: semantic.activityClass }
            : {}),
        semantic,
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
        status: event.status,
        ...(event.progress !== undefined ? { progress: event.progress } : {}),
      };
    case "task.completed":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        semantic,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.cancelled":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        semantic,
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
      };
    case "human.input.requested":
      return normalizeHumanInput(event, semantic);
  }
}

export type ApertureEventSemanticDefaultsOptions = {
  skipSemanticDefaults?: boolean;
};

/**
 * Applies the same bounded semantic-defaulting rules Aperture uses on source
 * events to a direct `ApertureEvent` publish path.
 *
 * This keeps `publish(ApertureEvent)` closer to the mental model by ensuring
 * the semantic layer is present by default, while still preserving explicit
 * caller-owned canonical fields unless they are missing.
 */
export function applySemanticDefaultsToApertureEvent(
  event: ApertureEvent,
  options: ApertureEventSemanticDefaultsOptions = {},
): ApertureEvent {
  if (options.skipSemanticDefaults) {
    return event;
  }

  const semantic = event.semantic ?? interpretSourceEvent(asSourceEvent(event));

  switch (event.type) {
    case "task.started":
      return {
        ...event,
        semantic,
      };
    case "task.updated":
      return {
        ...event,
        ...(event.activityClass === undefined && semantic.activityClass !== undefined
          ? { activityClass: semantic.activityClass }
          : {}),
        semantic,
      };
    case "task.completed":
    case "task.cancelled":
      return {
        ...event,
        semantic,
      };
    case "human.input.requested":
      return applyHumanInputSemanticDefaults(event, semantic);
  }
}

function normalizeHumanInput(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
  semantic: ReturnType<typeof interpretSourceEvent>,
): HumanInputRequestedEvent {
  const consequence = semantic.consequence ?? event.riskHint ?? "medium";
  const tone = toneForRisk(consequence);
  const provenance = mergeSemanticProvenance({
    base: event.provenance,
    semantic,
  });
  const toolFamily =
    event.request.kind === "approval"
      ? event.toolFamily ?? semantic.toolFamily
      : undefined;

  return {
    id: event.id,
    type: event.type,
    taskId: event.taskId,
    interactionId: event.interactionId,
    timestamp: event.timestamp,
    ...(event.source !== undefined ? { source: event.source } : {}),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...(event.activityClass !== undefined
      ? { activityClass: event.activityClass }
      : semantic.activityClass !== undefined
        ? { activityClass: semantic.activityClass }
        : {}),
    semantic,
    title: event.title,
    summary: event.summary,
    tone,
    consequence,
    request: event.request,
    ...(event.context !== undefined ? { context: event.context } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

function toneForRisk(risk: AttentionConsequenceLevel): AttentionTone {
  switch (risk) {
    case "high":
      return "critical";
    case "medium":
    case "low":
      return "focused";
  }
}

function applyHumanInputSemanticDefaults(
  event: Extract<ApertureEvent, { type: "human.input.requested" }>,
  semantic: ReturnType<typeof interpretSourceEvent>,
): HumanInputRequestedEvent {
  const consequence = event.consequence ?? semantic.consequence ?? "medium";
  const tone = event.tone ?? toneForRisk(consequence);
  const provenance = mergeSemanticProvenance({
    base: event.provenance,
    semantic,
  });
  const toolFamily = event.toolFamily ?? (
    event.request.kind === "approval"
      ? semantic.toolFamily
      : undefined
  );

  return {
    ...event,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...(event.activityClass === undefined && semantic.activityClass !== undefined
      ? { activityClass: semantic.activityClass }
      : {}),
    semantic,
    tone,
    consequence,
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

function asSourceEvent(event: ApertureEvent): SourceEvent {
  switch (event.type) {
    case "task.started":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.updated":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
        status: event.status,
        ...(event.progress !== undefined ? { progress: event.progress } : {}),
      };
    case "task.completed":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.cancelled":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
      };
    case "human.input.requested":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        interactionId: event.interactionId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        summary: event.summary,
        request: event.request,
        ...(event.context !== undefined ? { context: event.context } : {}),
        ...(event.consequence !== undefined ? { riskHint: event.consequence } : {}),
      };
  }
}
