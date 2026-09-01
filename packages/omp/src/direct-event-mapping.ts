import { createHash } from "node:crypto";

import {
  assertOmpAttentionEvent,
  type OmpAttentionClassification,
  type OmpAttentionEvent,
  type OmpAttentionStatus,
  type OmpAttentionTransition,
} from "@tomismeta/aperture/omp-attention-event";

import type { OmpEvent, OmpMappingContext } from "./types.js";

export function mapOmpDirectAttentionEvents(
  event: OmpEvent,
  context: OmpMappingContext,
): OmpAttentionEvent[] {
  const sessionId = sessionIdForEvent(event, context);
  if (!sessionId) return [];
  const occurredAt = eventTimestamp(event, context);

  switch (event.type) {
    case "tool_approval_requested":
      return [
        directEvent({
          occurredAt,
          sessionId,
          interactionId: event.toolCallId,
          classification: "approval_requested",
          title: `OMP needs approval for ${safeToken(event.toolName, "tool")}`,
          summary: "OMP is waiting for an operator decision.",
          transition: "requested",
        }),
      ];
    case "tool_approval_resolved":
      return [
        directEvent({
          occurredAt,
          sessionId,
          interactionId: event.toolCallId,
          classification: "approval_resolved",
          title: "OMP approval resolved",
          summary: event.approved
            ? "OMP resumed after operator approval."
            : "OMP did not run the requested tool.",
          transition: "resolved",
        }),
      ];
    case "tool_call":
    case "tool_execution_start":
      return event.toolName === "ask"
        ? [
            directEvent({
              occurredAt,
              sessionId,
              interactionId: event.toolCallId,
              classification: "input_requested",
              title: "OMP needs your input",
              summary: "OMP is waiting for an operator response.",
              transition: "requested",
            }),
          ]
        : [];
    case "tool_execution_end":
      if (event.toolName === "ask") {
        return [
          directEvent({
            occurredAt,
            sessionId,
            interactionId: event.toolCallId,
            classification: "input_resolved",
            title: "OMP input request resolved",
            summary: "OMP finished the requested input interaction.",
            transition: "resolved",
          }),
          ...(event.isError ? [toolFailure(event.toolCallId, event.toolName)] : []),
        ];
      }
      return event.isError ? [toolFailure(event.toolCallId, event.toolName)] : [];
    case "tool_result":
      if (event.toolName === "ask" && !event.isError) {
        return [
          directEvent({
            occurredAt,
            sessionId,
            interactionId: event.toolCallId,
            classification: "input_resolved",
            title: "OMP input request resolved",
            summary: "OMP received the requested operator input.",
            transition: "resolved",
          }),
        ];
      }
      return event.isError ? [toolFailure(event.toolCallId, event.toolName)] : [];
    case "credential_disabled":
      return [
        directEvent({
          occurredAt,
          sessionId,
          interactionId: `credential:${safeToken(event.provider, "provider")}`,
          classification: "provider_failure",
          title: `OMP disabled ${safeToken(event.provider, "provider")} authentication`,
          summary: "OMP reported a provider authentication failure.",
          transition: "failed",
        }),
      ];
    case "session_stop":
      return readStopReason(event.last_assistant_message) === "error"
        ? [
            directEvent({
              occurredAt,
              sessionId,
              turnId: String(event.turn_id),
              interactionId: `turn:${event.turn_id}`,
              classification: "session_stop_failure",
              title: "OMP agent turn failed",
              summary: "OMP stopped after a provider or model error.",
              transition: "failed",
            }),
          ]
        : [
            directEvent({
              occurredAt,
              sessionId,
              turnId: String(event.turn_id),
              interactionId: `turn:${event.turn_id}`,
              classification: "turn_completed",
              title: "OMP completed a turn",
              summary: "OMP settled the main agent session.",
              transition: "completed",
            }),
          ];
    case "session_shutdown":
      return [
        directEvent({
          occurredAt,
          sessionId,
          classification: "session_shutdown",
          title: "OMP session shut down",
          summary: "OMP closed the originating agent session.",
          transition: "shutdown",
        }),
      ];
    case "session_start":
    case "before_agent_start":
    case "agent_start":
    case "turn_start":
    case "turn_end":
    case "tool_execution_update":
    case "input":
    case "agent_end":
      return [];
  }

  function toolFailure(interactionId: string, toolName: string): OmpAttentionEvent {
    return directEvent({
      occurredAt,
      sessionId: sessionId!,
      interactionId,
      classification: "tool_failure",
      title: `OMP ${safeToken(toolName, "tool")} failed`,
      summary: "OMP reported a terminal tool execution failure.",
      transition: "failed",
    });
  }
}

type DirectEventFacts = {
  occurredAt: string;
  sessionId: string;
  turnId?: string;
  interactionId?: string;
  classification: OmpAttentionClassification;
  title: string;
  summary: string;
  transition: OmpAttentionTransition;
  status?: OmpAttentionStatus;
};

function directEvent(facts: DirectEventFacts): OmpAttentionEvent {
  const identity = JSON.stringify({
    sessionId: facts.sessionId,
    turnId: facts.turnId ?? null,
    interactionId: facts.interactionId ?? null,
    classification: facts.classification,
    title: facts.title,
    summary: facts.summary,
    transition: facts.transition,
    status: facts.status ?? null,
  });
  return assertOmpAttentionEvent({
    schemaVersion: 1,
    type: "omp.attention-event",
    eventId: `omp:${createHash("sha256").update(identity).digest("hex")}`,
    ...facts,
  });
}

function sessionIdForEvent(event: OmpEvent, context: OmpMappingContext): string | undefined {
  if (event.type === "session_stop") return event.session_id;
  if (event.type === "tool_approval_requested" || event.type === "tool_approval_resolved") {
    return event.sessionId;
  }
  return context.sessionId;
}

function eventTimestamp(event: OmpEvent, context: OmpMappingContext): string {
  if (event.type === "turn_start" && Number.isFinite(event.timestamp)) {
    return new Date(event.timestamp).toISOString();
  }
  return context.now?.() ?? new Date().toISOString();
}

function safeToken(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized) ? normalized : fallback;
}

function readStopReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("stopReason" in value)) return undefined;
  return typeof value.stopReason === "string" ? value.stopReason : undefined;
}
