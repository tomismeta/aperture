import {
  DEFAULT_SWE_SMITH_SPLIT,
  SWE_SMITH_DATASET,
  type ImportPublicTrajectoryBundlesOptions,
  type PublicTrajectorySplit,
  type SweSmithRow,
  type SweSmithTrajectoryRow,
  type SweSmithTrajectorySplit,
} from "./public-trajectories-types.js";
import { isRecord } from "./public-trajectories-shared.js";

export type SweSmithMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type?: string; text?: string }>;
  message_type?: string;
  action?: string;
  tool_calls?: Array<{
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";

export function parseSweSmithRowsResponse(value: unknown): SweSmithRow[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("Invalid SWE-smith dataset response: expected a rows array.");
  }

  return value.rows.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.row)) {
      throw new Error(`Invalid SWE-smith dataset response at row ${index}.`);
    }
    return parseSweSmithRow(entry.row, index);
  });
}

export function parseSweSmithMessages(value: SweSmithRow | SweSmithTrajectoryRow["messages"]): SweSmithMessage[] {
  const rawMessages = typeof value === "string" ? value : value.messages;
  const trajectoryId = typeof value === "string" ? "swe-smith" : value.traj_id;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessages);
  } catch (error) {
    throw new Error(`Failed to parse SWE-smith messages for ${trajectoryId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid SWE-smith messages for ${trajectoryId}: expected an array.`);
  }

  return parsed.map((message, index) => parseSweSmithMessage(message, trajectoryId, index));
}

export async function fetchSweSmithRows(
  options: Pick<ImportPublicTrajectoryBundlesOptions, "split" | "offset" | "limit"> = {},
): Promise<SweSmithTrajectoryRow[]> {
  const split = options.split ?? DEFAULT_SWE_SMITH_SPLIT;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  const query = new URLSearchParams({
    dataset: SWE_SMITH_DATASET,
    config: "default",
    split,
    offset: String(offset),
    length: String(limit),
  });

  const response = await fetch(`${HUGGING_FACE_DATASETS_SERVER}/rows?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch SWE-smith rows: ${response.status} ${response.statusText}`);
  }

  return parseSweSmithRowsResponse(await response.json());
}

export function extractSweSmithMessageText(message: SweSmithMessage): string {
  return extractMessageText(message.content);
}

export function readSweSmithSplit(
  value: PublicTrajectorySplit | undefined,
): SweSmithTrajectorySplit {
  if (value === undefined || value === "tool" || value === "xml" || value === "ticks") {
    return value ?? DEFAULT_SWE_SMITH_SPLIT;
  }

  throw new Error("SWE-smith split must be one of: tool, xml, ticks");
}

function parseSweSmithRow(value: Record<string, unknown>, index: number): SweSmithRow {
  if (
    typeof value.messages !== "string"
    || typeof value.instance_id !== "string"
    || typeof value.resolved !== "boolean"
    || typeof value.model !== "string"
    || typeof value.traj_id !== "string"
    || typeof value.patch !== "string"
  ) {
    throw new Error(`Invalid SWE-smith row at index ${index}.`);
  }

  return {
    messages: value.messages,
    instance_id: value.instance_id,
    resolved: value.resolved,
    model: value.model,
    traj_id: value.traj_id,
    patch: value.patch,
  };
}

function parseSweSmithMessage(value: unknown, trajectoryId: string, index: number): SweSmithMessage {
  if (!isRecord(value)) {
    throw new Error(`Invalid SWE-smith message at ${trajectoryId}[${index}].`);
  }

  if (
    value.role !== "system"
    && value.role !== "user"
    && value.role !== "assistant"
    && value.role !== "tool"
  ) {
    throw new Error(`Invalid SWE-smith message role at ${trajectoryId}[${index}].`);
  }

  const { content } = value;
  const validContent = typeof content === "string"
    || (Array.isArray(content) && content.every((item) => isRecord(item)));
  if (!validContent) {
    throw new Error(`Invalid SWE-smith message content at ${trajectoryId}[${index}].`);
  }

  return {
    role: value.role,
    content,
    ...(typeof value.message_type === "string" ? { message_type: value.message_type } : {}),
    ...(typeof value.action === "string" ? { action: value.action } : {}),
    ...(Array.isArray(value.tool_calls)
      ? { tool_calls: value.tool_calls as NonNullable<SweSmithMessage["tool_calls"]> }
      : {}),
  };
}

function extractMessageText(content: SweSmithMessage["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
}
