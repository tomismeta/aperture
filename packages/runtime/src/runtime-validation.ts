import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";
import {
  assertValidFrameResponse,
  assertValidSourceEvent,
} from "@tomismeta/aperture-core/internal";

export function normalizeSourceEventPayload(payload: unknown): SourceEvent[] {
  if (isRecord(payload) && Array.isArray(payload.events)) {
    const events = payload.events.map((entry, index) => {
      const event = validateSourceEvent(entry);
      if (!event) {
        throw new Error(`Invalid source event payload at index ${index}.`);
      }
      return event;
    });
    if (events.length === 0) {
      throw new Error("Source event payload array must contain at least one event.");
    }
    return events;
  }

  if (isRecord(payload) && "event" in payload) {
    const event = validateSourceEvent(payload.event);
    if (!event) {
      throw new Error("Invalid source event payload.");
    }
    return [event];
  }

  if (Array.isArray(payload)) {
    const events = payload.map((entry, index) => {
      const event = validateSourceEvent(entry);
      if (!event) {
        throw new Error(`Invalid source event payload at index ${index}.`);
      }
      return event;
    });
    if (events.length === 0) {
      throw new Error("Source event payload array must contain at least one event.");
    }
    return events;
  }

  const event = validateSourceEvent(payload);
  if (!event) {
    throw new Error("Invalid source event payload.");
  }
  return [event];
}

export function validateAttentionResponse(value: unknown): AttentionResponse | null {
  if (!isRecord(value)) {
    return null;
  }
  try {
    assertValidFrameResponse(value as AttentionResponse);
    return value as AttentionResponse;
  } catch {
    return null;
  }
}

export function validateOperatorEngagement(
  value: unknown,
): { taskId: string; interactionId: string; durationMs?: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.taskId !== "string" || typeof value.interactionId !== "string") {
    return null;
  }

  if (
    value.durationMs !== undefined &&
    (typeof value.durationMs !== "number" ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs <= 0)
  ) {
    return null;
  }

  return {
    taskId: value.taskId,
    interactionId: value.interactionId,
    ...(value.durationMs !== undefined ? { durationMs: value.durationMs } : {}),
  };
}

function validateSourceEvent(value: unknown): SourceEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  try {
    assertValidSourceEvent(value as SourceEvent);
    return value as SourceEvent;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
