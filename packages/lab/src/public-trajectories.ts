import path from "node:path";

import type { SourceEvent } from "@tomismeta/aperture-core";

import type { ReplayScenario } from "./scenario.js";
import {
  createSessionBundleFromScenario,
  defaultSessionBundlePath,
  DEFAULT_SESSION_BUNDLES_DIR,
  runSessionBundle,
  type ReplaySessionBundle,
  type ReplaySessionBundleSource,
  writeSessionBundle,
} from "./session-bundle.js";

export const SWE_SMITH_DATASET = "SWE-bench/SWE-smith-trajectories" as const;
export const HUGGINGFACE_SWE_SMITH_DATASET = SWE_SMITH_DATASET;
export const DEFAULT_SWE_SMITH_SPLIT = "tool" as const;
export const DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR = path.join(
  DEFAULT_SESSION_BUNDLES_DIR,
  "public",
);

export type PublicTrajectoryDataset = "swe-smith";
export type SweSmithTrajectorySplit = "tool" | "xml" | "ticks";

export type SweSmithRow = {
  messages: string;
  instance_id: string;
  resolved: boolean;
  model: string;
  traj_id: string;
  patch: string;
};

export type SweSmithTrajectoryRow = SweSmithRow;

export type ImportedTrajectoryBundle = {
  dataset: PublicTrajectoryDataset;
  split: SweSmithTrajectorySplit;
  row: SweSmithTrajectoryRow;
  bundle: ReplaySessionBundle;
  filePath: string;
};

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
const SYNTHETIC_START_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";

export type ImportPublicTrajectoryBundlesOptions = {
  dataset?: PublicTrajectoryDataset;
  split?: SweSmithTrajectorySplit;
  offset?: number;
  limit?: number;
  outputDirectory?: string;
  exportedAt?: string;
  dryRun?: boolean;
};

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
    throw new Error(`Failed to fetch ${SWE_SMITH_DATASET}: ${response.status} ${response.statusText}`);
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

export function createReplayScenarioFromSweSmithTrajectory(
  row: SweSmithTrajectoryRow,
  options: { split?: SweSmithTrajectorySplit } = {},
): ReplayScenario {
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
  const steps: ReplayScenario["steps"] = [];
  const promptIndex = messages.findIndex((message) => message.role === "user");

  steps.push({
    kind: "publishSource",
    label: "issue prompt",
    event: {
      id: `${taskId}:start`,
      type: "task.started",
      taskId,
      timestamp: syntheticTimestamp(0),
      source: eventSource,
      title: issueTitle,
      summary: clipText(issueSummary, 220),
    },
  });

  let lastToolFamily: string | undefined;
  let stepIndex = 1;

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "system" || messageIndex === promptIndex) {
      continue;
    }

    if (message.role === "assistant") {
      const toolName = readToolName(message);
      if (toolName === "submit") {
        steps.push({
          kind: "publishSource",
          label: "trajectory submitted",
          event: {
            id: `${taskId}:completed`,
            type: "task.completed",
            taskId,
            timestamp: syntheticTimestamp(stepIndex),
            source: eventSource,
            summary: buildCompletionSummary(row),
          },
        });
        stepIndex += 1;
        continue;
      }

      const toolFamily = normalizeToolFamily(toolName);
      if (toolFamily) {
        lastToolFamily = toolFamily;
      }

      const assistantSummary = readAssistantSummary(message);
      if (!assistantSummary) {
        continue;
      }

      steps.push({
        kind: "publishSource",
        label: `assistant:${message.message_type ?? "message"}:${messageIndex}`,
        event: {
          id: `${taskId}:assistant:${stepIndex}`,
          type: "task.updated",
          taskId,
          timestamp: syntheticTimestamp(stepIndex),
          source: eventSource,
          ...(toolFamily ? { toolFamily } : {}),
          title: buildAssistantTitle(toolFamily, assistantSummary),
          summary: clipText(assistantSummary, 240),
          status: inferAssistantStatus(assistantSummary),
        },
      });
      stepIndex += 1;
      continue;
    }

    if (message.role === "tool" || message.role === "user") {
      const observationText = extractMessageText(message.content);
      if (!observationText) {
        continue;
      }

      const status = inferObservationStatus(observationText);
      steps.push({
        kind: "publishSource",
        label: `${message.role}:${message.message_type ?? "observation"}:${messageIndex}`,
        event: {
          id: `${taskId}:${message.role}:${stepIndex}`,
          type: "task.updated",
          taskId,
          timestamp: syntheticTimestamp(stepIndex),
          source: eventSource,
          ...(lastToolFamily ? { toolFamily: lastToolFamily } : {}),
          title: buildObservationTitle(status, lastToolFamily),
          summary: clipText(toSingleLine(observationText) ?? observationText, 240),
          status,
        },
      });
      stepIndex += 1;
    }
  }

  if (!steps.some((step) => step.kind === "publishSource" && step.event.type === "task.completed")) {
    steps.push({
      kind: "publishSource",
      label: "trajectory finished",
      event: {
        id: `${taskId}:completed:fallback`,
        type: row.resolved ? "task.completed" : "task.cancelled",
        taskId,
        timestamp: syntheticTimestamp(stepIndex),
        source: eventSource,
        ...(row.resolved
          ? { summary: buildCompletionSummary(row) }
          : { reason: `Trajectory exited with ${readExitStatusFallback(row)}` }),
      },
    });
  }

  return {
    id: taskId,
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
    steps,
  };
}

