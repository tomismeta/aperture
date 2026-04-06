import type { SourceEvent } from "@tomismeta/aperture-core";

import {
  createReplayScenarioFromImportedSession,
  createSessionBundleFromImportedSession,
  type ImportedSession,
  type ImportedSessionEntry,
  type ImportedSessionRawReference,
} from "./imported-session.js";
import type { ReplayScenario } from "./scenario.js";
import type { ReplaySessionBundle, ReplaySessionBundleSource } from "./session-bundle.js";
import {
  buildAssistantTitle,
  buildObservationTitle,
  clipText,
  coerceImportedTimestamp,
  inferAssistantStatus,
  inferObservationStatus,
  isRecord,
  normalizeToolFamily,
  readIssueTitle,
  slug,
  stringifyStructuredValue,
  syntheticTimestamp,
  toSingleLine,
  trajectorySlug,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DEFAULT_PI_SPLIT,
  PI_DATASET,
  type PiMonoContentBlock,
  type PiMonoMessage,
  type PiMonoRow,
  type PiMonoSplit,
  type PiMonoTrace,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

type PiMonoIndexedTrace = {
  trace: PiMonoTrace;
  traceIndex: number;
};

type PiMonoTraceType = NonNullable<PiMonoTrace["type"]>;
type PiMonoMessageRole = NonNullable<PiMonoMessage["role"]>;

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

export function parsePiMonoRow(value: unknown): PiMonoRow {
  if (!isRecord(value)) {
    throw new Error("Invalid Pi row: expected an object.");
  }

  if (
    typeof value.harness !== "string"
    || typeof value.session_id !== "string"
    || typeof value.file_name !== "string"
    || !Array.isArray(value.traces)
  ) {
    throw new Error("Invalid Pi row: expected harness, session_id, file_name, and traces.");
  }

  return {
    harness: value.harness,
    session_id: value.session_id,
    file_name: value.file_name,
    ...(typeof value.source_dataset === "string" ? { source_dataset: value.source_dataset } : {}),
    traces: value.traces.map((trace, index) => parsePiMonoTrace(trace, value.session_id as string, index)),
  };
}

export function readPiMonoSplit(
  value: PublicTrajectorySplit | undefined,
): PiMonoSplit {
  if (value === undefined || value === "train") {
    return value ?? DEFAULT_PI_SPLIT;
  }

  throw new Error("pi split must be: train");
}

function parsePiMonoTrace(
  value: unknown,
  sessionId: string,
  index: number,
): PiMonoTrace {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`Invalid Pi trace at ${sessionId}.traces[${index}].`);
  }

  const traceType = value.type as PiMonoTraceType;

  return {
    type: traceType,
    ...(typeof value.version === "number" ? { version: value.version } : {}),
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.parentId === "string" || value.parentId === null ? { parentId: value.parentId } : {}),
    ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    ...(typeof value.parentSession === "string" ? { parentSession: value.parentSession } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(typeof value.thinkingLevel === "string" ? { thinkingLevel: value.thinkingLevel } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.firstKeptEntryId === "string" ? { firstKeptEntryId: value.firstKeptEntryId } : {}),
    ...(typeof value.fromId === "string" ? { fromId: value.fromId } : {}),
    ...(typeof value.customType === "string" ? { customType: value.customType } : {}),
    ...("data" in value ? { data: value.data } : {}),
    ...(typeof value.content === "string" || Array.isArray(value.content) ? { content: value.content as string | PiMonoContentBlock[] } : {}),
    ...(typeof value.display === "boolean" ? { display: value.display } : {}),
    ...("details" in value ? { details: value.details } : {}),
    ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(isRecord(value.message) ? { message: parsePiMonoMessage(value.message, sessionId, index) } : {}),
  };
}

