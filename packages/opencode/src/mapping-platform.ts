import type { SourceEvent, SourceTaskUpdatedEvent } from "@tomismeta/aperture-core";

import type {
  OpencodeCommandExecutedEvent,
  OpencodeMcpBrowserOpenFailedEvent,
  OpencodeMcpToolsChangedEvent,
  OpencodeWorkspaceFailedEvent,
  OpencodeWorkspaceReadyEvent,
  OpencodeWorkspaceStatusEvent,
  OpencodeWorktreeFailedEvent,
  OpencodeWorktreeReadyEvent,
} from "./types.js";
import {
  createOpencodeInstanceKey,
  opencodeSource,
  opencodeTaskId,
  readString,
  type OpencodeMappingContext,
} from "./mapping-shared.js";

type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

export function mapMcpToolsChanged(
  event: OpencodeMcpToolsChangedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const server = readString(event.properties.server) ?? "MCP";
  return [
    globalUpdate({
      context,
      key: `mcp.tools.changed:${server}`,
      title: "OpenCode MCP tools changed",
      summary: `${server} MCP tools changed.`,
      status: "completed",
      activityClass: "session_status",
    }),
  ];
}

export function mapMcpBrowserOpenFailed(
  event: OpencodeMcpBrowserOpenFailedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const mcpName = readString(event.properties.mcpName) ?? "MCP";
  const url = readString(event.properties.url);
  const summary = url
    ? `${mcpName} could not open browser URL ${url}.`
    : `${mcpName} could not open the browser.`;
  return [
    globalUpdate({
      context,
      key: `mcp.browser.open.failed:${mcpName}`,
      title: "OpenCode MCP browser open failed",
      summary,
      status: "failed",
      activityClass: "tool_failure",
    }),
  ];
}

export function mapCommandExecuted(
  event: OpencodeCommandExecutedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const sessionId = readString(event.properties.sessionID);
  const name = readString(event.properties.name) ?? "command";
  const summary = readString(event.properties.arguments)
    ? `${name} ${event.properties.arguments}`
    : `OpenCode command ${name} executed.`;
  if (sessionId) {
    return [
      sessionScopedUpdate({
        context,
        sessionId,
        kind: `command.executed:${name}`,
        title: "OpenCode command executed",
        summary,
        status: "completed",
        activityClass: "tool_completion",
      }),
    ];
  }
  return [
    globalUpdate({
      context,
      key: `command.executed:${name}`,
      title: "OpenCode command executed",
      summary,
      status: "completed",
      activityClass: "tool_completion",
    }),
  ];
}

export function mapWorkspaceStatus(
  event: OpencodeWorkspaceStatusEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const workspaceId = readString(event.properties.workspaceID) ?? "workspace";
  const status = readString(event.properties.status) ?? "unknown";
  return [
    globalUpdate({
      context,
      key: `workspace.status:${workspaceId}`,
      title: "OpenCode workspace status changed",
      summary: `Workspace ${workspaceId} is ${status}.`,
      status: status === "error" ? "failed" : status === "connected" ? "completed" : "running",
      activityClass: status === "error" ? "tool_failure" : "session_status",
    }),
  ];
}

export function mapWorkspaceReady(
  event: OpencodeWorkspaceReadyEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const name = readString(event.properties.name) ?? "workspace";
  return [
    globalUpdate({
      context,
      key: `workspace.ready:${name}`,
      title: "OpenCode workspace ready",
      summary: `Workspace ${name} is ready.`,
      status: "completed",
      activityClass: "session_status",
    }),
  ];
}

export function mapWorkspaceFailed(
  event: OpencodeWorkspaceFailedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const message = readString(event.properties.message) ?? "OpenCode workspace failed.";
  return [
    globalUpdate({
      context,
      key: "workspace.failed",
      title: "OpenCode workspace failed",
      summary: message,
      status: "failed",
      activityClass: "tool_failure",
    }),
  ];
}

export function mapWorktreeReady(
  event: OpencodeWorktreeReadyEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const name = readString(event.properties.name) ?? "worktree";
  const branch = readString(event.properties.branch);
  return [
    globalUpdate({
      context,
      key: `worktree.ready:${name}`,
      title: "OpenCode worktree ready",
      summary: branch ? `${name} is ready on ${branch}.` : `${name} is ready.`,
      status: "completed",
      activityClass: "session_status",
    }),
  ];
}

export function mapWorktreeFailed(
  event: OpencodeWorktreeFailedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const message = readString(event.properties.message) ?? "OpenCode worktree failed.";
  return [
    globalUpdate({
      context,
      key: "worktree.failed",
      title: "OpenCode worktree failed",
      summary: message,
      status: "failed",
      activityClass: "tool_failure",
    }),
  ];
}

function sessionScopedUpdate(input: {
  context: OpencodeMappingContext;
  sessionId: string;
  kind: string;
  title: string;
  summary: string;
  status: SourceTaskUpdatedEvent["status"];
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>;
}): SourceEvent {
  const instanceKey = createOpencodeInstanceKey(input.context);
  return {
    id: `opencode:${instanceKey}:event:${input.kind}:${encodeURIComponent(input.sessionId)}:${Date.now()}`,
    type: "task.updated",
    taskId: opencodeTaskId(instanceKey, input.sessionId),
    timestamp: new Date().toISOString(),
    source: opencodeSource(input.context),
    activityClass: input.activityClass,
    semanticHints: taskActivitySemanticHints(input.activityClass, input.summary),
    title: input.title,
    summary: input.summary,
    status: input.status,
  };
}

function globalUpdate(input: {
  context: OpencodeMappingContext;
  key: string;
  title: string;
  summary: string;
  status: SourceTaskUpdatedEvent["status"];
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>;
}): SourceEvent {
  const instanceKey = createOpencodeInstanceKey(input.context);
  return {
    id: `opencode:${instanceKey}:event:${input.key}:${Date.now()}`,
    type: "task.updated",
    taskId: opencodeTaskId(instanceKey, undefined, input.key),
    timestamp: new Date().toISOString(),
    source: opencodeSource(input.context),
    activityClass: input.activityClass,
    semanticHints: taskActivitySemanticHints(input.activityClass, input.summary),
    title: input.title,
    summary: input.summary,
    status: input.status,
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
