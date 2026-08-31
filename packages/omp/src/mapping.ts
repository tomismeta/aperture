import { basename } from "node:path";

import type { SourceEvent, SourceTaskUpdatedEvent } from "@tomismeta/aperture-core";

import type {
  OmpEvent,
  OmpExtensionContext,
  OmpMappingContext,
  OmpToolExecutionEndEvent,
  OmpToolExecutionStartEvent,
} from "./types.js";

export function mapOmpEvent(event: OmpEvent, context: OmpMappingContext = {}): SourceEvent[] {
  const resolved = contextForEvent(event, context);
  const timestamp = eventTimestamp(event, resolved);
  const taskId = ompTaskId(resolved);
  const source = ompSource(resolved);
  const id = (suffix: string) => `omp:${createOmpInstanceKey(resolved)}:${suffix}:${timestamp}`;

  switch (event.type) {
    case "session_start":
      return [
        {
          id: id("session_start"),
          type: "task.started",
          taskId,
          timestamp,
          source,
          metadata: ompMetadata({ lifecycle: "session_start" }),
          title: "OMP session started",
          summary: "OMP opened an agent session.",
        },
      ];
    case "session_stop":
      return [
        {
          id: id(`session_stop:${event.turn_id}`),
          type: "task.completed",
          taskId,
          timestamp,
          source,
          metadata: ompMetadata({
            lifecycle: "session_stop",
            turnId: event.turn_id,
            sessionId: event.session_id,
          }),
          summary: "OMP settled the main agent turn.",
        },
      ];
    case "session_shutdown":
      return [
        {
          id: id("session_shutdown"),
          type: "task.cancelled",
          taskId,
          timestamp,
          source,
          metadata: ompMetadata({ lifecycle: "session_shutdown" }),
          reason: "OMP session shut down.",
        },
      ];
    case "before_agent_start":
      return [
        runningUpdate(id("before_agent_start"), taskId, timestamp, source, "OMP accepted a prompt"),
      ];
    case "agent_start":
      return [runningUpdate(id("agent_start"), taskId, timestamp, source, "OMP started working")];
    case "agent_end":
      return [
        event.willContinue
          ? runningUpdate(
              id("agent_end:continuing"),
              taskId,
              timestamp,
              source,
              "OMP scheduled an automatic continuation",
            )
          : waitingUpdate(
              id("agent_end:settled"),
              taskId,
              timestamp,
              source,
              "OMP agent loop settled",
              "Waiting for the authoritative main-session stop event.",
            ),
      ];
    case "turn_start":
      return [
        runningUpdate(
          id(`turn_start:${event.turnIndex}`),
          taskId,
          timestamp,
          source,
          `OMP turn ${event.turnIndex + 1} started`,
        ),
      ];
    case "turn_end":
      return [
        runningUpdate(
          id(`turn_end:${event.turnIndex}`),
          taskId,
          timestamp,
          source,
          `OMP turn ${event.turnIndex + 1} ended`,
        ),
      ];
    case "tool_call":
      return event.toolName === "ask"
        ? [
            needsAttentionUpdate(
              id(`ask:${event.toolCallId}`),
              taskId,
              timestamp,
              source,
              "OMP needs input",
            ),
          ]
        : [];
    case "tool_execution_start":
      return [mapToolExecutionStart(event, id, taskId, timestamp, source)];
    case "tool_execution_update":
      return [
        runningUpdate(
          id(`tool_update:${event.toolCallId}`),
          taskId,
          timestamp,
          source,
          `OMP updated ${event.toolName}`,
        ),
      ];
    case "tool_execution_end":
      return [mapToolExecutionEnd(event, id, taskId, timestamp, source)];
    case "tool_result":
      return event.isError
        ? [
            failedUpdate(
              id(`tool_result:${event.toolCallId}`),
              taskId,
              timestamp,
              source,
              event.toolName,
            ),
          ]
        : [];
    case "tool_approval_requested":
      return [
        needsAttentionUpdate(
          id(`approval_requested:${event.toolCallId}`),
          taskId,
          timestamp,
          source,
          `OMP needs approval for ${event.toolName}`,
          event.reason ? boundedText(event.reason, 240) : undefined,
        ),
      ];
    case "tool_approval_resolved":
      return [
        event.approved
          ? runningUpdate(
              id(`approval_resolved:${event.toolCallId}:approved`),
              taskId,
              timestamp,
              source,
              `OMP resumed ${event.toolName}`,
            )
          : needsAttentionUpdate(
              id(`approval_resolved:${event.toolCallId}:denied`),
              taskId,
              timestamp,
              source,
              `OMP approval denied for ${event.toolName}`,
              "OMP did not run the requested tool.",
            ),
      ];
    case "input":
      return [runningUpdate(id("input"), taskId, timestamp, source, "OMP received operator input")];
    case "credential_disabled":
      return [
        failedUpdate(
          id(`credential_disabled:${encodeURIComponent(event.provider)}`),
          taskId,
          timestamp,
          source,
          "provider authentication",
          `OMP disabled the ${boundedText(event.provider, 80)} credential.`,
        ),
      ];
  }
}

export function contextFromOmpExtension(
  extensionContext: OmpExtensionContext,
  base: OmpMappingContext = {},
): OmpMappingContext {
  const next: OmpMappingContext = { ...base };
  if (!next.cwd && extensionContext.cwd) next.cwd = extensionContext.cwd;
  if (!next.sessionFile) {
    const sessionFile = readSessionFile(extensionContext.sessionManager);
    if (sessionFile) next.sessionFile = sessionFile;
  }
  if (!next.sessionId) {
    const sessionId = readSessionId(extensionContext.sessionManager);
    if (sessionId) next.sessionId = sessionId;
  }
  return next;
}

