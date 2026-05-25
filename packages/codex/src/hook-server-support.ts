import type { SourceEvent } from "@tomismeta/aperture-core";

import {
  codexHookPermissionInteractionId,
  codexHookTurnTaskId,
  type CodexHookMappingContext,
  type CodexHookResponse,
  type CodexPermissionRequestHookEvent,
  type CodexPreToolUseHookEvent,
} from "./hooks.js";

export type CodexHeldHookEvent = CodexPreToolUseHookEvent | CodexPermissionRequestHookEvent;

export type CodexHeldApprovalPolicy<TEvent extends CodexHeldHookEvent> = (
  event: TEvent,
  mappedEvent: Extract<SourceEvent, { type: "human.input.requested" }>,
) => "hold" | "allow";

export type CodexHeldApprovalFallback<TEvent extends CodexHeldHookEvent> = (
  event: TEvent,
  reason: "timed_out" | "not_held",
) => void;

export function codexHookFallbackEvent(
  event: CodexHeldHookEvent,
  reason: "timed_out" | "not_held",
  context: CodexHookMappingContext = {},
): SourceEvent {
  const approvalKind = event.hook_event_name === "PermissionRequest"
    ? "permission request"
    : "command approval";
  const interactionId = event.hook_event_name === "PermissionRequest"
    ? codexHookPermissionInteractionId(event)
    : event.tool_use_id;
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:fallback:${encodeURIComponent(interactionId)}:${reason}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: {
      id: `codex:hook:${event.session_id}`,
      kind: "codex",
      ...(context.sourceLabel ? { label: context.sourceLabel } : {}),
    },
    toolFamily: codexHookToolFamily(event.tool_name),
    activityClass: "permission_request",
    title:
      reason === "timed_out"
        ? `Codex ${approvalKind} timed out`
        : `Codex ${approvalKind} auto-denied`,
    summary:
      reason === "timed_out"
        ? `Aperture did not receive a response in time and denied the ${approvalKind}.`
        : `Aperture did not retain the approval frame and denied the ${approvalKind} to fail closed.`,
    status: "blocked",
  };
}

export function codexHookDenyBody(event: CodexHeldHookEvent, reason: string): CodexHookResponse {
  if (event.hook_event_name === "PermissionRequest") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: reason,
        },
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function codexHookToolFamily(toolName: string): string {
  if (toolName === "Bash" || toolName === "PowerShell") {
    return "bash";
  }
  if (toolName === "apply_patch" || toolName === "Edit" || toolName === "Write") {
    return "write";
  }
  if (toolName.startsWith("mcp__")) {
    return "mcp";
  }
  return toolName.toLowerCase();
}
