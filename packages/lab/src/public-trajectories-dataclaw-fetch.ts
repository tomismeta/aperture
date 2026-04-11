import {
  DATACLAW_DATASET,
  DEFAULT_DATACLAW_SPLIT,
  type DataclawMessage,
  type DataclawRow,
  type DataclawSplit,
  type DataclawStats,
  type DataclawToolUse,
  type ImportPublicTrajectoryBundlesOptions,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";
import { isRecord } from "./public-trajectories-shared.js";

const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";

export function parseDataclawRowsResponse(value: unknown): DataclawRow[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("Invalid DataClaw dataset response: expected a rows array.");
  }

  return value.rows.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.row)) {
      throw new Error(`Invalid DataClaw dataset response at row ${index}.`);
    }
    return parseDataclawRow(entry.row, index);
  });
}

export async function fetchDataclawRows(
  options: Pick<ImportPublicTrajectoryBundlesOptions, "split" | "offset" | "limit"> = {},
): Promise<DataclawRow[]> {
  const split = options.split ?? DEFAULT_DATACLAW_SPLIT;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  const query = new URLSearchParams({
    dataset: DATACLAW_DATASET,
    config: "default",
    split,
    offset: String(offset),
    length: String(limit),
  });

  const response = await fetch(`${HUGGING_FACE_DATASETS_SERVER}/rows?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch DataClaw rows: ${response.status} ${response.statusText}`);
  }

  return parseDataclawRowsResponse(await response.json());
}

export function readDataclawSplit(
  value: PublicTrajectorySplit | undefined,
): DataclawSplit {
  if (value === undefined || value === "train") {
    return value ?? DEFAULT_DATACLAW_SPLIT;
  }

  throw new Error("DataClaw split must be: train");
}

function parseDataclawRow(value: Record<string, unknown>, index: number): DataclawRow {
  if (
    typeof value.session_id !== "string"
    || typeof value.model !== "string"
    || typeof value.project !== "string"
    || typeof value.source !== "string"
    || typeof value.start_time !== "string"
    || !Array.isArray(value.messages)
  ) {
    throw new Error(`Invalid DataClaw row at index ${index}.`);
  }

  const sessionId = value.session_id;

  return {
    session_id: sessionId,
    model: value.model,
    project: value.project,
    source: value.source,
    start_time: value.start_time,
    ...(typeof value.end_time === "string" ? { end_time: value.end_time } : {}),
    ...(typeof value.git_branch === "string" ? { git_branch: value.git_branch } : {}),
    ...(isRecord(value.stats) ? { stats: parseDataclawStats(value.stats) } : {}),
    messages: value.messages.map((message, messageIndex) =>
      parseDataclawMessage(message, sessionId, messageIndex)),
  };
}

function parseDataclawStats(value: Record<string, unknown>): DataclawStats {
  return {
    ...(typeof value.user_messages === "number" ? { user_messages: value.user_messages } : {}),
    ...(typeof value.assistant_messages === "number" ? { assistant_messages: value.assistant_messages } : {}),
    ...(typeof value.tool_uses === "number" ? { tool_uses: value.tool_uses } : {}),
    ...(typeof value.input_tokens === "number" ? { input_tokens: value.input_tokens } : {}),
    ...(typeof value.output_tokens === "number" ? { output_tokens: value.output_tokens } : {}),
  };
}

function parseDataclawMessage(value: unknown, sessionId: string, index: number): DataclawMessage {
  if (!isRecord(value)) {
    throw new Error(`Invalid DataClaw message at ${sessionId}[${index}].`);
  }

  if (
    value.role !== "system"
    && value.role !== "user"
    && value.role !== "assistant"
    && value.role !== "tool"
  ) {
    throw new Error(`Invalid DataClaw message role at ${sessionId}[${index}].`);
  }

  return {
    role: value.role,
    ...(typeof value.content === "string" || value.content === null ? { content: value.content } : {}),
    ...(typeof value.thinking === "string" || value.thinking === null ? { thinking: value.thinking } : {}),
    ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
    ...(Array.isArray(value.tool_uses)
      ? {
          tool_uses: value.tool_uses.map((toolUse, toolUseIndex) =>
            parseDataclawToolUse(toolUse, sessionId, index, toolUseIndex)),
        }
      : {}),
  };
}

function parseDataclawToolUse(
  value: unknown,
  sessionId: string,
  messageIndex: number,
  toolUseIndex: number,
): DataclawToolUse {
  if (!isRecord(value) || typeof value.tool !== "string") {
    throw new Error(`Invalid DataClaw tool use at ${sessionId}[${messageIndex}].tool_uses[${toolUseIndex}].`);
  }

  return {
    tool: value.tool,
    ...("input" in value ? { input: value.input } : {}),
    ...("output" in value ? { output: value.output } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
  };
}