function parsePiMonoMessage(
  value: Record<string, unknown>,
  sessionId: string,
  index: number,
): PiMonoMessage {
  if (typeof value.role !== "string") {
    throw new Error(`Invalid Pi message at ${sessionId}.traces[${index}].message.`);
  }

  const role = value.role as PiMonoMessageRole;

  return {
    role,
    ...(typeof value.content === "string" || Array.isArray(value.content) ? { content: value.content as string | PiMonoContentBlock[] } : {}),
    ...(typeof value.timestamp === "number" ? { timestamp: value.timestamp } : {}),
    ...(typeof value.api === "string" ? { api: value.api } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...("usage" in value ? { usage: value.usage } : {}),
    ...(typeof value.stopReason === "string" ? { stopReason: value.stopReason } : {}),
    ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
    ...(typeof value.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...("details" in value ? { details: value.details } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
    ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
    ...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
    ...(typeof value.fullOutputPath === "string" ? { fullOutputPath: value.fullOutputPath } : {}),
    ...(typeof value.excludeFromContext === "boolean" ? { excludeFromContext: value.excludeFromContext } : {}),
    ...(typeof value.customType === "string" ? { customType: value.customType } : {}),
    ...(typeof value.display === "boolean" ? { display: value.display } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.fromId === "string" ? { fromId: value.fromId } : {}),
    ...(typeof value.tokensBefore === "number" ? { tokensBefore: value.tokensBefore } : {}),
  };
}

function readPiMonoSessionName(path: readonly PiMonoIndexedTrace[]): string | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const trace = path[index]?.trace;
    if (trace && trace.type === "session_info" && typeof trace.name === "string") {
      const normalized = trace.name.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
}

function readPiMonoSessionNameFromTraces(traces: readonly PiMonoTrace[]): string | undefined {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (trace?.type === "session_info" && typeof trace.name === "string") {
      const normalized = trace.name.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
}

function readPiMonoFirstPrompt(path: readonly PiMonoIndexedTrace[]): string | undefined {
  for (const { trace } of path) {
    if (trace.type !== "message" || !isRecord(trace.message) || trace.message.role !== "user") {
      continue;
    }
    const text = readPiMonoMessageText(trace.message.content);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function readPiMonoMessageText(
  content: string | PiMonoContentBlock[] | undefined,
): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const textBlocks = content
    .filter((block): block is PiMonoContentBlock & { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter((block) => block.length > 0);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n");
  }

  return undefined;
}

function readPiMonoAssistantText(
  content: string | PiMonoContentBlock[] | undefined,
): string | undefined {
  return readPiMonoMessageText(content);
}

function readPiMonoToolCalls(
  content: string | PiMonoContentBlock[] | undefined,
): Array<{ id: string; name: string; arguments: unknown }> {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block) => {
    if (
      !isRecord(block)
      || block.type !== "toolCall"
      || typeof block.id !== "string"
      || typeof block.name !== "string"
    ) {
      return [];
    }

    return [{
      id: block.id,
      name: block.name,
      arguments: block.arguments,
    }];
  });
}

function readPiMonoToolResultText(message: PiMonoMessage): string | undefined {
  return readPiMonoMessageText(message.content)
    ?? stringifyStructuredValue(message.details)
    ?? undefined;
}

function summarizePiMonoToolCall(
  toolCall: { id: string; name: string; arguments: unknown },
): string | undefined {
  const argsText = stringifyStructuredValue(toolCall.arguments);
  return argsText ? `${toolCall.name}\n${argsText}` : toolCall.name;
}

function summarizePiMonoBashExecution(message: PiMonoMessage): string | undefined {
  const parts = [
    typeof message.command === "string" && message.command.trim().length > 0
      ? `command: ${message.command.trim()}`
      : undefined,
    typeof message.output === "string" && message.output.trim().length > 0
      ? message.output.trim()
      : undefined,
    typeof message.exitCode === "number"
      ? `exit_code: ${message.exitCode}`
      : undefined,
    message.cancelled ? "cancelled: true" : undefined,
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function inferPiMonoToolResultStatus(
  message: PiMonoMessage,
  text: string | undefined,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  if (message.isError) {
    return "failed";
  }

  if (!text) {
    return "running";
  }

  return inferObservationStatus(text, toolFamily);
}

function inferPiMonoBashExecutionStatus(
  message: PiMonoMessage,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  if (message.cancelled) {
    return "failed";
  }

  if (typeof message.exitCode === "number" && message.exitCode !== 0) {
    return "failed";
  }

  if (typeof message.output === "string" && message.output.trim().length > 0) {
    return inferObservationStatus(message.output, "bash");
  }

  return "running";
}

function summarizePiMonoMessageContext(message: PiMonoMessage): string | undefined {
  if (message.role === "custom") {
    return readPiMonoMessageText(message.content)
      ?? stringifyStructuredValue(message.details)
      ?? undefined;
  }

  if (message.role === "branchSummary" || message.role === "compactionSummary") {
    return typeof message.summary === "string" && message.summary.trim().length > 0
      ? message.summary.trim()
      : readPiMonoMessageText(message.content);
  }

  return undefined;
}

function summarizePiMonoTraceBoundary(trace: PiMonoTrace): string | undefined {
  switch (trace.type) {
    case "model_change":
      if (typeof trace.provider === "string" && typeof trace.modelId === "string") {
        return `model change: ${trace.provider}/${trace.modelId}`;
      }
      return typeof trace.modelId === "string" ? `model change: ${trace.modelId}` : undefined;
    case "thinking_level_change":
      return typeof trace.thinkingLevel === "string" ? `thinking level: ${trace.thinkingLevel}` : undefined;
    case "compaction":
      return typeof trace.summary === "string" ? trace.summary.trim() : undefined;
    case "branch_summary":
      return typeof trace.summary === "string" ? trace.summary.trim() : undefined;
    case "custom_message":
      return readPiMonoMessageText(trace.content) ?? stringifyStructuredValue(trace.details) ?? undefined;
    case "custom":
      return stringifyStructuredValue(trace.data) ?? undefined;
    case "label":
      if (typeof trace.label === "string" && typeof trace.targetId === "string") {
        return `label ${trace.label} -> ${trace.targetId}`;
      }
      return typeof trace.label === "string" ? `label ${trace.label}` : undefined;
    default:
      return undefined;
  }
}

function createPiMonoBoundaryEntry(options: {
  entries: ImportedSessionEntry[];
  timestamp: string;
  trace: PiMonoTrace;
  rawRef: ImportedSessionRawReference;
  label: string;
  text: string;
}): ImportedSessionEntry {
  return {
    index: options.entries.length,
    timestamp: options.timestamp,
    ...buildPiMonoTraceIdentity(options.trace),
    role: "system",
    kind: "boundary",
    significance: "context",
    label: options.label,
    text: options.text,
    excerpt: clipText(options.text, 240),
    rawRef: options.rawRef,
  };
}

function buildPiMonoRawRef(
  trace: PiMonoTrace,
  traceIndex: number,
): ImportedSessionRawReference {
  return {
    line: traceIndex + 1,
    ...(typeof trace.id === "string" ? { id: trace.id } : {}),
  };
}

function buildPiMonoTraceIdentity(trace: PiMonoTrace): Partial<Pick<ImportedSessionEntry, "entryId" | "parentEntryId">> {
  return {
    ...(typeof trace.id === "string" ? { entryId: trace.id } : {}),
    ...(typeof trace.parentId === "string" ? { parentEntryId: trace.parentId } : {}),
  };
}

function buildPiMonoParentReference(
  parentEntryId: string | undefined,
  trace: PiMonoTrace,
): Partial<Pick<ImportedSessionEntry, "parentEntryId">> {
  if (parentEntryId) {
    return { parentEntryId };
  }

  if (typeof trace.parentId === "string") {
    return { parentEntryId: trace.parentId };
  }

  return {};
}

function selectPiMonoReplayPath(traces: readonly PiMonoTrace[]): {
  path: PiMonoIndexedTrace[];
  leafId?: string;
  mode: "deepest-leaf" | "sequential";
} {
  const indexed = traces
    .map((trace, traceIndex) => ({ trace, traceIndex }))
    .filter(({ trace }) => trace.type !== "session" && typeof trace.id === "string");

  if (indexed.length === 0) {
    return {
      path: traces
        .map((trace, traceIndex) => ({ trace, traceIndex }))
        .filter(({ trace }) => trace.type !== "session"),
      mode: "sequential",
    };
  }

  const byId = new Map(indexed.map((entry) => [entry.trace.id!, entry] as const));
  const childIds = new Set<string>();
  for (const { trace } of indexed) {
    if (typeof trace.parentId === "string") {
      childIds.add(trace.parentId);
    }
  }

  const leaves = indexed.filter(({ trace }) => !childIds.has(trace.id!));
  const bestLeaf = leaves.reduce<PiMonoIndexedTrace | undefined>((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const bestDepth = readPiMonoTraceDepth(best, byId);
    const candidateDepth = readPiMonoTraceDepth(candidate, byId);
    if (candidateDepth !== bestDepth) {
      return candidateDepth > bestDepth ? candidate : best;
    }

    const bestTime = readPiMonoTraceTime(best);
    const candidateTime = readPiMonoTraceTime(candidate);
    if (candidateTime !== bestTime) {
      return candidateTime > bestTime ? candidate : best;
    }

    return candidate.traceIndex > best.traceIndex ? candidate : best;
  }, undefined);

  if (!bestLeaf) {
    return {
      path: indexed,
      mode: "sequential",
    };
  }

  const path: PiMonoIndexedTrace[] = [];
  let current: PiMonoIndexedTrace | undefined = bestLeaf;
  while (current) {
    path.push(current);
    current = typeof current.trace.parentId === "string"
      ? byId.get(current.trace.parentId)
      : undefined;
  }
  path.reverse();

  return {
    path,
    mode: "deepest-leaf",
    ...(bestLeaf.trace.id ? { leafId: bestLeaf.trace.id } : {}),
  };
}

function readPiMonoTraceDepth(
  indexedTrace: PiMonoIndexedTrace,
  byId: Map<string, PiMonoIndexedTrace>,
): number {
  let depth = 0;
  let current: PiMonoIndexedTrace | undefined = indexedTrace;
  while (current) {
    depth += 1;
    current = typeof current.trace.parentId === "string"
      ? byId.get(current.trace.parentId)
      : undefined;
  }
  return depth;
}

function readPiMonoTraceTime(indexedTrace: PiMonoIndexedTrace): number {
  const parsed = typeof indexedTrace.trace.timestamp === "string"
    ? Date.parse(indexedTrace.trace.timestamp)
    : Number.NaN;
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return Date.parse(syntheticTimestamp(indexedTrace.traceIndex));
}

export const createImportedSessionFromPiRow = createImportedSessionFromPiMonoRow;
export const createReplayScenarioFromPiRow = createReplayScenarioFromPiMonoRow;
export const createSessionBundleFromPiRow = createSessionBundleFromPiMonoRow;
export const defaultPiBundleSource = defaultPiMonoBundleSource;
export const parsePiRow = parsePiMonoRow;
export const readPiSplit = readPiMonoSplit;
