import { createHash } from "node:crypto";
import path from "node:path";

import {
  type TraceCommonsContentBlock,
  type TraceCommonsMessage,
  type TraceCommonsRow,
  type TraceCommonsToolCall,
  type TraceCommonsToolDefinition,
  type TraceCommonsTraceEvent,
} from "./public-trajectories-types.js";
import { isRecord, syntheticTimestamp } from "./public-trajectories-shared.js";

export function parseTraceCommonsRowsResponse(value: unknown): TraceCommonsRow[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("Invalid Trace Commons dataset response: expected a rows array.");
  }

  return value.rows.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.row)) {
      throw new Error(`Invalid Trace Commons dataset response at row ${index}.`);
    }
    return parseTraceCommonsRow(entry.row, readDatasetRowIndex(entry, index));
  });
}

export function stableTraceCommonsRowDigest(row: TraceCommonsRow): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

export function readTraceCommonsSourceIdentity(row: TraceCommonsRow): string {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const sourceFile = typeof metadata.source_file === "string" ? metadata.source_file : undefined;
  return sourceFile ?? (row.file_path ? path.basename(row.file_path) : row.session_id);
}

function parseTraceCommonsRow(value: Record<string, unknown>, index: number): TraceCommonsRow {
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const trace = Array.isArray(value.trace)
    ? value.trace.map((event) => parseTraceCommonsTraceEvent(event))
    : [];
  const sourceIdentity = readRawTraceCommonsSourceIdentity(value, metadata, index);
  const sessionId = readRawTraceCommonsSessionId(value, metadata, trace, sourceIdentity);
  const topLevelMessages = Array.isArray(value.messages)
    ? value.messages.map((message, messageIndex) =>
      parseTraceCommonsMessage(message, sessionId, messageIndex))
    : [];
  const derivedMessages = deriveTraceCommonsMessagesFromTrace(trace, sessionId);

  const messages = hasReplayableTraceCommonsMessage(topLevelMessages)
    ? topLevelMessages
    : derivedMessages;

  return {
    harness: readRawTraceCommonsHarness(value, metadata, sourceIdentity, trace),
    session_id: sessionId,
    prompt: readRawTraceCommonsPrompt(value, messages, sourceIdentity),
    messages,
    tools: Array.isArray(value.tools)
      ? value.tools.map((tool) => parseTraceCommonsToolDefinition(tool))
      : [],
    ...("metadata" in value ? { metadata: value.metadata } : {}),
    sent_at: readRawTraceCommonsTimestamp(value, metadata, trace, index),
    ...(typeof value.num_user_messages === "number" ? { num_user_messages: value.num_user_messages } : {}),
    ...(typeof value.num_tool_calls === "number" ? { num_tool_calls: value.num_tool_calls } : {}),
    trace,
    ...(typeof value.file_path === "string" ? { file_path: value.file_path } : {}),
  };
}

function readDatasetRowIndex(entry: Record<string, unknown>, fallback: number): number {
  return typeof entry.row_idx === "number" ? entry.row_idx : fallback;
}

function readRawTraceCommonsSourceIdentity(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  index: number,
): string {
  if (metadata && typeof metadata.source_file === "string") return metadata.source_file;
  if (typeof value.file_path === "string") return path.basename(value.file_path);
  return `trace-commons-row-${index}`;
}

function readRawTraceCommonsHarness(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  sourceIdentity: string,
  trace: TraceCommonsTraceEvent[],
): string {
  if (typeof value.harness === "string" && value.harness.trim()) return value.harness.trim();
  if (metadata && typeof metadata.source === "string" && metadata.source.trim()) return metadata.source.trim();
  if (metadata && typeof metadata.trace_type === "string" && metadata.trace_type === "structured") {
    const provider = readOpenCodeProvider(trace);
    if (provider) return provider;
  }
  if (sourceIdentity.includes("opencode")) return "opencode";
  if (sourceIdentity.includes("cursor")) return "cursor";
  if (sourceIdentity.includes("claude")) return "claude_code";
  return "unknown";
}

