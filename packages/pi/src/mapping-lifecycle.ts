import type {
  SourceEvent,
  SourceTaskStartedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  PiAgentEndEvent,
  PiAgentStartEvent,
  PiBeforeAgentStartEvent,
  PiInputEvent,
  PiModelSelectEvent,
  PiSessionShutdownEvent,
  PiSessionStartEvent,
  PiThinkingLevelSelectEvent,
  PiTurnEndEvent,
  PiTurnStartEvent,
} from "./types.js";
import {
  compactJson,
  contextItem,
  createPiInstanceKey,
  eventTimestamp,
  piEventMetadata,
  piSource,
  piTaskId,
  readModelLabel,
  stableTextKey,
  taskActivitySemanticHints,
  type PiMappingContext,
} from "./mapping-shared.js";

type TaskContextItem = NonNullable<NonNullable<SourceTaskUpdatedEvent["context"]>["items"]>[number];

export function mapSessionStart(
  event: PiSessionStartEvent,
  context: PiMappingContext,
): SourceTaskStartedEvent {
  const instanceKey = createPiInstanceKey(context);
  return {
    id: `pi:${instanceKey}:event:session_start:${event.reason ?? "startup"}`,
    type: "task.started",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    metadata: piEventMetadata({
      pi: {
        reason: event.reason ?? "startup",
        ...(event.previousSessionFile ? { previousSessionFile: event.previousSessionFile } : {}),
      },
    }),
    title: "Pi session started",
    summary: `Pi session ${event.reason ?? "startup"}.`,
  };
}

export function mapSessionShutdown(
  event: PiSessionShutdownEvent,
  context: PiMappingContext,
): SourceEvent[] {
  const instanceKey = createPiInstanceKey(context);
  return [
    {
      id: `pi:${instanceKey}:event:session_shutdown:${event.reason ?? "quit"}`,
      type: "task.completed",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          reason: event.reason ?? "quit",
          ...(event.targetSessionFile ? { targetSessionFile: event.targetSessionFile } : {}),
        },
      }),
      summary: `Pi session shutdown: ${event.reason ?? "quit"}.`,
    },
  ];
}

export function mapBeforeAgentStart(
  event: PiBeforeAgentStartEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const contextItems = [
    contextItem("cwd", "Working Directory", context.cwd),
    contextItem("systemPrompt", "System Prompt", event.systemPrompt),
  ].filter((item): item is TaskContextItem => item !== null);
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:before_agent_start`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "session_status",
    title: "Pi accepted a prompt",
    status: "running",
    semanticHints: taskActivitySemanticHints("session_status"),
  };
  if (event.prompt) {
    mapped.summary = event.prompt;
  }
  if (contextItems.length > 0) {
    mapped.context = { items: contextItems };
  }
  return mapped;
}

export function mapAgentStart(
  _event: PiAgentStartEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  return {
    id: `pi:${instanceKey}:event:agent_start`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "session_status",
    title: "Pi started working",
    status: "running",
    semanticHints: taskActivitySemanticHints("session_status"),
  };
}

export function mapAgentEnd(event: PiAgentEndEvent, context: PiMappingContext): SourceEvent[] {
  const instanceKey = createPiInstanceKey(context);
  return [
    {
      id: `pi:${instanceKey}:event:agent_end`,
      type: "task.completed",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          messageCount: Array.isArray(event.messages) ? event.messages.length : undefined,
        },
      }),
      summary: "Pi finished the agent loop.",
    },
  ];
}

export function mapTurnStart(
  event: PiTurnStartEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const turn = event.turnIndex ?? 0;
  return {
    id: `pi:${instanceKey}:event:turn_start:${turn}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "session_status",
    title: `Pi turn ${turn + 1} started`,
    status: "running",
    semanticHints: taskActivitySemanticHints("session_status"),
  };
}

export function mapTurnEnd(
  event: PiTurnEndEvent,
  context: PiMappingContext,
): SourceTaskUpdatedEvent {
  const instanceKey = createPiInstanceKey(context);
  const turn = event.turnIndex ?? 0;
  const mapped: SourceTaskUpdatedEvent = {
    id: `pi:${instanceKey}:event:turn_end:${turn}`,
    type: "task.updated",
    taskId: piTaskId(instanceKey),
    timestamp: eventTimestamp(context),
    source: piSource(context),
    activityClass: "session_status",
    title: `Pi turn ${turn + 1} completed`,
    status: "running",
    semanticHints: taskActivitySemanticHints("session_status"),
  };
  const summary = compactJson(event.toolResults);
  if (summary) {
    mapped.summary = summary;
  }
  return mapped;
}

export function mapInput(event: PiInputEvent, context: PiMappingContext): SourceEvent[] {
  if (!event.text) {
    return [];
  }
  const instanceKey = createPiInstanceKey(context);
  return [
    {
      id: `pi:${instanceKey}:event:input:${stableTextKey(event.text)}`,
      type: "task.updated",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          inputSource: event.source ?? "interactive",
        },
      }),
      activityClass: "session_status",
      title: "Pi received input",
      summary: event.text,
      status: "running",
      semanticHints: taskActivitySemanticHints("session_status"),
    },
  ];
}

export function mapModelSelect(
  event: PiModelSelectEvent,
  context: PiMappingContext,
): SourceEvent[] {
  const model = readModelLabel(event.model);
  if (!model) {
    return [];
  }
  const instanceKey = createPiInstanceKey(context);
  return [
    {
      id: `pi:${instanceKey}:event:model_select:${encodeURIComponent(model)}`,
      type: "task.updated",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          model,
          previousModel: readModelLabel(event.previousModel),
          source: event.source,
        },
      }),
      activityClass: "session_status",
      title: "Pi model changed",
      summary: model,
      status: "running",
      semanticHints: taskActivitySemanticHints("session_status"),
    },
  ];
}

export function mapThinkingLevelSelect(
  event: PiThinkingLevelSelectEvent,
  context: PiMappingContext,
): SourceEvent[] {
  if (!event.level) {
    return [];
  }
  const instanceKey = createPiInstanceKey(context);
  return [
    {
      id: `pi:${instanceKey}:event:thinking_level_select:${encodeURIComponent(event.level)}`,
      type: "task.updated",
      taskId: piTaskId(instanceKey),
      timestamp: eventTimestamp(context),
      source: piSource(context),
      metadata: piEventMetadata({
        pi: {
          previousLevel: event.previousLevel,
        },
      }),
      activityClass: "session_status",
      title: "Pi thinking level changed",
      summary: event.level,
      status: "running",
      semanticHints: taskActivitySemanticHints("session_status"),
    },
  ];
}
