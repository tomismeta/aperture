import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  CodexItemCompletedNotification,
  CodexItemStartedNotification,
  CodexRawServerNotification,
} from "./protocol.js";
import {
  codexItemEventId,
  codexSource,
  codexTurnTaskId,
  isCommandExecutionItem,
  isEnteredReviewModeItem,
  isExitedReviewModeItem,
  isFileChangeItem,
  isRecord,
  taskUpdateSemanticHints,
  withOptionalSummary,
  type CodexMappingContext,
} from "./mapping-shared.js";
import {
  isAccountRateLimitsUpdatedNotification,
  isFileChangePatchUpdatedNotification,
  isGuardianWarningNotification,
  isMcpServerStatusUpdatedNotification,
  isModelVerificationNotification,
  isRemoteControlStatusChangedNotification,
  isWarningNotification,
  mapAccountRateLimitsUpdated,
  mapFileChangePatchUpdated,
  mapGuardianWarning,
  mapMcpServerStatusUpdated,
  mapModelVerification,
  mapRemoteControlStatusChanged,
  mapWarning,
} from "./mapping-notifications-ops.js";
import {
  isThreadGoalClearedNotification,
  isThreadGoalUpdatedNotification,
  isThreadStartedNotification,
  isThreadStatusChangedNotification,
  isTurnCompletedNotification,
  isTurnStartedNotification,
  mapThreadGoalCleared,
  mapThreadGoalUpdated,
  mapThreadStarted,
  mapThreadStatusChanged,
  mapTurnCompleted,
  mapTurnStarted,
} from "./mapping-notifications-thread.js";

export function mapCodexNotification(
  notification: CodexRawServerNotification,
  context: CodexMappingContext = {},
): SourceEvent[] {
  switch (notification.method) {
    case "thread/started":
      return isThreadStartedNotification(notification.params)
        ? [mapThreadStarted(notification.params, context)]
        : [];
    case "thread/status/changed":
      return isThreadStatusChangedNotification(notification.params)
        ? [mapThreadStatusChanged(notification.params, context)]
        : [];
    case "thread/goal/updated":
      return isThreadGoalUpdatedNotification(notification.params)
        ? [mapThreadGoalUpdated(notification.params, context)]
        : [];
    case "thread/goal/cleared":
      return isThreadGoalClearedNotification(notification.params)
        ? [mapThreadGoalCleared(notification.params, context)]
        : [];
    case "turn/started":
      return isTurnStartedNotification(notification.params)
        ? [mapTurnStarted(notification.params, context)]
        : [];
    case "turn/completed":
      return isTurnCompletedNotification(notification.params)
        ? [mapTurnCompleted(notification.params, context)]
        : [];
    case "item/started":
      return isItemStartedNotification(notification.params)
        ? mapItemStarted(notification.params, context)
        : [];
    case "item/completed":
      return isItemCompletedNotification(notification.params)
        ? mapItemCompleted(notification.params, context)
        : [];
    case "item/fileChange/patchUpdated":
      return isFileChangePatchUpdatedNotification(notification.params)
        ? [mapFileChangePatchUpdated(notification.params, context)]
        : [];
    case "mcpServer/startupStatus/updated":
      return isMcpServerStatusUpdatedNotification(notification.params)
        ? [mapMcpServerStatusUpdated(notification.params)]
        : [];
    case "account/rateLimits/updated":
      return isAccountRateLimitsUpdatedNotification(notification.params)
        ? mapAccountRateLimitsUpdated(notification.params)
        : [];
    case "remoteControl/status/changed":
      return isRemoteControlStatusChangedNotification(notification.params)
        ? [mapRemoteControlStatusChanged(notification.params)]
        : [];
    case "model/verification":
      return isModelVerificationNotification(notification.params)
        ? [mapModelVerification(notification.params, context)]
        : [];
    case "warning":
      return isWarningNotification(notification.params)
        ? [mapWarning(notification.params, context)]
        : [];
    case "guardianWarning":
      return isGuardianWarningNotification(notification.params)
        ? [mapGuardianWarning(notification.params, context)]
        : [];
    default:
      return [];
  }
}

