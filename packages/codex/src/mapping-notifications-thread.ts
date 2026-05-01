import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  CodexThreadStartedNotification,
  CodexThreadGoalClearedNotification,
  CodexThreadGoalUpdatedNotification,
  CodexThreadStatusChangedNotification,
  CodexTurnCompletedNotification,
  CodexTurnStartedNotification,
} from "./protocol.js";
import {
  codexSource,
  codexTaskId,
  codexThreadTaskId,
  codexTurnTaskId,
  describeThreadStatus,
  isRecord,
  taskUpdateSemanticHints,
  withOptionalSummary,
  type CodexMappingContext,
} from "./mapping-shared.js";

export function mapThreadStarted(
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

export function mapThreadStatusChanged(
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

export function mapThreadGoalUpdated(
  notification: CodexThreadGoalUpdatedNotification,
  context: CodexMappingContext,
): SourceEvent {
  const whyNow = describeThreadGoal(notification.goal);
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turnId ?? "thread")}:task.updated:thread-goal`,
    type: "task.updated",
    taskId: codexTaskId(notification.threadId, notification.turnId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass:
      notification.goal.status === "budgetLimited" ? "status_update" : "session_status",
    semanticHints: taskUpdateSemanticHints(
      notification.goal.status === "budgetLimited" ? "status_update" : "session_status",
      whyNow,
    ),
    title: threadGoalTitle(notification.goal.status),
    summary: whyNow,
    status: threadGoalStatus(notification.goal.status),
    metadata: {
      codex: {
        goal: {
          objective: notification.goal.objective,
          status: notification.goal.status,
          tokenBudget: notification.goal.tokenBudget,
          tokensUsed: notification.goal.tokensUsed,
          timeUsedSeconds: notification.goal.timeUsedSeconds,
        },
      },
    },
  };
}

export function mapThreadGoalCleared(
  notification: CodexThreadGoalClearedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:task.updated:thread-goal-cleared`,
    type: "task.updated",
    taskId: codexThreadTaskId(notification.threadId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "session_status",
    semanticHints: taskUpdateSemanticHints(
      "session_status",
      "Codex cleared the active thread goal.",
    ),
    title: "Codex goal cleared",
    summary: "Codex cleared the active thread goal.",
    status: "completed",
  };
}

export function mapTurnStarted(
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

export function mapTurnCompleted(
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

export function isThreadStartedNotification(
  params: unknown,
): params is CodexThreadStartedNotification {
  return (
    isRecord(params) &&
    isRecord(params.thread) &&
    typeof params.thread.id === "string" &&
    typeof params.thread.preview === "string"
  );
}

export function isThreadStatusChangedNotification(
  params: unknown,
): params is CodexThreadStatusChangedNotification {
  return (
    isRecord(params) &&
    typeof params.threadId === "string" &&
    isRecord(params.status) &&
    typeof params.status.type === "string"
  );
}

export function isThreadGoalUpdatedNotification(
  params: unknown,
): params is CodexThreadGoalUpdatedNotification {
  return (
    isRecord(params) &&
    typeof params.threadId === "string" &&
    (typeof params.turnId === "string" || params.turnId === null) &&
    isRecord(params.goal) &&
    typeof params.goal.objective === "string" &&
    typeof params.goal.status === "string"
  );
}

export function isThreadGoalClearedNotification(
  params: unknown,
): params is CodexThreadGoalClearedNotification {
  return isRecord(params) && typeof params.threadId === "string";
}

export function isTurnStartedNotification(params: unknown): params is CodexTurnStartedNotification {
  return isTurnNotification(params);
}

export function isTurnCompletedNotification(
  params: unknown,
): params is CodexTurnCompletedNotification {
  return isTurnNotification(params);
}

function isTurnNotification(
  params: unknown,
): params is CodexTurnStartedNotification | CodexTurnCompletedNotification {
  return (
    isRecord(params) &&
    typeof params.threadId === "string" &&
    isRecord(params.turn) &&
    typeof params.turn.id === "string" &&
    typeof params.turn.status === "string" &&
    Array.isArray(params.turn.items)
  );
}

function threadGoalTitle(status: CodexThreadGoalUpdatedNotification["goal"]["status"]): string {
  switch (status) {
    case "active":
      return "Codex goal updated";
    case "paused":
      return "Codex goal paused";
    case "budgetLimited":
      return "Codex goal reached budget";
    case "complete":
      return "Codex goal completed";
  }
}

function threadGoalStatus(
  status: CodexThreadGoalUpdatedNotification["goal"]["status"],
): "running" | "waiting" | "completed" {
  switch (status) {
    case "active":
      return "running";
    case "paused":
    case "budgetLimited":
      return "waiting";
    case "complete":
      return "completed";
  }
}

function describeThreadGoal(goal: CodexThreadGoalUpdatedNotification["goal"]): string {
  const parts = [`${goal.objective} (${goal.status})`];
  if (goal.tokenBudget !== null) {
    parts.push(`${goal.tokensUsed}/${goal.tokenBudget} tokens`);
  } else if (goal.tokensUsed > 0) {
    parts.push(`${goal.tokensUsed} tokens`);
  }
  if (goal.timeUsedSeconds > 0) {
    parts.push(`${goal.timeUsedSeconds}s elapsed`);
  }
  return parts.join("; ");
}
