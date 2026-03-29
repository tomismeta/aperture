import type { SourceEvent } from "@tomismeta/aperture-core";

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
  inferAssistantStatus,
  inferObservationStatus,
  isRecord,
  normalizeToolFamily,
  readIssueTitle,
  slug,
  syntheticTimestamp,
  toSingleLine,
  trajectorySlug,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DEFAULT_SWE_SMITH_SPLIT,
  SWE_SMITH_DATASET,
  type ImportPublicTrajectoryBundlesOptions,
  type PublicTrajectorySplit,
  type SweSmithRow,
  type SweSmithTrajectoryRow,
  type SweSmithTrajectorySplit,
} from "./public-trajectories-types.js";

type SweSmithMessage = {
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

const DEFAULT_SOURCE_KIND = "public-trajectory";
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

export function createScenarioFromSweSmithRow(
  row: SweSmithRow,
  options: { split?: SweSmithTrajectorySplit } = {},
): ReplayScenario {
  return createReplayScenarioFromSweSmithTrajectory(row, options);
}

export function createImportedSessionFromSweSmithRow(
  row: SweSmithRow,
  options: { split?: SweSmithTrajectorySplit } = {},
): ImportedSession {
  return createImportedSessionFromSweSmithTrajectory(row, options);
}

export function createReplayScenarioFromSweSmithTrajectory(
  row: SweSmithTrajectoryRow,
  options: { split?: SweSmithTrajectorySplit } = {},
): ReplayScenario {
  return createReplayScenarioFromImportedSession(
    createImportedSessionFromSweSmithTrajectory(row, options),
  );
}

export function createImportedSessionFromSweSmithTrajectory(
  row: SweSmithTrajectoryRow,
  options: { split?: SweSmithTrajectorySplit } = {},
): ImportedSession {
  const messages = parseSweSmithMessages(row);
  const split = options.split ?? DEFAULT_SWE_SMITH_SPLIT;
  const taskId = `public:swe-smith:${trajectorySlug(row.traj_id)}`;
  const eventSource = {
    id: `public:swe-smith:${slug(row.traj_id)}`,
    kind: DEFAULT_SOURCE_KIND,
    label: `SWE-smith ${row.model}`,
  };
  const issueText = readIssueText(messages);
  const issueTitle = readIssueTitle(issueText) ?? `Imported SWE-smith trajectory ${row.instance_id}`;
  const issueSummary = toSingleLine(issueText) ?? row.instance_id;
  const entries: ImportedSessionEntry[] = [];
  const promptIndex = messages.findIndex((message) => message.role === "user");

  let lastToolFamily: string | undefined;

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "system") {
      const systemText = extractMessageText(message.content);
      entries.push({
        index: entries.length,
        timestamp: syntheticTimestamp(entries.length),
        role: "system",
        kind: "message",
        significance: "context",
        label: `system:${message.message_type ?? "message"}:${messageIndex}`,
        ...(systemText ? { text: systemText, excerpt: clipText(systemText, 240) } : {}),
        rawRef: { messageIndex },
      });
      continue;
    }

    if (messageIndex === promptIndex) {
      const promptText = extractMessageText(message.content);
      entries.push({
        index: entries.length,
        timestamp: syntheticTimestamp(entries.length),
        role: "user",
        kind: "message",
        significance: "attention",
        label: "issue prompt",
        text: promptText,
        excerpt: clipText(issueSummary, 220),
        rawRef: { messageIndex },
        sourceEvent: {
          id: `${taskId}:start`,
          type: "task.started",
          taskId,
          timestamp: syntheticTimestamp(entries.length),
          source: eventSource,
          title: issueTitle,
          summary: clipText(issueSummary, 220),
        },
      });
      continue;
    }

    if (message.role === "assistant") {
      const toolName = readToolName(message);
      if (toolName === "submit") {
        entries.push({
          index: entries.length,
          timestamp: syntheticTimestamp(entries.length),
          role: "assistant",
          kind: "completion",
          significance: "attention",
          label: "trajectory submitted",
          text: buildCompletionSummary(row),
          toolName,
          rawRef: { messageIndex },
          sourceEvent: {
            id: `${taskId}:completed`,
            type: "task.completed",
            taskId,
            timestamp: syntheticTimestamp(entries.length),
            source: eventSource,
            summary: buildCompletionSummary(row),
          },
        });
        continue;
      }

      const toolFamily = normalizeToolFamily(toolName);
      if (toolFamily) {
        lastToolFamily = toolFamily;
      }

      const assistantSummary = readAssistantSummary(message);
      entries.push({
        index: entries.length,
        timestamp: syntheticTimestamp(entries.length),
        role: "assistant",
        kind: toolFamily ? "tool_call" : "message",
        significance: assistantSummary ? "attention" : "context",
        label: `assistant:${message.message_type ?? "message"}:${messageIndex}`,
        ...(assistantSummary ? { text: assistantSummary, excerpt: clipText(assistantSummary, 240) } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolFamily ? { toolFamily } : {}),
        rawRef: { messageIndex },
        ...(assistantSummary
          ? {
              sourceEvent: {
                id: `${taskId}:assistant:${entries.length}`,
                type: "task.updated",
                taskId,
                timestamp: syntheticTimestamp(entries.length),
                source: eventSource,
                ...(toolFamily ? { toolFamily } : {}),
                title: buildAssistantTitle(toolFamily, assistantSummary),
                summary: clipText(assistantSummary, 240),
                status: inferAssistantStatus(assistantSummary),
              },
            }
          : {}),
      });
      continue;
    }

    if (message.role === "tool" || message.role === "user") {
      const observationText = extractMessageText(message.content);
      if (!observationText) {
        continue;
      }

      const status = inferObservationStatus(observationText, lastToolFamily);
      entries.push({
        index: entries.length,
        timestamp: syntheticTimestamp(entries.length),
        role: message.role,
        kind: message.role === "tool" ? "tool_result" : "message",
        significance: "attention",
        label: `${message.role}:${message.message_type ?? "observation"}:${messageIndex}`,
        text: observationText,
        excerpt: clipText(toSingleLine(observationText) ?? observationText, 240),
        ...(lastToolFamily ? { toolFamily: lastToolFamily } : {}),
        rawRef: { messageIndex },
        sourceEvent: {
          id: `${taskId}:${message.role}:${entries.length}`,
          type: "task.updated",
          taskId,
          timestamp: syntheticTimestamp(entries.length),
          source: eventSource,
          ...(lastToolFamily ? { toolFamily: lastToolFamily } : {}),
          title: buildObservationTitle(status, lastToolFamily),
          summary: clipText(toSingleLine(observationText) ?? observationText, 240),
          status,
        },
      });
    }
  }

  if (!entries.some((entry) => entry.sourceEvent?.type === "task.started")) {
    entries.unshift({
      index: 0,
      timestamp: syntheticTimestamp(0),
      role: "user",
      kind: "message",
      significance: "attention",
      label: "issue prompt",
      text: issueText,
      excerpt: clipText(issueSummary, 220),
      sourceEvent: {
        id: `${taskId}:start`,
        type: "task.started",
        taskId,
        timestamp: syntheticTimestamp(0),
        source: eventSource,
        title: issueTitle,
        summary: clipText(issueSummary, 220),
      },
    });
    for (const [index, entry] of entries.entries()) {
      entry.index = index;
      entry.timestamp = syntheticTimestamp(index);
    }
  }

  if (!entries.some((entry) => entry.sourceEvent?.type === "task.completed")) {
    entries.push({
      index: entries.length,
      timestamp: syntheticTimestamp(entries.length),
      role: "assistant",
      kind: "completion",
      significance: "attention",
      label: "trajectory finished",
      text: row.resolved
        ? buildCompletionSummary(row)
        : `Trajectory exited with ${readExitStatusFallback(row)}`,
      sourceEvent: {
        id: `${taskId}:completed:fallback`,
        type: row.resolved ? "task.completed" : "task.cancelled",
        taskId,
        timestamp: syntheticTimestamp(entries.length),
        source: eventSource,
        ...(row.resolved
          ? { summary: buildCompletionSummary(row) }
          : { reason: `Trajectory exited with ${readExitStatusFallback(row)}` }),
      },
    });
  }

  return {
    schemaVersion: 1,
    sessionId: taskId,
    title: issueTitle,
    description: `Imported from ${SWE_SMITH_DATASET} (${split}, ${row.model}) for ${row.instance_id}.`,
    doctrineTags: ["public_seed", "trajectory", "swe-smith", split],
    source: {
      id: "huggingface:swe-smith",
      kind: "public-dataset",
      label: "SWE-smith trajectories",
      redacted: false,
      capture: {
        eventTransport: "huggingface-datasets-server",
        semanticCapture: "source+normalized+trace",
        notes: [
          `dataset=${SWE_SMITH_DATASET}`,
          `split=${split}`,
          `instance=${row.instance_id}`,
          `trajectory=${row.traj_id}`,
          `model=${row.model}`,
          `resolved=${String(row.resolved)}`,
        ],
      },
    },
    importedAt: syntheticTimestamp(0),
    entries,
  };
}