export type OmpSource = {
  id: string;
  kind: "omp";
  label: string;
};

export function createOmpInstanceKey(context: OmpMappingContext): string {
  const cwd = context.cwd?.trim() || "unknown-cwd";
  const session = context.sessionId?.trim() || context.sessionFile?.trim() || "active";
  return encodeURIComponent(`${cwd}|${session}`);
}

export function ompTaskId(context: OmpMappingContext): string {
  return `omp:${createOmpInstanceKey(context)}:session`;
}

export function ompSource(context: OmpMappingContext): OmpSource {
  const project = context.cwd ? basename(context.cwd) : "";
  return {
    id: `omp:${createOmpInstanceKey(context)}`,
    kind: "omp",
    label: context.sourceLabel ?? (project ? `OMP ${project}` : "OMP"),
  };
}

function contextForEvent(event: OmpEvent, context: OmpMappingContext): OmpMappingContext {
  if (event.type === "session_stop") {
    return {
      ...context,
      sessionId: event.session_id,
      ...(event.session_file ? { sessionFile: event.session_file } : {}),
    };
  }
  if (event.type === "tool_approval_requested" || event.type === "tool_approval_resolved") {
    return { ...context, sessionId: event.sessionId };
  }
  return context;
}

function eventTimestamp(event: OmpEvent, context: OmpMappingContext): string {
  if (event.type === "turn_start" && Number.isFinite(event.timestamp)) {
    return new Date(event.timestamp).toISOString();
  }
  return context.now?.() ?? new Date().toISOString();
}

function runningUpdate(
  id: string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
  title: string,
): SourceTaskUpdatedEvent {
  return {
    id,
    type: "task.updated",
    taskId,
    timestamp,
    source,
    metadata: ompMetadata(),
    activityClass: "session_status",
    title,
    status: "running",
    semanticHints: { activityClass: "session_status" },
  };
}

function waitingUpdate(
  id: string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
  title: string,
  summary?: string,
): SourceTaskUpdatedEvent {
  return {
    id,
    type: "task.updated",
    taskId,
    timestamp,
    source,
    metadata: ompMetadata(),
    activityClass: "status_update",
    title,
    ...(summary ? { summary } : {}),
    status: "waiting",
    semanticHints: { activityClass: "status_update" },
  };
}

function needsAttentionUpdate(
  id: string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
  title: string,
  summary?: string,
): SourceTaskUpdatedEvent {
  return {
    id,
    type: "task.updated",
    taskId,
    timestamp,
    source,
    metadata: ompMetadata(),
    activityClass: "permission_request",
    title,
    ...(summary ? { summary } : {}),
    status: "blocked",
    semanticHints: {
      intentFrame: "blocked_work",
      activityClass: "permission_request",
      consequence: "medium",
      whyNow: "OMP is waiting for operator attention.",
    },
  };
}

function failedUpdate(
  id: string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
  toolName: string,
  summary?: string,
): SourceTaskUpdatedEvent {
  return {
    id,
    type: "task.updated",
    taskId,
    timestamp,
    source,
    metadata: ompMetadata(),
    activityClass: "tool_failure",
    title: `OMP ${boundedText(toolName, 80)} failed`,
    ...(summary ? { summary } : {}),
    status: "failed",
    semanticHints: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      consequence: "medium",
      whyNow: "OMP reported a failed operation.",
    },
  };
}

function mapToolExecutionStart(
  event: OmpToolExecutionStartEvent,
  id: (suffix: string) => string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
): SourceTaskUpdatedEvent {
  if (event.toolName === "ask") {
    return needsAttentionUpdate(
      id(`ask_start:${event.toolCallId}`),
      taskId,
      timestamp,
      source,
      "OMP needs input",
    );
  }
  return runningUpdate(
    id(`tool_start:${event.toolCallId}`),
    taskId,
    timestamp,
    source,
    `OMP is running ${boundedText(event.toolName, 80)}`,
  );
}

function mapToolExecutionEnd(
  event: OmpToolExecutionEndEvent,
  id: (suffix: string) => string,
  taskId: string,
  timestamp: string,
  source: OmpSource,
): SourceTaskUpdatedEvent {
  if (event.toolName === "ask") {
    return runningUpdate(
      id(`ask_end:${event.toolCallId}`),
      taskId,
      timestamp,
      source,
      "OMP received requested input",
    );
  }
  return event.isError
    ? failedUpdate(
        id(`tool_end:${event.toolCallId}:failed`),
        taskId,
        timestamp,
        source,
        event.toolName,
      )
    : runningUpdate(
        id(`tool_end:${event.toolCallId}:completed`),
        taskId,
        timestamp,
        source,
        `OMP finished ${boundedText(event.toolName, 80)}`,
      );
}

function ompMetadata(extra?: Record<string, unknown>) {
  return {
    execution: { runner: "omp" },
    ...(extra ? { omp: extra } : {}),
  };
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

function readSessionFile(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("sessionFile" in value) {
    const sessionFile = readNonEmptyString(value.sessionFile);
    if (sessionFile) return sessionFile;
  }
  if ("currentSessionFile" in value) {
    const currentSessionFile = readNonEmptyString(value.currentSessionFile);
    if (currentSessionFile) return currentSessionFile;
  }
  return "path" in value ? readNonEmptyString(value.path) : undefined;
}

function readSessionId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("sessionId" in value) {
    const sessionId = readNonEmptyString(value.sessionId);
    if (sessionId) return sessionId;
  }
  return "id" in value ? readNonEmptyString(value.id) : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
