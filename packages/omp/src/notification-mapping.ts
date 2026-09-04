import { createHash } from "node:crypto";

import { createOmpInstanceKey } from "./mapping.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

export type OmpNotificationClass = "approval" | "input" | "failure" | "completion";

export type OmpNotificationTransition =
  | {
      kind: "upsert";
      key: string;
      notificationClass: OmpNotificationClass;
      summary: string;
      body: string;
      urgency: "low" | "normal" | "critical";
      expireTimeMs: number;
    }
  | { kind: "close"; key: string }
  | { kind: "close-class"; notificationClass: OmpNotificationClass };

export function mapOmpNotificationTransitions(
  event: OmpEvent,
  context: OmpMappingContext,
): OmpNotificationTransition[] {
  const key = (kind: string, identity: string) => notificationKey(context, kind, identity);
  switch (event.type) {
    case "tool_approval_requested":
      return [
        {
          kind: "upsert",
          key: key("approval", event.toolCallId),
          notificationClass: "approval",
          summary: `OMP needs approval for ${boundedText(event.toolName, 80)}`,
          body: "OMP is waiting for an operator decision.",
          urgency: "critical",
          expireTimeMs: 0,
        },
      ];
    case "tool_approval_resolved":
      return [{ kind: "close", key: key("approval", event.toolCallId) }];
    case "tool_call":
      return event.toolName === "ask" ? [needsInputTransition(key("input", event.toolCallId))] : [];
    case "tool_result":
      return [
        ...(event.toolName === "ask"
          ? [{ kind: "close" as const, key: key("input", event.toolCallId) }]
          : []),
        ...(event.isError
          ? [failureTransition(key("failure", event.toolCallId), event.toolName)]
          : []),
      ];
    case "input":
      return [{ kind: "close-class", notificationClass: "input" }];
    case "credential_disabled":
      return [
        {
          kind: "upsert",
          key: key("failure", `credential:${event.provider}`),
          notificationClass: "failure",
          summary: `OMP disabled ${boundedText(event.provider, 80)} authentication`,
          body: "OMP reported a provider authentication failure.",
          urgency: "normal",
          expireTimeMs: 12_000,
        },
      ];
    case "session_stop":
      return readStopReason(event.last_assistant_message) === "error"
        ? [failureTransition(key("failure", `turn:${event.turn_id}`), "agent turn")]
        : [
            {
              kind: "upsert",
              key: key("completion", String(event.turn_id)),
              notificationClass: "completion",
              summary: "OMP completed a turn",
              body: "OMP settled the main agent session.",
              urgency: "low",
              expireTimeMs: 8_000,
            },
          ];
    case "session_shutdown":
      return [
        { kind: "close-class", notificationClass: "approval" },
        { kind: "close-class", notificationClass: "input" },
      ];
    case "agent_end":
      return [];
    case "session_start":
    case "before_agent_start":
    case "agent_start":
    case "turn_start":
    case "turn_end":
    case "tool_execution_start":
    case "tool_execution_end":
    case "tool_execution_update":
      return [];
  }
}

function needsInputTransition(key: string): OmpNotificationTransition {
  return {
    kind: "upsert",
    key,
    notificationClass: "input",
    summary: "OMP needs your input",
    body: "OMP is waiting for an operator response.",
    urgency: "critical",
    expireTimeMs: 0,
  };
}

function failureTransition(key: string, toolName: string): OmpNotificationTransition {
  return {
    kind: "upsert",
    key,
    notificationClass: "failure",
    summary: `OMP ${boundedText(toolName, 80)} failed`,
    body: "OMP reported a tool execution failure.",
    urgency: "normal",
    expireTimeMs: 12_000,
  };
}

function notificationKey(context: OmpMappingContext, kind: string, identity: string): string {
  return `omp:${createHash("sha256")
    .update(`${createOmpInstanceKey(context)}|${kind}|${identity}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function boundedText(value: string, maximum: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized);
  return characters.length <= maximum
    ? characters.join("")
    : `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function readStopReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("stopReason" in value)) return undefined;
  return typeof value.stopReason === "string" ? value.stopReason : undefined;
}
