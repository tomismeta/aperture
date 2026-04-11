import {
  createReplayScenarioFromImportedSession,
  createSessionBundleFromImportedSession,
  type ImportedSession,
  type ImportedSessionEntry,
} from "./imported-session.js";
import type { ReplayScenario } from "./scenario.js";
import type { ReplaySessionBundle, ReplaySessionBundleSource } from "./session-bundle.js";
import {
  buildAssistantTitle,
  buildObservationTitle,
  clipText,
  coerceImportedTimestamp,
  inferAssistantStatus,
  isRecord,
  normalizeToolFamily,
  readIssueTitle,
  slug,
  toSingleLine,
  trajectorySlug,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DEFAULT_PI_SPLIT,
  PI_DATASET,
  type PiMonoMessage,
  type PiMonoRow,
  type PiMonoSplit,
} from "./public-trajectories-types.js";
import { readPiMonoSplit } from "./public-trajectories-pi-parse.js";
import {
  buildPiMonoParentReference,
  buildPiMonoRawRef,
  buildPiMonoTraceIdentity,
  createPiMonoBoundaryEntry,
  inferPiMonoBashExecutionStatus,
  inferPiMonoToolResultStatus,
  readPiMonoAssistantText,
  readPiMonoFirstPrompt,
  readPiMonoMessageText,
  readPiMonoSessionName,
  readPiMonoSessionNameFromTraces,
  readPiMonoToolCalls,
  readPiMonoToolResultText,
  selectPiMonoReplayPath,
  summarizePiMonoBashExecution,
  summarizePiMonoMessageContext,
  summarizePiMonoToolCall,
  summarizePiMonoTraceBoundary,
} from "./public-trajectories-pi-support.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

