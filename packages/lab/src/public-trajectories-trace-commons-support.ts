import type { SourceEvent } from "@tomismeta/aperture-core";

import {
  TRACE_COMMONS_AGENT_TRACES_DATASET,
  type TraceCommonsContentBlock,
  type TraceCommonsMessage,
  type TraceCommonsRow,
  type TraceCommonsSplit,
  type TraceCommonsToolCall,
  type TraceCommonsToolDefinition,
} from "./public-trajectories-types.js";
import {
  buildAssistantTitle,
  buildObservationTitle,
  clipText,
  coerceImportedTimestamp,
  inferObservationStatus,
  isRecord,
  normalizeToolFamily,
  stringifyStructuredValue,
  trajectorySlug,
} from "./public-trajectories-shared.js";
import {
  readTraceCommonsSourceIdentity,
  stableTraceCommonsRowDigest,
} from "./public-trajectories-trace-commons-parse.js";

export type NormalizedTraceCommonsToolCall = { id?: string; name: string; input?: unknown };

export function buildTraceCommonsTaskId(row: TraceCommonsRow): string {
  return `public:trace-commons:${trajectorySlug(row.harness)}:${trajectorySlug(row.session_id)}`;
}

export function coerceTraceCommonsEntryTimestamp(
  messageTimestamp: string | undefined,
  baseTimestamp: string,
  stepIndex: number,
): string {
  if (messageTimestamp) {
    return coerceImportedTimestamp(messageTimestamp, undefined, stepIndex);
  }
  const baseMillis = Date.parse(baseTimestamp);
  if (Number.isFinite(baseMillis)) {
    return new Date(baseMillis + stepIndex * 1000).toISOString();
  }
  return coerceImportedTimestamp(undefined, undefined, stepIndex);
}

export function readTraceCommonsFirstPrompt(row: TraceCommonsRow): string {
  const firstUserMessage = row.messages.find((message) =>
    normalizeTraceCommonsRole(message.role) === "user" &&
    readTraceCommonsContentText(message.content).length > 0);
  return firstUserMessage
    ? readTraceCommonsContentText(firstUserMessage.content)
    : row.prompt.trim() || "Imported Trace Commons session";
}

export function readTraceCommonsMessageTimestamp(message: TraceCommonsMessage): string | undefined {
  return message.timestamp ?? message.created_at ?? message.sent_at;
}

export function normalizeTraceCommonsRole(role: string | undefined): "system" | "user" | "assistant" | "tool" | "other" {
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  if (role === "toolResult" || role === "bashExecution") {
    return "tool";
  }
  return "other";
}

