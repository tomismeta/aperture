import { createHash } from "node:crypto";

import type { SourceEvent, SourceHumanInputRequestedEvent } from "@tomismeta/aperture-core";

import type { OmpAttentionEvent } from "../omp-attention-event.js";
import type { ApertureSurfaceNavigation } from "../surface/protocol.js";

export type MappedOmpDirectEvent =
  | {
      kind: "upsert";
      key: string;
      taskId: string;
      interactionId: string;
      occurredAt: string;
      displayTitle: string;
      navigation: ApertureSurfaceNavigation;
      sourceEvent: SourceEvent;
    }
  | {
      kind: "resolve";
      key: string;
      eventId: string;
      occurredAt: string;
    }
  | {
      kind: "shutdown";
      sessionId: string;
      eventId: string;
      occurredAt: string;
    };

export function mapOmpDirectEvent(event: OmpAttentionEvent): MappedOmpDirectEvent {
  if (event.classification === "session_shutdown") {
    return {
      kind: "shutdown",
      sessionId: event.sessionId,
      eventId: boundedEventId(event.eventId),
      occurredAt: event.occurredAt,
    };
  }

  const interactionIdentity =
    event.interactionId ?? event.turnId ?? `${event.classification}:${event.eventId}`;
  const family = interactionFamily(event.classification);
  const key = directKey(event.sessionId, family, interactionIdentity);
  if (event.classification === "approval_resolved" || event.classification === "input_resolved") {
    return {
      kind: "resolve",
      key,
      eventId: boundedEventId(event.eventId),
      occurredAt: event.occurredAt,
    };
  }

  const taskId = `omp-direct:${digest(key, 32)}`;
  const interactionId = `interaction:${taskId}:attention`;
  const source = {
    id: `omp:${digest(event.sessionId, 32)}`,
    kind: "omp" as const,
    label: "OMP",
  };
  const metadata = {
    ompDirect: {
      classification: event.classification,
      sessionId: event.sessionId,
    },
  };
  const base = {
    id: boundedEventId(event.eventId),
    taskId,
    timestamp: event.occurredAt,
    source,
    metadata,
  };

  let sourceEvent: SourceEvent;
  switch (event.classification) {
    case "approval_requested":
      sourceEvent = inputRequest(base, interactionId, event, "approval");
      break;
    case "input_requested":
      sourceEvent = inputRequest(base, interactionId, event, "form");
      break;
    case "tool_failure":
    case "provider_failure":
    case "session_stop_failure":
      sourceEvent = {
        ...base,
        type: "task.updated",
        title: event.title,
        summary: event.summary,
        status: "failed",
        activityClass: "tool_failure",
        semanticHints: {
          intentFrame: "failure",
          activityClass: "tool_failure",
          consequence: "medium",
          whyNow: "OMP reported a failed operation.",
        },
      };
      break;
    case "turn_completed":
      sourceEvent = {
        ...base,
        type: "task.completed",
        summary: event.summary,
      };
      break;
    case "status_updated":
      sourceEvent = {
        ...base,
        type: "task.updated",
        title: event.title,
        summary: event.summary,
        status: event.status ?? "waiting",
        activityClass: "session_status",
        semanticHints: { activityClass: "session_status" },
      };
      break;
  }

  return {
    kind: "upsert",
    key,
    taskId,
    interactionId,
    occurredAt: event.occurredAt,
    displayTitle: event.title,
    navigation: { kind: "omp-session", sessionId: event.sessionId },
    sourceEvent,
  };
}

function inputRequest(
  base: {
    id: string;
    taskId: string;
    timestamp: string;
    source: { id: string; kind: "omp"; label: string };
    metadata: { ompDirect: { classification: string; sessionId: string } };
  },
  interactionId: string,
  event: OmpAttentionEvent,
  kind: "approval" | "form",
): SourceHumanInputRequestedEvent {
  return {
    ...base,
    type: "human.input.requested",
    interactionId,
    activityClass: kind === "approval" ? "permission_request" : "question_request",
    title: event.title,
    summary: event.summary,
    request:
      kind === "approval"
        ? { kind: "approval" }
        : {
            kind: "form",
            fields: [{ id: "reply", label: "Reply", type: "textarea", required: true }],
          },
    riskHint: "medium",
  };
}

function interactionFamily(classification: OmpAttentionEvent["classification"]): string {
  switch (classification) {
    case "approval_requested":
    case "approval_resolved":
      return "approval";
    case "input_requested":
    case "input_resolved":
      return "input";
    case "tool_failure":
    case "provider_failure":
    case "session_stop_failure":
      return "failure";
    case "turn_completed":
      return "completion";
    case "status_updated":
      return "status";
    case "session_shutdown":
      return "shutdown";
  }
}

function directKey(sessionId: string, family: string, interactionId: string): string {
  return `omp:${digest(`${sessionId}|${family}|${interactionId}`, 32)}`;
}

function boundedEventId(eventId: string): string {
  return `omp-direct:${digest(eventId, 48)}`;
}

function digest(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}