export function createImportedSessionFromPiMonoRow(
  row: PiMonoRow,
  options: { split?: PiMonoSplit } = {},
): ImportedSession {
  const split = readPiMonoSplit(options.split);
  const pathSelection = selectPiMonoReplayPath(row.traces);
  const header = row.traces.find((trace) => trace.type === "session");
  const taskId = `public:${PI_DATASET}:${trajectorySlug(row.session_id)}`;
  const eventSource = {
    id: `public:${PI_DATASET}:${slug(row.session_id)}`,
    kind: DEFAULT_SOURCE_KIND,
    label: `Pi ${row.harness}`,
  };
  const sessionName = readPiMonoSessionName(pathSelection.path) ?? readPiMonoSessionNameFromTraces(row.traces);
  const firstPrompt = readPiMonoFirstPrompt(pathSelection.path) ?? "Imported Pi session";
  const title = readIssueTitle(sessionName ?? firstPrompt) ?? sessionName ?? `Imported Pi session ${row.session_id}`;
  const summary = toSingleLine(firstPrompt) ?? sessionName ?? `${row.file_name} (${row.harness})`;
  const importedAt = coerceImportedTimestamp(
    typeof header?.timestamp === "string" ? header.timestamp : undefined,
    pathSelection.path[0]?.trace.timestamp,
    0,
  );
  const entries: ImportedSessionEntry[] = [];
  let started = false;
  let lastToolFamily: string | undefined;

  for (const indexedTrace of pathSelection.path) {
    const { trace, traceIndex } = indexedTrace;
    const timestamp = coerceImportedTimestamp(trace.timestamp, importedAt, entries.length);
    const rawRefBase = buildPiMonoRawRef(trace, traceIndex);

    if (trace.type === "message" && isRecord(trace.message)) {
      const message = trace.message as PiMonoMessage;

      if (message.role === "user") {
        const userText = readPiMonoMessageText(message.content);
        if (!userText) {
          continue;
        }

        if (!started) {
          entries.push({
            index: entries.length,
            timestamp,
            ...buildPiMonoTraceIdentity(trace),
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

        entries.push({
          index: entries.length,
          timestamp,
          ...buildPiMonoTraceIdentity(trace),
          role: "user",
          kind: "message",
          significance: "attention",
          label: `user:followup:${traceIndex}`,
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

      if (message.role === "assistant") {
        const assistantText = readPiMonoAssistantText(message.content);
        const toolCalls = readPiMonoToolCalls(message.content);
        let assistantEntryId = trace.id;

        if (assistantText) {
          entries.push({
            index: entries.length,
            timestamp,
            ...buildPiMonoTraceIdentity(trace),
            role: "assistant",
            kind: "message",
            significance: "attention",
            label: `assistant:message:${traceIndex}`,
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
          assistantEntryId = trace.id;
        }

        for (const [toolUseIndex, toolCall] of toolCalls.entries()) {
          const toolName = toolCall.name.trim();
          const toolFamily = normalizeToolFamily(toolName);
          if (toolFamily) {
            lastToolFamily = toolFamily;
          }
          const toolCallSummary = summarizePiMonoToolCall(toolCall);
          const entryId = assistantText || toolUseIndex > 0
            ? `${trace.id}:tool:${toolUseIndex}`
            : trace.id;

          entries.push({
            index: entries.length,
            timestamp,
            ...(entryId ? { entryId } : {}),
            ...buildPiMonoParentReference(
              assistantText ? assistantEntryId : undefined,
              trace,
            ),
            ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
            role: "assistant",
            kind: "tool_call",
            significance: "attention",
            label: `assistant:tool:${traceIndex}:${toolUseIndex}`,
            ...(toolCallSummary ? { text: toolCallSummary, excerpt: clipText(toolCallSummary, 240) } : {}),
            ...(toolName ? { toolName } : {}),
            ...(toolFamily ? { toolFamily } : {}),
            rawRef: { ...rawRefBase, toolUseIndex },
            sourceEvent: {
              id: `${taskId}:assistant:${traceIndex}:${toolUseIndex}`,
              type: "task.updated",
              taskId,
              timestamp,
              source: eventSource,
              ...(toolFamily ? { toolFamily } : {}),
              title: buildAssistantTitle(toolFamily, toolCallSummary ?? toolName),
              ...(toolCallSummary ? { summary: clipText(toolCallSummary, 240) } : {}),
              status: "running",
            },
          });
        }
        continue;
      }

      if (message.role === "toolResult") {
        const toolName = typeof message.toolName === "string" ? message.toolName.trim() : "";
        const toolFamily = normalizeToolFamily(toolName || lastToolFamily);
        if (toolFamily) {
          lastToolFamily = toolFamily;
        }
        const toolResultText = readPiMonoToolResultText(message);
        const toolResultStatus = inferPiMonoToolResultStatus(message, toolResultText, toolFamily);
        if (!toolResultText && toolResultStatus === "running") {
          continue;
        }

        entries.push({
          index: entries.length,
          timestamp,
          ...buildPiMonoTraceIdentity(trace),
          ...(typeof message.toolCallId === "string" ? { toolCallId: message.toolCallId } : {}),
          role: "tool",
          kind: "tool_result",
          significance: "attention",
          label: `tool:result:${traceIndex}`,
          ...(toolResultText ? { text: toolResultText, excerpt: clipText(toolResultText, 240) } : {}),
          ...(toolName ? { toolName } : {}),
          ...(toolFamily ? { toolFamily } : {}),
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:tool:${traceIndex}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            ...(toolFamily ? { toolFamily } : {}),
            title: buildObservationTitle(toolResultStatus, toolFamily),
            ...(toolResultText ? { summary: clipText(toolResultText, 240) } : {}),
            status: toolResultStatus,
          },
        });
        continue;
      }

      if (message.role === "bashExecution") {
        const bashSummary = summarizePiMonoBashExecution(message);
        const bashStatus = inferPiMonoBashExecutionStatus(message);
        if (!bashSummary && bashStatus === "running") {
          continue;
        }

        entries.push({
          index: entries.length,
          timestamp,
          ...buildPiMonoTraceIdentity(trace),
          role: "tool",
          kind: "tool_result",
          significance: "attention",
          label: `tool:bash:${traceIndex}`,
          ...(bashSummary ? { text: bashSummary, excerpt: clipText(bashSummary, 240) } : {}),
          toolName: "bash",
          toolFamily: "bash",
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:bash:${traceIndex}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            toolFamily: "bash",
            title: buildObservationTitle(bashStatus, "bash"),
            ...(bashSummary ? { summary: clipText(bashSummary, 240) } : {}),
            status: bashStatus,
          },
        });
        continue;
      }

      const contextualSummary = summarizePiMonoMessageContext(message);
      if (contextualSummary) {
        entries.push(createPiMonoBoundaryEntry({
          entries,
          timestamp,
          trace,
          rawRef: rawRefBase,
          label: `context:${message.role ?? "message"}:${traceIndex}`,
          text: contextualSummary,
        }));
      }
      continue;
    }

    const boundarySummary = summarizePiMonoTraceBoundary(trace);
    if (!boundarySummary) {
      continue;
    }

    entries.push(createPiMonoBoundaryEntry({
      entries,
      timestamp,
      trace,
      rawRef: rawRefBase,
      label: `${trace.type ?? "boundary"}:${traceIndex}`,
      text: boundarySummary,
    }));
  }

  if (!started) {
    entries.unshift({
      index: 0,
      timestamp: importedAt,
      role: "user",
      kind: "message",
      significance: "attention",
      label: "session prompt",
      text: firstPrompt || sessionName || title,
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

  const sourceNotes = [
    `dataset=${PI_DATASET}`,
    `split=${split}`,
    `session=${row.session_id}`,
    `harness=${row.harness}`,
    `file=${row.file_name}`,
    `path_mode=${pathSelection.mode}`,
    `trace_entries=${row.traces.length}`,
    `path_entries=${pathSelection.path.length}`,
    ...(row.source_dataset ? [`source_dataset=${row.source_dataset}`] : []),
    ...(pathSelection.leafId ? [`leaf=${pathSelection.leafId}`] : []),
  ];

  const sourceDataset = typeof row.source_dataset === "string" && row.source_dataset.trim().length > 0
    ? row.source_dataset.trim()
    : undefined;

  return {
    schemaVersion: 1,
    sessionId: taskId,
    title,
    description: `Imported from Pi session traces (${split}, ${row.harness}) for session ${row.session_id}.`,
    doctrineTags: [
      "public_seed",
      "trajectory",
      PI_DATASET,
      split,
      slug(row.harness),
      ...(sourceDataset ? [slug(sourceDataset)] : []),
    ],
    source: {
      id: `public:${PI_DATASET}`,
      kind: "public-dataset",
      label: "Pi sessions",
      redacted: true,
      capture: {
        eventTransport: "huggingface-row-export",
        semanticCapture: "source+normalized+trace",
        notes: sourceNotes,
      },
    },
    importedAt,
    entries,
  };
}

export function createReplayScenarioFromPiMonoRow(
  row: PiMonoRow,
  options: { split?: PiMonoSplit } = {},
): ReplayScenario {
  return createReplayScenarioFromImportedSession(
    createImportedSessionFromPiMonoRow(row, options),
  );
}

export function createSessionBundleFromPiMonoRow(
  row: PiMonoRow,
  options: {
    split?: PiMonoSplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = readPiMonoSplit(options.split);
  const session = createImportedSessionFromPiMonoRow(row, { split });
  const bundle = createSessionBundleFromImportedSession(session, {
    source: defaultPiMonoBundleSource(row, split),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
  });
  return validateImportedTrajectoryBundle(bundle);
}

export function defaultPiMonoBundleSource(
  row: PiMonoRow,
  split: PiMonoSplit = DEFAULT_PI_SPLIT,
): ReplaySessionBundleSource {
  return {
    id: `public:${PI_DATASET}`,
    kind: "public-dataset",
    label: "Pi sessions",
    redacted: true,
    capture: {
      eventTransport: "huggingface-row-export",
      semanticCapture: "source+normalized+trace",
      notes: [
        `dataset=${PI_DATASET}`,
        `split=${split}`,
        `session=${row.session_id}`,
        `harness=${row.harness}`,
        `file=${row.file_name}`,
        ...(row.source_dataset ? [`source_dataset=${row.source_dataset}`] : []),
      ],
    },
  };
}