function mapItemStarted(
  notification: CodexItemStartedNotification,
  context: CodexMappingContext,
): SourceEvent[] {
  if (isEnteredReviewModeItem(notification.item)) {
    return [
      {
        id: codexItemEventId(notification, "task.updated", "review-entered"),
        type: "task.updated",
        taskId: codexTurnTaskId(notification.threadId, notification.turnId),
        timestamp: new Date().toISOString(),
        source: codexSource(notification.threadId, context),
        activityClass: "session_status",
        semanticHints: taskUpdateSemanticHints(
          "session_status",
          notification.item.review || "Codex entered review mode.",
        ),
        title: "Codex review started",
        ...withOptionalSummary(notification.item.review),
        status: "running",
      },
    ];
  }
  return [];
}

function mapItemCompleted(
  notification: CodexItemCompletedNotification,
  context: CodexMappingContext,
): SourceEvent[] {
  if (isCommandExecutionItem(notification.item)) {
    const failed = notification.item.status === "failed";
    const declined = notification.item.status === "declined";
    return [
      {
        id: codexItemEventId(notification, "task.updated", "command-execution"),
        type: "task.updated",
        taskId: codexTurnTaskId(notification.threadId, notification.turnId),
        timestamp: new Date().toISOString(),
        source: codexSource(notification.threadId, context),
        toolFamily: "bash",
        activityClass: failed ? "tool_failure" : "tool_completion",
        semanticHints: taskUpdateSemanticHints(
          failed ? "tool_failure" : "tool_completion",
          notification.item.command || undefined,
        ),
        title: failed
          ? "Codex command failed"
          : declined
            ? "Codex command declined"
            : "Codex command completed",
        ...withOptionalSummary(notification.item.command),
        status: failed ? "failed" : "completed",
      },
    ];
  }

  if (isFileChangeItem(notification.item)) {
    const failed = notification.item.status === "failed";
    const declined = notification.item.status === "declined";
    const summary =
      notification.item.changes.length > 0
        ? `${notification.item.changes.length} file change(s)`
        : undefined;
    return [
      {
        id: codexItemEventId(notification, "task.updated", "file-change"),
        type: "task.updated",
        taskId: codexTurnTaskId(notification.threadId, notification.turnId),
        timestamp: new Date().toISOString(),
        source: codexSource(notification.threadId, context),
        toolFamily: "write",
        activityClass: failed ? "tool_failure" : "tool_completion",
        semanticHints: taskUpdateSemanticHints(
          failed ? "tool_failure" : "tool_completion",
          summary,
        ),
        title: failed
          ? "Codex file changes failed"
          : declined
            ? "Codex file changes declined"
            : "Codex file changes completed",
        ...withOptionalSummary(summary),
        status: failed ? "failed" : "completed",
      },
    ];
  }

  if (isExitedReviewModeItem(notification.item)) {
    return [
      {
        id: codexItemEventId(notification, "task.updated", "review-exited"),
        type: "task.updated",
        taskId: codexTurnTaskId(notification.threadId, notification.turnId),
        timestamp: new Date().toISOString(),
        source: codexSource(notification.threadId, context),
        activityClass: "tool_completion",
        semanticHints: taskUpdateSemanticHints(
          "tool_completion",
          notification.item.review || "Codex review completed.",
        ),
        title: "Codex review completed",
        ...withOptionalSummary(notification.item.review),
        status: "completed",
      },
    ];
  }

  return [];
}

function isItemStartedNotification(params: unknown): params is CodexItemStartedNotification {
  return isItemNotification(params);
}

function isItemCompletedNotification(params: unknown): params is CodexItemCompletedNotification {
  return isItemNotification(params);
}

function isItemNotification(
  params: unknown,
): params is CodexItemStartedNotification | CodexItemCompletedNotification {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && isRecord(params.item)
    && typeof params.item.id === "string"
    && typeof params.item.type === "string"
  );
}