export function createSessionBundleFromSweSmithRow(
  row: SweSmithRow,
  source: ReplaySessionBundleSource = defaultSweSmithBundleSource(row),
): ReplaySessionBundle {
  const session = createImportedSessionFromSweSmithRow(row);
  const bundle = createSessionBundleFromImportedSession(session, {
    source,
  });
  return validateImportedTrajectoryBundle(bundle);
}

export function createSessionBundleFromSweSmithTrajectory(
  row: SweSmithTrajectoryRow,
  options: {
    split?: SweSmithTrajectorySplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = options.split ?? DEFAULT_SWE_SMITH_SPLIT;
  const session = createImportedSessionFromSweSmithTrajectory(row, { split });
  const bundle = createSessionBundleFromImportedSession(session, {
    source: defaultSweSmithBundleSource(row, split),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
  });
  return validateImportedTrajectoryBundle(bundle);
}

export function defaultSweSmithBundleSource(
  row: SweSmithRow,
  split: SweSmithTrajectorySplit = DEFAULT_SWE_SMITH_SPLIT,
): ReplaySessionBundleSource {
  return {
    id: "huggingface:swe-smith",
    kind: "public-dataset",
    label: "SWE-smith trajectories",
    redacted: false,
    capture: {
      eventTransport: "huggingface-datasets-server",
      semanticCapture: "source+normalized+trace",
      notes: [
        `dataset=${SWE_SMITH_DATASET}`,
        `split=${split}`,
        `instance=${row.instance_id}`,
        `trajectory=${row.traj_id}`,
        `model=${row.model}`,
        `resolved=${String(row.resolved)}`,
      ],
    },
  };
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

function readIssueText(messages: SweSmithMessage[]): string {
  const prompt = messages.find((message) => message.role === "user");
  const text = prompt ? extractMessageText(prompt.content) : "";
  const issueIndex = text.indexOf("ISSUE:");
  if (issueIndex >= 0) {
    return text.slice(issueIndex + "ISSUE:".length).trim();
  }
  return text.trim();
}

function readAssistantSummary(message: SweSmithMessage): string | null {
  const content = extractMessageText(message.content);
  if (content.length > 0) {
    return content;
  }

  return typeof message.action === "string" ? message.action.trim() : null;
}

function readToolName(message: SweSmithMessage): string | undefined {
  const firstToolCall = message.tool_calls?.[0];
  const name = firstToolCall?.function?.name;
  return typeof name === "string" ? name.trim().toLowerCase() : undefined;
}

function buildCompletionSummary(row: SweSmithRow): string {
  const patchSummary = row.patch.trim().length > 0 ? "Patch attached." : "No patch payload captured.";
  return row.resolved
    ? `Trajectory resolved the task. ${patchSummary}`
    : `Trajectory finished without a verified resolution. ${patchSummary}`;
}

function readExitStatusFallback(row: SweSmithRow): string {
  return row.resolved ? "resolved" : "unfinished";
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