function readRawTraceCommonsSessionId(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  trace: TraceCommonsTraceEvent[],
  sourceIdentity: string,
): string {
  if (typeof value.session_id === "string" && value.session_id.trim()) return value.session_id.trim();
  if (metadata && typeof metadata.session_id === "string" && metadata.session_id.trim()) {
    return metadata.session_id.trim();
  }
  const openCodeSessionId = readOpenCodeSessionId(trace);
  if (openCodeSessionId) return openCodeSessionId;
  return path.basename(sourceIdentity, path.extname(sourceIdentity));
}

function readRawTraceCommonsTimestamp(
  value: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  trace: TraceCommonsTraceEvent[],
  index: number,
): string {
  return (
    coerceTimestamp(value.sent_at) ??
    coerceTimestamp(metadata?.started_at) ??
    readFirstTraceTimestamp(trace) ??
    syntheticTimestamp(index)
  );
}

function readRawTraceCommonsPrompt(
  value: Record<string, unknown>,
  messages: TraceCommonsMessage[],
  sourceIdentity: string,
): string {
  if (typeof value.prompt === "string" && value.prompt.trim()) return value.prompt.trim();
  const firstUserText = messages.find((message) => message.role === "user")
    ? readTraceCommonsContentText(messages.find((message) => message.role === "user")?.content)
    : "";
  return firstUserText || `Imported Trace Commons session ${sourceIdentity}`;
}

function parseTraceCommonsMessage(
  value: unknown,
  sessionId: string,
  index: number,
): TraceCommonsMessage {
  if (!isRecord(value)) {
    throw new Error(`Invalid Trace Commons message at ${sessionId}[${index}].`);
  }

  const content = parseTraceCommonsContent(value.content);
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls.filter(isRecord) as TraceCommonsToolCall[]
    : undefined;

  return {
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
    ...(typeof value.created_at === "string" ? { created_at: value.created_at } : {}),
    ...(typeof value.sent_at === "string" ? { sent_at: value.sent_at } : {}),
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...(typeof value.tool_call_id === "string" ? { tool_call_id: value.tool_call_id } : {}),
    ...(typeof value.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
    ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...("output" in value ? { output: value.output } : {}),
    ...("result" in value ? { result: value.result } : {}),
    ...("error" in value ? { error: value.error } : {}),
  };
}

function parseTraceCommonsContent(value: unknown): TraceCommonsMessage["content"] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(isRecord) as TraceCommonsContentBlock[];
  return undefined;
}

function parseTraceCommonsToolDefinition(value: unknown): TraceCommonsToolDefinition {
  return isRecord(value) ? value as TraceCommonsToolDefinition : {};
}

function parseTraceCommonsTraceEvent(value: unknown): TraceCommonsTraceEvent {
  return isRecord(value) ? value : {};
}

function hasReplayableTraceCommonsMessage(messages: TraceCommonsMessage[]): boolean {
  return messages.some((message) =>
    (message.role === "user" && readTraceCommonsContentText(message.content).length > 0) ||
    (message.role === "assistant" && (
      readTraceCommonsContentText(message.content).length > 0 ||
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    )) ||
    (message.role === "tool" && readTraceCommonsContentText(message.content).length > 0));
}

function deriveTraceCommonsMessagesFromTrace(
  trace: TraceCommonsTraceEvent[],
  sessionId: string,
): TraceCommonsMessage[] {
  return trace.flatMap((event, index) => [
    ...deriveHermesTraceMessages(event, index),
    ...deriveOpenCodeTraceMessages(event, sessionId),
  ]);
}

