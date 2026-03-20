import type { SourceEvent } from "./source-event.js";
import type { ApertureEvent, HumanInputRequestedEvent } from "./events.js";
import type { AttentionConsequenceLevel, AttentionTone } from "./frame.js";
import { interpretSourceEvent } from "./semantic-interpreter.js";

export function normalizeSourceEvent(event: SourceEvent): ApertureEvent {
  const semantic = interpretSourceEvent(event);

  // Non-human-input source events are intentionally thin for now. The adapter
  // preserves factual state, while core owns the extension point for future
  // semantic enrichment before the attention engine runs.
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

function normalizeHumanInput(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
  semantic = interpretSourceEvent(event),
): HumanInputRequestedEvent {
  const consequence = semantic.consequence ?? event.riskHint ?? "medium";
  const tone = toneForRisk(consequence);
  const factors = [
    ...(event.provenance?.factors ?? []),
    ...semantic.factors,
  ];

  return {
    id: event.id,
    type: event.type,
    taskId: event.taskId,
    interactionId: event.interactionId,
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
    summary: event.summary,
    tone,
    consequence,
    request: event.request,
    ...(event.context !== undefined ? { context: event.context } : {}),
    ...((event.provenance !== undefined || semantic.whyNow !== undefined || factors.length > 0)
      ? {
          provenance: {
            ...(event.provenance ?? {}),
            ...(event.provenance?.whyNow === undefined && semantic.whyNow !== undefined
              ? { whyNow: semantic.whyNow }
              : {}),
            ...(factors.length > 0 ? { factors: dedupeStrings(factors) } : {}),
          },
        }
      : {}),
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
