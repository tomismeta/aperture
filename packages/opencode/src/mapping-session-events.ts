import type { SourceEvent, SourceTaskUpdatedEvent } from "@tomismeta/aperture-core";

import type {
  OpencodeSessionCompactedEvent,
  OpencodeSessionDiffEvent,
  OpencodeSessionErrorEvent,
  OpencodeSessionIdleEvent,
  OpencodeTodoUpdatedEvent,
} from "./types.js";
import {
  createOpencodeInstanceKey,
  opencodeSource,
  opencodeTaskId,
  readString,
  type OpencodeMappingContext,
} from "./mapping-shared.js";

type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

export function mapSessionIdle(
  event: OpencodeSessionIdleEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  if (!sessionId) {
    return [];
  }
  return [
    sessionUpdate({
      context,
      sessionId,
      kind: "session.idle",
      title: "OpenCode session idle",
      summary: "OpenCode is idle.",
      status: "completed",
      activityClass: "session_status",
    }),
  ];
}

export function mapSessionCompacted(
  event: OpencodeSessionCompactedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  if (!sessionId) {
    return [];
  }
  return [
    sessionUpdate({
      context,
      sessionId,
      kind: "session.compacted",
      title: "OpenCode session compacted",
      summary: "OpenCode compacted the session context.",
      status: "completed",
      activityClass: "session_status",
    }),
  ];
}

export function mapSessionError(
  event: OpencodeSessionErrorEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  if (!sessionId) {
    return [];
  }
  const errorName = readString(event.properties.error?.name);
  const message =
    readString(event.properties.error?.data?.message) ??
    errorName ??
    "OpenCode reported a session error.";
  return [
    sessionUpdate({
      context,
      sessionId,
      kind: "session.error",
      title: errorName ? `OpenCode ${errorName}` : "OpenCode session error",
      summary: message,
      status: "failed",
      activityClass: "tool_failure",
      metadata: {
        opencode: {
          error: event.properties.error ?? null,
        },
      },
    }),
  ];
}

export function mapSessionDiff(
  event: OpencodeSessionDiffEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  if (!sessionId) {
    return [];
  }
  const diff = Array.isArray(event.properties.diff) ? event.properties.diff : [];
  const summary =
    diff.length > 0
      ? `${diff.length} file diff(s) are available.`
      : "OpenCode updated the session diff.";
  return [
    sessionUpdate({
      context,
      sessionId,
      kind: "session.diff",
      title: "OpenCode session diff updated",
      summary,
      status: "running",
      activityClass: "status_update",
      toolFamily: "write",
      metadata: {
        opencode: {
          diff: diff.map((entry) => ({
            file: entry.file,
            status: entry.status,
            additions: entry.additions,
            deletions: entry.deletions,
          })),
        },
      },
    }),
  ];
}

export function mapTodoUpdated(
  event: OpencodeTodoUpdatedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  if (!sessionId) {
    return [];
  }
  const todos = Array.isArray(event.properties.todos) ? event.properties.todos : [];
  const counts = todoCounts(todos);
  const summary = `${todos.length} todo(s): ${counts.inProgress} in progress, ${counts.pending} pending, ${counts.completed} completed.`;
  return [
    sessionUpdate({
      context,
      sessionId,
      kind: "todo.updated",
      title: "OpenCode todo list updated",
      summary,
      status: counts.inProgress > 0 ? "running" : counts.pending > 0 ? "waiting" : "completed",
      activityClass: "status_update",
      metadata: {
        opencode: {
          todos,
        },
      },
    }),
  ];
}

function sessionUpdate(input: {
  context: OpencodeMappingContext;
  sessionId: string;
  kind: string;
  title: string;
  summary?: string;
  status: SourceTaskUpdatedEvent["status"];
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>;
  toolFamily?: string;
  metadata?: Record<string, unknown>;
}): SourceEvent {
  const instanceKey = createOpencodeInstanceKey(input.context);
  return {
    id: `opencode:${instanceKey}:event:${input.kind}:${encodeURIComponent(input.sessionId)}:${Date.now()}`,
    type: "task.updated",
    taskId: opencodeTaskId(instanceKey, input.sessionId),
    timestamp: new Date().toISOString(),
    source: opencodeSource(input.context),
    ...(input.toolFamily ? { toolFamily: input.toolFamily } : {}),
    activityClass: input.activityClass,
    semanticHints: taskActivitySemanticHints(input.activityClass, input.summary),
    title: input.title,
    ...(input.summary ? { summary: input.summary } : {}),
    status: input.status,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
  whyNow?: string,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    ...(whyNow !== undefined ? { whyNow } : {}),
    confidence: "high",
  };
}

function todoCounts(todos: NonNullable<OpencodeTodoUpdatedEvent["properties"]["todos"]>) {
  const counts = {
    pending: 0,
    inProgress: 0,
    completed: 0,
  };
  for (const todo of todos) {
    const status = readString(todo.status)?.toLowerCase();
    if (status === "completed" || status === "done") {
      counts.completed += 1;
    } else if (status === "in_progress" || status === "in-progress" || status === "running") {
      counts.inProgress += 1;
    } else {
      counts.pending += 1;
    }
  }
  return counts;
}