function deriveHermesTraceMessages(event: TraceCommonsTraceEvent, index: number): TraceCommonsMessage[] {
  if (typeof event.role !== "string" || !isRecord(event.message)) {
    return [];
  }
  const content = parseTraceCommonsContent(event.message.content);
  const timestamp = coerceTimestamp(event.timestamp ?? event.message.timestamp);
  return [{
    role: event.role,
    ...(content !== undefined ? { content } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(typeof event.id === "string" ? { id: event.id } : { id: `trace:${index}` }),
  }];
}

function deriveOpenCodeTraceMessages(
  event: TraceCommonsTraceEvent,
  _sessionId: string,
): TraceCommonsMessage[] {
  if (!Array.isArray(event.messages)) {
    return [];
  }

  return event.messages.flatMap((message, index) => {
    if (!isRecord(message) || !isRecord(message.info)) return [];
    const role = typeof message.info.role === "string" ? message.info.role : undefined;
    const parts = Array.isArray(message.parts) ? message.parts.filter(isRecord) : [];
    const timestamp = coerceTimestamp(readNested(message.info, ["time", "created"]));
    const id = typeof message.info.id === "string" ? message.info.id : `opencode:${index}`;
    const text = parts
      .map((part) => part.type === "text" && typeof part.text === "string" ? part.text.trim() : "")
      .filter(Boolean)
      .join("\n");
    const toolParts = parts.filter((part) => part.type === "tool" && typeof part.tool === "string");
    const toolCalls: TraceCommonsToolCall[] = toolParts.map((part) => ({
      ...(typeof part.callID === "string" ? { id: part.callID } : {}),
      name: part.tool as string,
      input: isRecord(part.state) ? part.state.input : undefined,
    }));
    const mainMessage: TraceCommonsMessage[] = role ? [{
      role,
      ...(text ? { content: text } : {}),
      ...(timestamp ? { timestamp } : {}),
      id,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    }] : [];
    const toolMessages = toolParts.flatMap((part, toolIndex) => createOpenCodeToolResult(part, timestamp, id, toolIndex));
    return [...mainMessage, ...toolMessages];
  });
}

function createOpenCodeToolResult(
  part: Record<string, unknown>,
  fallbackTimestamp: string | undefined,
  parentId: string,
  toolIndex: number,
): TraceCommonsMessage[] {
  if (!isRecord(part.state)) return [];
  const output = readOpenCodeToolOutput(part.state);
  if (!output) return [];
  const timestamp = coerceTimestamp(readNested(part, ["time", "end"])) ?? fallbackTimestamp;
  return [{
    role: "tool",
    name: part.tool as string,
    ...(typeof part.callID === "string" ? { tool_call_id: part.callID } : {}),
    content: output,
    ...(timestamp ? { timestamp } : {}),
    id: `${parentId}:tool:${toolIndex}`,
    ...(typeof part.state.status === "string" ? { status: part.state.status } : {}),
  }];
}

function readOpenCodeToolOutput(state: Record<string, unknown>): string {
  return readTraceCommonsContentText(state.output as TraceCommonsMessage["content"]) ||
    (typeof state.error === "string" ? state.error : "");
}

function readTraceCommonsContentText(content: TraceCommonsMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => typeof block.text === "string" ? block.text.trim() : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readFirstTraceTimestamp(trace: TraceCommonsTraceEvent[]): string | undefined {
  for (const event of trace) {
    const timestamp =
      coerceTimestamp(event.timestamp) ??
      coerceTimestamp(readNested(event, ["info", "time", "created"])) ??
      coerceTimestamp(readNested(event, ["time", "created"])) ??
      readFirstNestedMessageTimestamp(event);
    if (timestamp) return timestamp;
  }
  return undefined;
}

function readFirstNestedMessageTimestamp(event: TraceCommonsTraceEvent): string | undefined {
  if (!Array.isArray(event.messages)) return undefined;
  for (const message of event.messages) {
    if (!isRecord(message) || !isRecord(message.info)) continue;
    const timestamp = coerceTimestamp(readNested(message.info, ["time", "created"]));
    if (timestamp) return timestamp;
  }
  return undefined;
}

function readOpenCodeSessionId(trace: TraceCommonsTraceEvent[]): string | undefined {
  const info = trace.map((event) => event.info).find(isRecord);
  return info && typeof info.id === "string" ? info.id : undefined;
}

function readOpenCodeProvider(trace: TraceCommonsTraceEvent[]): string | undefined {
  const info = trace.map((event) => event.info).find(isRecord);
  const provider = readNested(info ?? {}, ["model", "providerID"]);
  return typeof provider === "string" ? provider : undefined;
}

function readNested(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function coerceTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return undefined;
}
