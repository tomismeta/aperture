import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  CodexItemCompletedNotification,
  CodexItemStartedNotification,
  CodexRawServerNotification,
  CodexThreadStartedNotification,
  CodexThreadStatusChangedNotification,
  CodexTurnCompletedNotification,
  CodexTurnStartedNotification,
} from "./protocol.js";
import {
  codexItemEventId,
  codexSource,
  codexThreadTaskId,
  codexTurnTaskId,
  describeThreadStatus,
  isCommandExecutionItem,
  isEnteredReviewModeItem,
  isExitedReviewModeItem,
  isFileChangeItem,
  isRecord,
  taskUpdateSemanticHints,
  withOptionalSummary,
  type CodexMappingContext,
} from "./mapping-shared.js";

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
    default:
      return [];
  }
}

function mapThreadStarted(
  notification: CodexThreadStartedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.thread.id)}:task.started`,
    type: "task.started",
    taskId: codexThreadTaskId(notification.thread.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.thread.id, context),
    title: notification.thread.name ?? "Codex thread started",
    ...withOptionalSummary(notification.thread.preview || undefined),
  };
}

function mapThreadStatusChanged(
  notification: CodexThreadStatusChangedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:task.updated:thread-status`,
    type: "task.updated",
    taskId: codexThreadTaskId(notification.threadId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "session_status",
    semanticHints: taskUpdateSemanticHints(
      "session_status",
      describeThreadStatus(notification.status),
    ),
    title: "Codex thread status changed",
    summary: describeThreadStatus(notification.status),
    status: notification.status.type === "active" ? "running" : "waiting",
  };
}

function mapTurnStarted(
  notification: CodexTurnStartedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turn.id)}:task.updated:turn-started`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turn.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "session_status",
    semanticHints: taskUpdateSemanticHints(
      "session_status",
      "Codex began working on the current turn.",
    ),
    title: "Codex turn started",
    summary: "Codex began working on the current turn.",
    status: "running",
  };
}

function mapTurnCompleted(
  notification: CodexTurnCompletedNotification,
  context: CodexMappingContext,
): SourceEvent {
  const failed = notification.turn.status === "failed";
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turn.id)}:task.updated:turn-completed`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turn.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: failed ? "tool_failure" : "tool_completion",
    semanticHints: taskUpdateSemanticHints(
      failed ? "tool_failure" : "tool_completion",
      failed ? "Codex ended the turn with an error." : "Codex finished the current turn.",
    ),
    title: failed ? "Codex turn failed" : "Codex turn completed",
    summary: failed ? "Codex ended the turn with an error." : "Codex finished the current turn.",
    status: failed ? "failed" : "completed",
  };
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

function isThreadStartedNotification(params: unknown): params is CodexThreadStartedNotification {
  return (
    isRecord(params)
    && isRecord(params.thread)
    && typeof params.thread.id === "string"
    && typeof params.thread.preview === "string"
  );
}

function isThreadStatusChangedNotification(
  params: unknown,
): params is CodexThreadStatusChangedNotification {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && isRecord(params.status)
    && typeof params.status.type === "string"
  );
}

function isTurnStartedNotification(params: unknown): params is CodexTurnStartedNotification {
  return isTurnNotification(params);
}

function isTurnCompletedNotification(params: unknown): params is CodexTurnCompletedNotification {
  return isTurnNotification(params);
}

function isTurnNotification(
  params: unknown,
): params is CodexTurnStartedNotification | CodexTurnCompletedNotification {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && isRecord(params.turn)
    && typeof params.turn.id === "string"
    && typeof params.turn.status === "string"
    && Array.isArray(params.turn.items)
  );
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