export function readTraceCommonsContentText(content: TraceCommonsMessage["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => readTraceCommonsBlockText(block))
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}

export function readTraceCommonsToolCalls(message: TraceCommonsMessage): NormalizedTraceCommonsToolCall[] {
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap((call) => normalizeTraceCommonsToolCall(call))
    : [];
  const blockCalls = Array.isArray(message.content)
    ? message.content.flatMap((block) => normalizeTraceCommonsToolCall(block))
    : [];
  return [...toolCalls, ...blockCalls];
}

export function summarizeTraceCommonsToolCall(toolCall: NormalizedTraceCommonsToolCall): string | null {
  const input = stringifyStructuredValue(toolCall.input);
  return input ? `${toolCall.name}: ${input}` : toolCall.name;
}

export function readTraceCommonsToolResultName(message: TraceCommonsMessage): string {
  return (message.name ?? message.toolName ?? "").trim();
}

export function readTraceCommonsToolResultText(message: TraceCommonsMessage): string | null {
  return (
    readTraceCommonsContentText(message.content) ||
    stringifyStructuredValue(message.output ?? message.result ?? message.error)
  );
}

export function inferTraceCommonsToolResultStatus(
  message: TraceCommonsMessage,
  text: string | null,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalizedStatus = typeof message.status === "string" ? message.status.toLowerCase() : "";
  if (message.isError || normalizedStatus.includes("fail") || normalizedStatus.includes("error")) {
    return "failed";
  }
  if (normalizedStatus.includes("wait") || normalizedStatus.includes("pending")) {
    return "waiting";
  }
  return text ? inferObservationStatus(text, toolFamily) : "running";
}

export function buildTraceCommonsAssistantTitle(
  toolFamily: string | undefined,
  summary: string | null,
  toolName: string,
): string {
  return buildAssistantTitle(toolFamily, summary ?? toolName);
}

export function buildTraceCommonsObservationTitle(
  status: Extract<SourceEvent, { type: "task.updated" }>["status"],
  toolFamily: string | undefined,
): string {
  return buildObservationTitle(status, toolFamily);
}

export function normalizeTraceCommonsToolFamily(toolName: string | undefined): string | undefined {
  return normalizeToolFamily(toolName);
}

export function summarizeTraceCommonsContext(row: TraceCommonsRow): string {
  const toolNames = row.tools
    .map((tool) => readTraceCommonsToolDefinitionName(tool))
    .filter((toolName): toolName is string => Boolean(toolName));
  const visibleToolNames = toolNames.slice(0, 16);
  return [
    `harness=${row.harness}`,
    `messages=${row.messages.length}`,
    `trace_events=${row.trace.length}`,
    ...(row.num_user_messages !== undefined ? [`user_messages=${row.num_user_messages}`] : []),
    ...(row.num_tool_calls !== undefined ? [`tool_calls=${row.num_tool_calls}`] : []),
    ...(visibleToolNames.length > 0
      ? [`tools=${visibleToolNames.join(", ")}${toolNames.length > visibleToolNames.length ? ", ..." : ""}`]
      : []),
  ].join("\n");
}

export function buildTraceCommonsProvenanceNotes(
  row: TraceCommonsRow,
  split: TraceCommonsSplit,
): string[] {
  const sourceIdentity = readTraceCommonsSourceIdentity(row);
  const rowDigest = stableTraceCommonsRowDigest(row).slice(0, 24);
  return [
    `dataset=${TRACE_COMMONS_AGENT_TRACES_DATASET}`,
    `split=${split}`,
    "dataset_revision=live_rows_api_unpinned",
    `row_digest_sha256=${rowDigest}`,
    `source_identity=${sourceIdentity}`,
    `session=${row.session_id}`,
    `harness=${row.harness}`,
    `messages=${row.messages.length}`,
    `trace_events=${row.trace.length}`,
    "privacy=public_anonymized_best_effort_review_required",
    "license_scope=dataset_compilation_cc_by_4.0_embedded_content_may_differ",
    ...(row.num_user_messages !== undefined ? [`user_messages=${row.num_user_messages}`] : []),
    ...(row.num_tool_calls !== undefined ? [`tool_calls=${row.num_tool_calls}`] : []),
  ];
}

export function clipTraceCommonsText(value: string, maxLength: number): string {
  return clipText(value, maxLength);
}

function readTraceCommonsBlockText(block: TraceCommonsContentBlock): string {
  if (typeof block.text === "string") {
    return block.text.trim();
  }
  if (typeof block.content === "string") {
    return block.content.trim();
  }
  return stringifyStructuredValue(block.output ?? block.result ?? block.error) ?? "";
}

function normalizeTraceCommonsToolCall(
  value: TraceCommonsToolCall | TraceCommonsContentBlock,
): NormalizedTraceCommonsToolCall[] {
  const record = value as TraceCommonsToolCall;
  const name =
    (isRecord(record.function) && typeof record.function.name === "string"
      ? record.function.name
      : undefined)
    ?? (typeof record.name === "string" ? record.name : undefined)
    ?? (typeof record.toolName === "string" ? record.toolName : undefined)
    ?? (typeof record.tool === "string" ? record.tool : undefined);

  if (!name || !looksLikeTraceCommonsToolCall(value)) {
    return [];
  }

  const input = readTraceCommonsToolInput(record);
  return [{
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    name,
    ...(input !== undefined ? { input } : {}),
  }];
}

function looksLikeTraceCommonsToolCall(value: TraceCommonsToolCall | TraceCommonsContentBlock): boolean {
  return (
    value.type === "toolCall"
    || value.type === "tool_call"
    || value.type === "tool_use"
    || isRecord((value as TraceCommonsToolCall).function)
    || "input" in value
    || "arguments" in value
  );
}

function readTraceCommonsToolInput(value: TraceCommonsToolCall): unknown {
  const raw = isRecord(value.function) && "arguments" in value.function
    ? value.function.arguments
    : "arguments" in value
      ? value.arguments
      : value.input;
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function readTraceCommonsToolDefinitionName(tool: TraceCommonsToolDefinition): string | undefined {
  return (typeof tool.name === "string" ? tool.name : undefined)
    ?? (isRecord(tool.function) && typeof tool.function.name === "string"
      ? tool.function.name
      : undefined);
}
