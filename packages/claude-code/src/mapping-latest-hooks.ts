import { basename } from "node:path";

import type {
  SourceEvent,
  SourceTaskCompletedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  ClaudeCodeFileChangedEvent,
  ClaudeCodePostToolBatchEvent,
  ClaudeCodeSetupEvent,
  ClaudeCodeUserPromptExpansionEvent,
  ClaudeCodeWorktreeCreateEvent,
  ClaudeCodeWorktreeRemoveEvent,
} from "./mapping.js";
import { claudeEventId, claudeSource, claudeTaskId, nowIso, readString } from "./mapping-shared.js";

export function mapSetup(event: ClaudeCodeSetupEvent): SourceTaskUpdatedEvent {
  const summary = `Claude Code setup started for ${event.source}.`;
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(summary),
    title: "Claude setup started",
    summary,
    status: "running",
  };
}

export function mapPostToolBatch(event: ClaudeCodePostToolBatchEvent): SourceTaskUpdatedEvent {
  const toolNames = event.tool_calls
    .map((toolCall) => toolCall.tool_name)
    .filter((name) => name.trim() !== "");
  const summary =
    toolNames.length > 0
      ? `Claude completed a batch of ${toolNames.length} tool call(s): ${toolNames.join(", ")}.`
      : "Claude completed a batch of tool calls.";
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "tool_completion",
    semanticHints: {
      activityClass: "tool_completion",
      whyNow: summary,
      confidence: "high",
    },
    title: "Claude tool batch completed",
    summary,
    status: "running",
    metadata: {
      claudeCode: {
        toolBatch: event.tool_calls.map((toolCall) => ({
          toolName: toolCall.tool_name,
          ...(toolCall.tool_use_id ? { toolUseId: toolCall.tool_use_id } : {}),
        })),
      },
    },
  };
}

export function mapUserPromptExpansion(
  event: ClaudeCodeUserPromptExpansionEvent,
): SourceTaskUpdatedEvent {
  const prompt = readString(event.expanded_prompt) ?? readString(event.prompt);
  const summary = prompt
    ? `${event.command_name}: ${prompt}`
    : `Claude expanded /${event.command_name}.`;
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(
      "Claude expanded a slash command before sending it to the model.",
    ),
    title: "Claude prompt expanded",
    summary,
    status: "running",
  };
}

export function mapFileChanged(event: ClaudeCodeFileChangedEvent): SourceTaskUpdatedEvent {
  const fileName = basename(event.file_path);
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(
      "A watched file changed during the Claude Code session.",
    ),
    title: "Claude watched file changed",
    summary: `${fileName} ${fileChangedVerb(event.event)}.`,
    status: "running",
    metadata: {
      claudeCode: {
        fileChanged: {
          path: event.file_path,
          event: event.event,
        },
      },
    },
  };
}

export function mapWorktreeCreate(event: ClaudeCodeWorktreeCreateEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeWorktreeTaskId(event.session_id, event.name),
    timestamp: nowIso(),
    source: claudeSource(event),
    semanticHints: sessionStatusSemanticHints("Claude is creating an isolated worktree."),
    title: "Claude worktree create requested",
    summary: event.name,
  };
}

export function mapWorktreeRemove(event: ClaudeCodeWorktreeRemoveEvent): SourceTaskCompletedEvent {
  const worktreeName = event.name ?? basename(event.worktree_path);
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeWorktreeTaskId(event.session_id, worktreeName),
    timestamp: nowIso(),
    source: claudeSource(event),
    summary: `Claude removed worktree ${event.worktree_path}.`,
  };
}

function sessionStatusSemanticHints(
  whyNow: string,
): NonNullable<SourceTaskUpdatedEvent["semanticHints"]> {
  return {
    activityClass: "session_status",
    whyNow,
    confidence: "high",
  };
}

function claudeWorktreeTaskId(sessionId: string, name: string): string {
  return `${claudeTaskId(sessionId)}:worktree:${encodeURIComponent(name)}`;
}

function fileChangedVerb(event: ClaudeCodeFileChangedEvent["event"]): string {
  switch (event) {
    case "add":
      return "was added";
    case "change":
      return "changed";
    case "unlink":
      return "was removed";
    default:
      return "changed";
  }
}
