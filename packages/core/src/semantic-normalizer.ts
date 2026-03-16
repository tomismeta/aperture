import type { SourceEvent } from "./source-event.js";
import type { ApertureEvent, HumanInputRequestedEvent } from "./events.js";
import type { AttentionConsequenceLevel, AttentionTone } from "./frame.js";

export function normalizeSourceEvent(event: SourceEvent): ApertureEvent {
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
      return normalizeHumanInput(event);
  }
}

function normalizeHumanInput(
  event: Extract<SourceEvent, { type: "human.input.requested" }>,
): HumanInputRequestedEvent {
  const consequence = event.riskHint ?? "medium";
  const tone = toneForRisk(consequence);

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
    tone,
    consequence,
    request: event.request,
    ...(event.context !== undefined ? { context: event.context } : {}),
    ...(event.provenance !== undefined ? { provenance: event.provenance } : {}),
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
