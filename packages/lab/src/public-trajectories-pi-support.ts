import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  ImportedSessionEntry,
  ImportedSessionRawReference,
} from "./imported-session.js";
import {
  clipText,
  inferObservationStatus,
  isRecord,
  stringifyStructuredValue,
  syntheticTimestamp,
} from "./public-trajectories-shared.js";
import type {
  PiMonoContentBlock,
  PiMonoMessage,
  PiMonoTrace,
} from "./public-trajectories-types.js";

export type PiMonoIndexedTrace = {
  trace: PiMonoTrace;
  traceIndex: number;
};

export type PiMonoPathSelection = {
  path: PiMonoIndexedTrace[];
  leafId?: string;
  mode: "deepest-leaf" | "sequential";
};

export function readPiMonoSessionName(path: readonly PiMonoIndexedTrace[]): string | undefined {
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

export function readPiMonoSessionNameFromTraces(traces: readonly PiMonoTrace[]): string | undefined {
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

export function readPiMonoFirstPrompt(path: readonly PiMonoIndexedTrace[]): string | undefined {
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

export function readPiMonoMessageText(
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

export function readPiMonoAssistantText(
  content: string | PiMonoContentBlock[] | undefined,
): string | undefined {
  return readPiMonoMessageText(content);
}

export function readPiMonoToolCalls(
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

export function readPiMonoToolResultText(message: PiMonoMessage): string | undefined {
  return readPiMonoMessageText(message.content)
    ?? stringifyStructuredValue(message.details)
    ?? undefined;
}

export function summarizePiMonoToolCall(
  toolCall: { id: string; name: string; arguments: unknown },
): string | undefined {
  const argsText = stringifyStructuredValue(toolCall.arguments);
  return argsText ? `${toolCall.name}\n${argsText}` : toolCall.name;
}

export function summarizePiMonoBashExecution(message: PiMonoMessage): string | undefined {
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

export function inferPiMonoToolResultStatus(
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

export function inferPiMonoBashExecutionStatus(
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

export function summarizePiMonoMessageContext(message: PiMonoMessage): string | undefined {
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

export function summarizePiMonoTraceBoundary(trace: PiMonoTrace): string | undefined {
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

export function createPiMonoBoundaryEntry(options: {
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

export function buildPiMonoRawRef(
  trace: PiMonoTrace,
  traceIndex: number,
): ImportedSessionRawReference {
  return {
    line: traceIndex + 1,
    ...(typeof trace.id === "string" ? { id: trace.id } : {}),
  };
}

export function buildPiMonoTraceIdentity(
  trace: PiMonoTrace,
): Partial<Pick<ImportedSessionEntry, "entryId" | "parentEntryId">> {
  return {
    ...(typeof trace.id === "string" ? { entryId: trace.id } : {}),
    ...(typeof trace.parentId === "string" ? { parentEntryId: trace.parentId } : {}),
  };
}

export function buildPiMonoParentReference(
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

export function selectPiMonoReplayPath(traces: readonly PiMonoTrace[]): PiMonoPathSelection {
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
