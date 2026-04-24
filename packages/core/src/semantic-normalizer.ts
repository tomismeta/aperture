import type { SourceEvent } from "./source-event.js";
import type {
  ApertureEvent,
  EnrichedApertureEvent,
  EnrichedHumanInputRequestedEvent,
} from "./events.js";
import type { AttentionConsequenceLevel, AttentionTone } from "./frame.js";
import { interpretSourceEvent } from "./semantic-interpreter.js";
import { mergeSemanticProvenance } from "./semantic-provenance.js";

export function normalizeSourceEvent(event: SourceEvent): EnrichedApertureEvent {
  const semantic = interpretSourceEvent(event);
  const defaultsOptions =
    event.type === "human.input.requested" && event.riskHint !== undefined
      ? { riskHint: event.riskHint }
      : undefined;

  return applySemanticDefaults(
    prepareApertureEventFromSourceEvent(event),
    semantic,
    defaultsOptions,
  );
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
export function enrichApertureEvent(event: ApertureEvent): EnrichedApertureEvent;
export function enrichApertureEvent(
  event: ApertureEvent,
  options: { skipSemanticDefaults: true },
): ApertureEvent;
export function enrichApertureEvent(
  event: ApertureEvent,
  options: ApertureEventSemanticDefaultsOptions = {},
): ApertureEvent {
  if (options.skipSemanticDefaults) {
    return event;
  }

  const semantic = event.semantic ?? interpretSourceEvent(asSourceEvent(event));

  return applySemanticDefaults(event, semantic);
}

function toneForRisk(risk: AttentionConsequenceLevel): AttentionTone {
  switch (risk) {
    case "high":
      return "critical";
    case "medium":
    case "low":
      return "focused";
    default:
      return unreachableConsequenceLevel(risk);
  }
}

type SemanticDefaultsOptions = {
  riskHint?: AttentionConsequenceLevel;
};

function applySemanticDefaults(
  event: ApertureEvent,
  semantic: ReturnType<typeof interpretSourceEvent>,
  options: SemanticDefaultsOptions = {},
): EnrichedApertureEvent {
  // Both ingress paths narrow onto this same bounded defaulting layer:
  //
  // SourceEvent -> canonical ApertureEvent -> applySemanticDefaults
  // ApertureEvent -> applySemanticDefaults
  //
  // That keeps consequence, tone, tool-family, activity-class, and provenance
  // rules defined in one place instead of drifting across source-vs-direct code.
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
      return applyHumanInputSemanticDefaults(event, semantic, options);
    default:
      return unreachableApertureEvent(event);
  }
}

function applyHumanInputSemanticDefaults(
  event: Extract<ApertureEvent, { type: "human.input.requested" }>,
  semantic: ReturnType<typeof interpretSourceEvent>,
  options: SemanticDefaultsOptions,
): EnrichedHumanInputRequestedEvent {
  const { toolFamily: _rawToolFamily, ...eventWithoutToolFamily } = event;
  const consequence = event.consequence ?? semantic.consequence ?? options.riskHint ?? "medium";
  const tone = event.tone ?? toneForRisk(consequence);
  const provenance = mergeSemanticProvenance({
    base: event.provenance,
    semantic,
  });
  const toolFamily =
    event.request.kind === "approval" ? (event.toolFamily ?? semantic.toolFamily) : undefined;

  return {
    ...eventWithoutToolFamily,
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

function prepareApertureEventFromSourceEvent(event: SourceEvent): ApertureEvent {
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
        status: event.status,
        ...(event.progress !== undefined ? { progress: event.progress } : {}),
        ...(event.context !== undefined ? { context: event.context } : {}),
      };
    case "task.completed":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.cancelled":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        summary: event.summary,
        request: event.request,
        ...(event.context !== undefined ? { context: event.context } : {}),
        ...(event.provenance !== undefined ? { provenance: event.provenance } : {}),
      };
    default:
      return unreachableSourceEvent(event);
  }
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
        status: event.status,
        ...(event.progress !== undefined ? { progress: event.progress } : {}),
        ...(event.context !== undefined ? { context: event.context } : {}),
      };
    case "task.completed":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.summary !== undefined ? { summary: event.summary } : {}),
      };
    case "task.cancelled":
      return {
        id: event.id,
        type: event.type,
        taskId: event.taskId,
        timestamp: event.timestamp,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
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
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
        ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
        title: event.title,
        summary: event.summary,
        request: event.request,
        ...(event.context !== undefined ? { context: event.context } : {}),
        ...(event.consequence !== undefined ? { riskHint: event.consequence } : {}),
      };
    default:
      return unreachableApertureEvent(event);
  }
}

function unreachableApertureEvent(event: never): never {
  throw new Error(`Unhandled ApertureEvent in semantic normalizer: ${JSON.stringify(event)}`);
}

function unreachableSourceEvent(event: never): never {
  throw new Error(`Unhandled SourceEvent in semantic normalizer: ${JSON.stringify(event)}`);
}

function unreachableConsequenceLevel(level: never): never {
  throw new Error(`Unhandled consequence level in semantic normalizer: ${level}`);
}
