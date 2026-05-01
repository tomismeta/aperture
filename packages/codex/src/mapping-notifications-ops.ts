import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  CodexAccountRateLimitsUpdatedNotification,
  CodexFileChangePatchUpdatedNotification,
  CodexGuardianWarningNotification,
  CodexMcpServerStatusUpdatedNotification,
  CodexModelVerificationNotification,
  CodexRemoteControlStatusChangedNotification,
  CodexWarningNotification,
} from "./protocol.js";
import {
  codexSource,
  codexThreadTaskId,
  codexTurnTaskId,
  isRecord,
  taskUpdateSemanticHints,
  type CodexMappingContext,
} from "./mapping-shared.js";

export function mapFileChangePatchUpdated(
  notification: CodexFileChangePatchUpdatedNotification,
  context: CodexMappingContext,
): SourceEvent {
  const summary =
    notification.changes.length > 0
      ? `${notification.changes.length} pending file change(s)`
      : "Codex updated the pending patch.";
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turnId)}:${encodeURIComponent(notification.itemId)}:task.updated:file-change-patch`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turnId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    toolFamily: "write",
    activityClass: "status_update",
    semanticHints: taskUpdateSemanticHints("status_update", summary),
    title: "Codex patch updated",
    summary,
    status: "running",
    metadata: {
      codex: {
        fileChanges: notification.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
        })),
      },
    },
  };
}

export function mapMcpServerStatusUpdated(
  notification: CodexMcpServerStatusUpdatedNotification,
): SourceEvent {
  const failed = notification.status === "failed";
  const cancelled = notification.status === "cancelled";
  const ready = notification.status === "ready";
  const summary =
    notification.error ?? `MCP server ${notification.name} is ${notification.status}.`;
  return {
    id: `codex:mcp:${encodeURIComponent(notification.name)}:task.updated:startup-status`,
    type: "task.updated",
    taskId: `codex:mcp:${encodeURIComponent(notification.name)}`,
    timestamp: new Date().toISOString(),
    source: codexGlobalSource("codex:mcp", "Codex MCP"),
    activityClass: failed ? "tool_failure" : "session_status",
    semanticHints: taskUpdateSemanticHints(failed ? "tool_failure" : "session_status", summary),
    title: failed ? "Codex MCP server failed" : "Codex MCP server status changed",
    summary,
    status: failed ? "failed" : cancelled || ready ? "completed" : "running",
  };
}

export function mapAccountRateLimitsUpdated(
  notification: CodexAccountRateLimitsUpdatedNotification,
): SourceEvent[] {
  const reachedType = notification.rateLimits.rateLimitReachedType;
  if (!reachedType) {
    return [];
  }
  const limitName = notification.rateLimits.limitName ?? notification.rateLimits.limitId ?? "Codex";
  const summary = `${limitName} rate limit reached: ${reachedType}.`;
  return [
    {
      id: `codex:account:task.updated:rate-limit:${encodeURIComponent(reachedType)}`,
      type: "task.updated",
      taskId: "codex:account:rate-limits",
      timestamp: new Date().toISOString(),
      source: codexGlobalSource("codex:account", "Codex account"),
      activityClass: "status_update",
      semanticHints: {
        ...taskUpdateSemanticHints("status_update", summary),
        consequence: "high",
      },
      title: "Codex rate limit reached",
      summary,
      status: "blocked",
      metadata: {
        codex: {
          rateLimits: notification.rateLimits,
        },
      },
    },
  ];
}

export function mapRemoteControlStatusChanged(
  notification: CodexRemoteControlStatusChangedNotification,
): SourceEvent {
  const failed = notification.status === "errored";
  const summary = notification.environmentId
    ? `Codex remote control is ${notification.status} for ${notification.environmentId}.`
    : `Codex remote control is ${notification.status}.`;
  return {
    id: `codex:remote-control:task.updated:${notification.status}`,
    type: "task.updated",
    taskId: "codex:remote-control",
    timestamp: new Date().toISOString(),
    source: codexGlobalSource("codex:remote-control", "Codex remote control"),
    activityClass: failed ? "tool_failure" : "session_status",
    semanticHints: taskUpdateSemanticHints(failed ? "tool_failure" : "session_status", summary),
    title: failed ? "Codex remote control error" : "Codex remote control status changed",
    summary,
    status: failed ? "failed" : notification.status === "connected" ? "completed" : "running",
  };
}

export function mapModelVerification(
  notification: CodexModelVerificationNotification,
  context: CodexMappingContext,
): SourceEvent {
  const summary = `Codex requires model verification: ${notification.verifications.join(", ")}.`;
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turnId)}:task.updated:model-verification`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turnId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "status_update",
    semanticHints: {
      ...taskUpdateSemanticHints("status_update", summary),
      consequence: "high",
    },
    title: "Codex model verification required",
    summary,
    status: "waiting",
    metadata: {
      codex: {
        verifications: notification.verifications,
      },
    },
  };
}

