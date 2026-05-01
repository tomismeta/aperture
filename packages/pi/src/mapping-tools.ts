import type {
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  PiToolCallEvent,
  PiToolExecutionEndEvent,
  PiToolExecutionStartEvent,
  PiToolExecutionUpdateEvent,
  PiToolResultEvent,
  PiUserBashEvent,
} from "./types.js";
import {
  activityClassForToolEnd,
  compactJson,
  contextItem,
  createPiInstanceKey,
  eventTimestamp,
  piEventMetadata,
  piInteractionId,
  piSource,
  piTaskId,
  readString,
  riskHintForTool,
  stableTextKey,
  taskActivitySemanticHints,
  toolApprovalSemanticHints,
  toolFamilyFor,
  type PiMappingContext,
} from "./mapping-shared.js";

type HumanContextItem = NonNullable<
  NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]
>[number];

export function mapToolCall(
  event: PiToolCallEvent,
  context: PiMappingContext,
): SourceHumanInputRequestedEvent {
  const instanceKey = createPiInstanceKey(context);
  const inputSummary = summarizeToolInput(event.toolName, event.input);
  const toolFamily = toolFamilyFor(event.toolName);
  const detail = detailFieldFor(event.toolName);
  const contextItems = [
    contextItem(detail.id, detail.label, inputSummary),
    contextItem("toolCallId", "Tool Call ID", event.toolCallId),
    contextItem("cwd", "Working Directory", context.cwd),
  ].filter((item): item is HumanContextItem => item !== null);

  const mapped: SourceHumanInputRequestedEvent = {
    id: `pi:${instanceKey}:event:tool_call:${encodeURIComponent(event.toolCallId)}`,
    type: "human.input.requested",
    taskId: piTaskId(instanceKey),
    interactionId: piInteractionId(instanceKey, event.toolCallId),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "permission_request",
    title: `Pi wants to run ${event.toolName}`,
    summary: inputSummary ?? `Pi requested permission to run ${event.toolName}.`,
    request: {
      kind: "approval",
      requireReason: false,
    },
    semanticHints: toolApprovalSemanticHints(event.toolName),
    provenance: {
      whyNow: `Pi paused before running ${event.toolName}.`,
    },
    riskHint: riskHintForTool(event.toolName),
  };

  if (toolFamily) {
    mapped.toolFamily = toolFamily;
  }
  if (contextItems.length > 0) {
    mapped.context = { items: contextItems };
  }

  return mapped;
}

export function mapToolExecutionStart(
  event: PiToolExecutionStartEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:tool_execution_start:${encodeURIComponent(event.toolCallId)}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "status_update",
    title: `Pi is running ${event.toolName}`,
    status: "running",
    semanticHints: taskActivitySemanticHints("status_update"),
  };
  const toolFamily = toolFamilyFor(event.toolName);
  if (toolFamily) {
    mapped.toolFamily = toolFamily;
  }
  const summary = summarizeToolInput(event.toolName, event.args);
  if (summary) {
    mapped.summary = summary;
  }
  return mapped;
}

export function mapToolExecutionUpdate(
  event: PiToolExecutionUpdateEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent[] {
  const summary = compactJson(event.partialResult);
  if (!summary) {
    return [];
  }
  const instanceKey = createPiInstanceKey(context);
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:tool_execution_update:${encodeURIComponent(event.toolCallId)}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "status_update",
    title: `Pi updated ${event.toolName}`,
    summary,
    status: "running",
    semanticHints: taskActivitySemanticHints("status_update"),
  };
  const toolFamily = toolFamilyFor(event.toolName);
  if (toolFamily) {
    mapped.toolFamily = toolFamily;
  }
  return [mapped];
}

export function mapToolExecutionEnd(
  event: PiToolExecutionEndEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const activityClass = activityClassForToolEnd(event.isError);
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:tool_execution_end:${encodeURIComponent(event.toolCallId)}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass,
    title: event.isError ? `Pi ${event.toolName} failed` : `Pi finished ${event.toolName}`,
    status: event.isError ? "failed" : "running",
    semanticHints: taskActivitySemanticHints(activityClass),
  };
  const toolFamily = toolFamilyFor(event.toolName);
  if (toolFamily) {
    mapped.toolFamily = toolFamily;
  }
  const summary = compactJson(event.result);
  if (summary) {
    mapped.summary = summary;
  }
  return mapped;
}

export function mapToolResult(
  event: PiToolResultEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const activityClass = activityClassForToolEnd(event.isError);
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:tool_result:${encodeURIComponent(event.toolCallId)}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass,
    title: event.isError
      ? `Pi ${event.toolName} result failed`
      : `Pi recorded ${event.toolName} result`,
    status: event.isError ? "failed" : "running",
    semanticHints: taskActivitySemanticHints(activityClass),
  };
  const toolFamily = toolFamilyFor(event.toolName);
  if (toolFamily) {
    mapped.toolFamily = toolFamily;
  }
  const summary = compactJson(event.details) ?? compactJson(event.content);
  if (summary) {
    mapped.summary = summary;
  }
  return mapped;
}

export function mapUserBash(
  event: PiUserBashEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent[] {
  if (!event.command) {
    return [];
  }
  const nextContext = { ...context };
  if (!nextContext.cwd && event.cwd) {
    nextContext.cwd = event.cwd;
  }
  const instanceKey = createPiInstanceKey(nextContext);
  return [
    {
      id: `pi:${instanceKey}:event:user_bash:${stableTextKey(event.command)}`,
      type: "task.updated",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          excludeFromContext: event.excludeFromContext === true,
        },
      }),
      toolFamily: "bash",
      activityClass: "status_update",
      title: "Pi user bash command",
      summary: event.command,
      status: "running",
      semanticHints: taskActivitySemanticHints("status_update"),
    },
  ];
}

function summarizeToolInput(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return compactJson(input);
  }
  const record = input as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return readString(record.command) ?? compactJson(input);
    case "read":
    case "write":
    case "edit":
    case "grep":
    case "find":
    case "ls":
      return readString(record.path) ?? readString(record.pattern) ?? compactJson(input);
    default:
      return compactJson(input);
  }
}

function detailFieldFor(toolName: string): { id: string; label: string } {
  switch (toolName) {
    case "bash":
      return { id: "command", label: "Command" };
    case "read":
    case "write":
    case "edit":
    case "ls":
      return { id: "path", label: "Path" };
    case "grep":
    case "find":
      return { id: "query", label: "Query" };
    default:
      return { id: "input", label: "Input" };
  }
}
