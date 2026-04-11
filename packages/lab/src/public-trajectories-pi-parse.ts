import { isRecord } from "./public-trajectories-shared.js";
import {
  DEFAULT_PI_SPLIT,
  type PiMonoContentBlock,
  type PiMonoMessage,
  type PiMonoRow,
  type PiMonoSplit,
  type PiMonoTrace,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";

type PiMonoTraceType = NonNullable<PiMonoTrace["type"]>;
type PiMonoMessageRole = NonNullable<PiMonoMessage["role"]>;

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