export function mapWarning(
  notification: CodexWarningNotification,
  context: CodexMappingContext,
): SourceEvent {
  const taskId = notification.threadId ? codexThreadTaskId(notification.threadId) : "codex:warning";
  return {
    id: `codex:${encodeURIComponent(notification.threadId ?? "global")}:task.updated:warning`,
    type: "task.updated",
    taskId,
    timestamp: new Date().toISOString(),
    source: notification.threadId
      ? codexSource(notification.threadId, context)
      : codexGlobalSource("codex:warning", "Codex warning"),
    activityClass: "status_update",
    semanticHints: taskUpdateSemanticHints("status_update", notification.message),
    title: "Codex warning",
    summary: notification.message,
    status: "waiting",
  };
}

export function mapGuardianWarning(
  notification: CodexGuardianWarningNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:task.updated:guardian-warning`,
    type: "task.updated",
    taskId: codexThreadTaskId(notification.threadId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "status_update",
    semanticHints: {
      ...taskUpdateSemanticHints("status_update", notification.message),
      consequence: "high",
    },
    title: "Codex guardian warning",
    summary: notification.message,
    status: "blocked",
  };
}

export function isFileChangePatchUpdatedNotification(
  params: unknown,
): params is CodexFileChangePatchUpdatedNotification {
  return (
    isRecord(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string" &&
    Array.isArray(params.changes)
  );
}

export function isMcpServerStatusUpdatedNotification(
  params: unknown,
): params is CodexMcpServerStatusUpdatedNotification {
  return (
    isRecord(params) &&
    typeof params.name === "string" &&
    typeof params.status === "string" &&
    (typeof params.error === "string" || params.error === null)
  );
}

export function isAccountRateLimitsUpdatedNotification(
  params: unknown,
): params is CodexAccountRateLimitsUpdatedNotification {
  return isRecord(params) && isRecord(params.rateLimits);
}

export function isRemoteControlStatusChangedNotification(
  params: unknown,
): params is CodexRemoteControlStatusChangedNotification {
  return (
    isRecord(params) &&
    typeof params.status === "string" &&
    (typeof params.environmentId === "string" || params.environmentId === null)
  );
}

export function isModelVerificationNotification(
  params: unknown,
): params is CodexModelVerificationNotification {
  return (
    isRecord(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    Array.isArray(params.verifications)
  );
}

export function isWarningNotification(params: unknown): params is CodexWarningNotification {
  return (
    isRecord(params) &&
    (typeof params.threadId === "string" || params.threadId === null) &&
    typeof params.message === "string"
  );
}

export function isGuardianWarningNotification(
  params: unknown,
): params is CodexGuardianWarningNotification {
  return (
    isRecord(params) && typeof params.threadId === "string" && typeof params.message === "string"
  );
}

function codexGlobalSource(id: string, label: string) {
  return {
    id,
    kind: "codex",
    label,
  };
}