export function createSessionBundleFromSweSmithRow(
  row: SweSmithRow,
  source: ReplaySessionBundleSource = defaultSweSmithBundleSource(row),
): ReplaySessionBundle {
  const scenario = createScenarioFromSweSmithRow(row);
  const bundle = createSessionBundleFromScenario(scenario, {
    sessionId: scenario.id,
    source,
  });
  const replayed = runSessionBundle(bundle);
  const finalView = replayed.views.at(-1);

  if (!finalView) {
    throw new Error(`Imported SWE-smith bundle ${bundle.sessionId} did not produce a final attention view.`);
  }

  if (
    finalView.activeInteractionId !== bundle.outcomes.finalActiveInteractionId
    || finalView.queuedInteractionIds.length !== bundle.outcomes.finalQueuedCount
    || finalView.ambientInteractionIds.length !== bundle.outcomes.finalAmbientCount
  ) {
    throw new Error(`Imported SWE-smith bundle ${bundle.sessionId} failed roundtrip replay validation.`);
  }

  return bundle;
}

export function createSessionBundleFromSweSmithTrajectory(
  row: SweSmithTrajectoryRow,
  options: {
    split?: SweSmithTrajectorySplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = options.split ?? DEFAULT_SWE_SMITH_SPLIT;
  const scenario = createReplayScenarioFromSweSmithTrajectory(row, { split });
  const bundleOptions = {
    sessionId: scenario.id,
    source: defaultSweSmithBundleSource(row, split),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
  };
  const bundle = createSessionBundleFromScenario(scenario, bundleOptions);
  const replayed = runSessionBundle(bundle);
  const finalView = replayed.views.at(-1);

  if (!finalView) {
    throw new Error(`Imported SWE-smith bundle ${bundle.sessionId} did not produce a final attention view.`);
  }

  if (
    finalView.activeInteractionId !== bundle.outcomes.finalActiveInteractionId
    || finalView.queuedInteractionIds.length !== bundle.outcomes.finalQueuedCount
    || finalView.ambientInteractionIds.length !== bundle.outcomes.finalAmbientCount
  ) {
    throw new Error(`Imported SWE-smith bundle ${bundle.sessionId} failed roundtrip replay validation.`);
  }

  return bundle;
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

export function defaultImportedTrajectoryBundlePath(
  bundle: ReplaySessionBundle,
  dataset: PublicTrajectoryDataset,
  split: SweSmithTrajectorySplit = DEFAULT_SWE_SMITH_SPLIT,
  rootDirectory: string = DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
): string {
  return defaultSessionBundlePath(bundle, path.join(rootDirectory, dataset, split));
}

export async function importPublicTrajectoryBundles(
  options: ImportPublicTrajectoryBundlesOptions = {},
): Promise<ImportedTrajectoryBundle[]> {
  const dataset = options.dataset ?? "swe-smith";
  const split = options.split ?? DEFAULT_SWE_SMITH_SPLIT;

  if (dataset !== "swe-smith") {
    throw new Error(`Unsupported public trajectory dataset: ${dataset}`);
  }

  const rows = await fetchSweSmithRows(options);
  const imported: ImportedTrajectoryBundle[] = [];

  for (const row of rows) {
    const bundle = createSessionBundleFromSweSmithTrajectory(row, {
      split,
      ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    });
    const filePath = defaultImportedTrajectoryBundlePath(
      bundle,
      dataset,
      split,
      options.outputDirectory ?? DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
    );

    if (!options.dryRun) {
      await writeSessionBundle(filePath, bundle);
    }

    imported.push({
      dataset,
      split,
      row,
      bundle,
      filePath,
    });
  }

  return imported;
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

function readIssueTitle(issueText: string): string | null {
  const lines = issueText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines[0] ? clipText(lines[0], 96) : null;
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

function buildAssistantTitle(toolFamily: string | undefined, summary: string): string {
  if (toolFamily) {
    return `${toolFamily} action`;
  }
  return clipText(summary, 96);
}

function buildObservationTitle(
  status: Extract<SourceEvent, { type: "task.updated" }>["status"],
  toolFamily: string | undefined,
): string {
  if (status === "failed") {
    return toolFamily ? `${toolFamily} failure` : "tool failure";
  }
  return toolFamily ? `${toolFamily} observation` : "tool observation";
}

function inferAssistantStatus(
  text: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("could you")
    || normalized.includes("can you")
    || normalized.includes("would you")
    || normalized.includes("please confirm")
    || normalized.includes("let me know")
  ) {
    return "waiting";
  }

  return "running";
}

function inferObservationStatus(
  text: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("traceback")
    || normalized.includes("exception")
    || normalized.includes("error")
    || normalized.includes("failed")
    || normalized.includes("forbidden")
  ) {
    return "failed";
  }

  if (
    normalized.includes("waiting")
    || normalized.includes("awaiting")
    || normalized.includes("pending")
  ) {
    return "waiting";
  }

  return "running";
}

function normalizeToolFamily(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === "bash" || normalized === "shell" || normalized === "terminal") return "bash";
  if (normalized.includes("read") || normalized.includes("open") || normalized.includes("view")) return "read";
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch") || normalized.includes("replace")) return "edit";
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("grep")) return "search";
  if (normalized.includes("web") || normalized.includes("browser")) return "web";
  if (normalized === "submit") return undefined;
  return normalized;
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

function syntheticTimestamp(stepIndex: number): string {
  return new Date(SYNTHETIC_START_TIME_MS + (stepIndex * 1000)).toISOString();
}

function clipText(value: string, maxLength: number): string {
  const normalized = toSingleLine(value) ?? value;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function toSingleLine(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "trajectory";
}

function trajectorySlug(value: string): string {
  return slug(value).replace(/\./g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
