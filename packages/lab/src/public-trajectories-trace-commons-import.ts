import { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";
import {
  createReplayScenarioFromImportedSession,
  createSessionBundleFromImportedSession,
  type ImportedSession,
  type ImportedSessionEntry,
  type ImportedSessionSource,
} from "./imported-session.js";
import type { ReplayScenario } from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import {
  clipText,
  coerceImportedTimestamp,
  inferAssistantStatus,
  readIssueTitle,
  slug,
  toSingleLine,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DEFAULT_TRACE_COMMONS_SPLIT,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
  type TraceCommonsRow,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { readTraceCommonsSplit } from "./public-trajectories-trace-commons-fetch.js";
import {
  buildTraceCommonsAssistantTitle,
  buildTraceCommonsObservationTitle,
  buildTraceCommonsProvenanceNotes,
  buildTraceCommonsTaskId,
  coerceTraceCommonsEntryTimestamp,
  inferTraceCommonsToolResultStatus,
  normalizeTraceCommonsRole,
  normalizeTraceCommonsToolFamily,
  readTraceCommonsContentText,
  readTraceCommonsFirstPrompt,
  readTraceCommonsMessageTimestamp,
  readTraceCommonsToolCalls,
  readTraceCommonsToolResultName,
  readTraceCommonsToolResultText,
  summarizeTraceCommonsContext,
  summarizeTraceCommonsToolCall,
} from "./public-trajectories-trace-commons-support.js";

const TRACE_COMMONS_DATASET_URL = "https://huggingface.co/datasets/trace-commons/agent-traces";

export function createImportedSessionFromTraceCommonsRow(
  row: TraceCommonsRow,
  options: { split?: TraceCommonsSplit } = {},
): ImportedSession {
  const split = readTraceCommonsSplit(options.split);
  const taskId = buildTraceCommonsTaskId(row);
  const eventSource = {
    id: `public:trace-commons:${slug(row.harness)}:${slug(row.session_id)}`,
    kind: "public-trajectory",
    label: `Trace Commons ${row.harness}`,
  };
  const firstPrompt = readTraceCommonsFirstPrompt(row);
  const title =
    readIssueTitle(firstPrompt) ??
    `Imported Trace Commons ${row.harness} session ${clipText(row.session_id, 64)}`;
  const summary = toSingleLine(firstPrompt) ?? `${row.harness} session ${row.session_id}`;
  const importedAt = coerceImportedTimestamp(row.sent_at, row.sent_at, 0);
  const entries: ImportedSessionEntry[] = [];
  let started = false;
  let lastToolFamily: string | undefined;

  const contextSummary = summarizeTraceCommonsContext(row);
  if (contextSummary) {
    entries.push({
      index: entries.length,
      timestamp: importedAt,
      role: "system",
      kind: "boundary",
      significance: "context",
      label: "trace metadata",
      text: contextSummary,
      excerpt: clipText(contextSummary, 240),
      rawRef: { id: "trace-metadata" },
    });
  }

  for (const [messageIndex, message] of row.messages.entries()) {
    const role = normalizeTraceCommonsRole(message.role);
    const timestampForEntry = () =>
      coerceTraceCommonsEntryTimestamp(
        readTraceCommonsMessageTimestamp(message),
        row.sent_at,
        entries.length,
      );
    const rawRefBase = {
      messageIndex,
      ...(typeof message.id === "string" ? { id: message.id } : {}),
    };

    if (role === "system") {
      const systemText = readTraceCommonsContentText(message.content);
      if (systemText) {
        const timestamp = timestampForEntry();
        entries.push({
          index: entries.length,
          timestamp,
          role: "system",
          kind: "message",
          significance: "context",
          label: `system:${messageIndex}`,
          text: systemText,
          excerpt: clipText(systemText, 240),
          rawRef: rawRefBase,
        });
      }
      continue;
    }

    if (role === "user") {
      const userText = readTraceCommonsContentText(message.content);
      if (!userText) {
        continue;
      }
      if (!started) {
        const timestamp = timestampForEntry();
        entries.push({
          index: entries.length,
          timestamp,
          role: "user",
          kind: "message",
          significance: "attention",
          label: "session prompt",
          text: userText,
          excerpt: clipText(summary, 220),
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:start`,
            type: "task.started",
            taskId,
            timestamp,
            source: eventSource,
            title,
            summary: clipText(summary, 220),
          },
        });
        started = true;
        continue;
      }

      const timestamp = timestampForEntry();
      entries.push({
        index: entries.length,
        timestamp,
        role: "user",
        kind: "message",
        significance: "attention",
        label: `user:followup:${messageIndex}`,
        text: userText,
        excerpt: clipText(userText, 240),
        rawRef: rawRefBase,
        sourceEvent: {
          id: `${taskId}:user:${entries.length}`,
          type: "task.updated",
          taskId,
          timestamp,
          source: eventSource,
          title: "user follow-up",
          summary: clipText(userText, 240),
          status: "running",
        },
      });
      continue;
    }

    if (role === "assistant") {
      const assistantText = readTraceCommonsContentText(message.content);
      if (assistantText) {
        const timestamp = timestampForEntry();
        entries.push({
          index: entries.length,
          timestamp,
          role: "assistant",
          kind: "message",
          significance: "attention",
          label: `assistant:message:${messageIndex}`,
          text: assistantText,
          excerpt: clipText(assistantText, 240),
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:assistant:${entries.length}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            title: clipText(assistantText, 96),
            summary: clipText(assistantText, 240),
            status: inferAssistantStatus(assistantText),
          },
        });
      }

      for (const [toolUseIndex, toolCall] of readTraceCommonsToolCalls(message).entries()) {
        const toolName = toolCall.name.trim();
        const toolFamily = normalizeTraceCommonsToolFamily(toolName);
        if (toolFamily) {
          lastToolFamily = toolFamily;
        }
        const toolCallSummary = summarizeTraceCommonsToolCall(toolCall);
        const timestamp = timestampForEntry();
        entries.push({
          index: entries.length,
          timestamp,
          ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
          role: "assistant",
          kind: "tool_call",
          significance: "attention",
          label: `assistant:tool:${messageIndex}:${toolUseIndex}`,
          ...(toolCallSummary
            ? { text: toolCallSummary, excerpt: clipText(toolCallSummary, 240) }
            : {}),
          toolName,
          ...(toolFamily ? { toolFamily } : {}),
          rawRef: { ...rawRefBase, toolUseIndex },
          sourceEvent: {
            id: `${taskId}:assistant:${messageIndex}:${toolUseIndex}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            ...(toolFamily ? { toolFamily } : {}),
            title: buildTraceCommonsAssistantTitle(toolFamily, toolCallSummary, toolName),
            ...(toolCallSummary ? { summary: clipText(toolCallSummary, 240) } : {}),
            status: "running",
          },
        });
      }
      continue;
    }

    if (role === "tool") {
      const toolName = readTraceCommonsToolResultName(message);
      const toolFamily = normalizeTraceCommonsToolFamily(toolName || lastToolFamily);
      if (toolFamily) {
        lastToolFamily = toolFamily;
      }
      const toolResultText = readTraceCommonsToolResultText(message);
      const toolResultStatus = inferTraceCommonsToolResultStatus(
        message,
        toolResultText,
        toolFamily,
      );
      if (!toolResultText && toolResultStatus === "running") {
        continue;
      }

      const timestamp = timestampForEntry();
      entries.push({
        index: entries.length,
        timestamp,
        ...((message.tool_call_id ?? message.toolCallId)
          ? { toolCallId: message.tool_call_id ?? message.toolCallId }
          : {}),
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        label: `tool:result:${messageIndex}`,
        ...(toolResultText ? { text: toolResultText, excerpt: clipText(toolResultText, 240) } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolFamily ? { toolFamily } : {}),
        rawRef: rawRefBase,
        sourceEvent: {
          id: `${taskId}:tool:${messageIndex}`,
          type: "task.updated",
          taskId,
          timestamp,
          source: eventSource,
          ...(toolFamily ? { toolFamily } : {}),
          title: buildTraceCommonsObservationTitle(toolResultStatus, toolFamily),
          ...(toolResultText ? { summary: clipText(toolResultText, 240) } : {}),
          status: toolResultStatus,
        },
      });
    }
  }

  if (!started) {
    entries.unshift({
      index: 0,
      timestamp: importedAt,
      role: "user",
      kind: "message",
      significance: "attention",
      label: "session prompt",
      text: firstPrompt,
      excerpt: clipText(summary, 220),
      sourceEvent: {
        id: `${taskId}:start`,
        type: "task.started",
        taskId,
        timestamp: importedAt,
        source: eventSource,
        title,
        summary: clipText(summary, 220),
      },
    });
  }

  for (const [index, entry] of entries.entries()) {
    entry.index = index;
  }

  return {
    schemaVersion: IMPORTED_SESSION_SCHEMA_VERSION,
    sessionId: taskId,
    title,
    description: `Imported from ${TRACE_COMMONS_AGENT_TRACES_DATASET} (${split}, ${row.harness}) for session ${row.session_id}.`,
    doctrineTags: ["public_seed", "trajectory", "trace-commons", split, slug(row.harness)],
    source: defaultTraceCommonsBundleSource(row, split),
    importedAt,
    entries,
  };
}

export function createReplayScenarioFromTraceCommonsRow(
  row: TraceCommonsRow,
  options: { split?: TraceCommonsSplit } = {},
): ReplayScenario {
  return createReplayScenarioFromImportedSession(
    createImportedSessionFromTraceCommonsRow(row, options),
  );
}

export function createSessionBundleFromTraceCommonsRow(
  row: TraceCommonsRow,
  options: {
    split?: TraceCommonsSplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = readTraceCommonsSplit(options.split);
  const session = createImportedSessionFromTraceCommonsRow(row, { split });
  const bundle = createSessionBundleFromImportedSession(session, {
    source: defaultTraceCommonsBundleSource(row, split),
    exportedAt: options.exportedAt ?? session.importedAt,
    replayTimeSource: deterministicReplayTimeSource(session.importedAt),
  });
  return validateImportedTrajectoryBundle(bundle);
}

function deterministicReplayTimeSource(startIso: string): () => number {
  const startMs = Date.parse(startIso);
  let tick = 0;
  return () => startMs + tick++;
}

export function defaultTraceCommonsBundleSource(
  row: TraceCommonsRow,
  split: TraceCommonsSplit = DEFAULT_TRACE_COMMONS_SPLIT,
): ImportedSessionSource {
  return {
    id: "huggingface:trace-commons-agent-traces",
    kind: "public-dataset",
    label: "Trace Commons Agent Traces",
    redacted: true,
    upstreamUrl: TRACE_COMMONS_DATASET_URL,
    license: "CC-BY-4.0",
    capture: {
      eventTransport: "huggingface-datasets-server",
      semanticCapture: "source+normalized+trace",
      notes: buildTraceCommonsProvenanceNotes(row, split),
    },
  };
}
