import { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";
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
  clipSourceEventSummary,
  clipText,
  inferAssistantStatus,
  inferObservationStatus,
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
  type SweSmithRow,
  type SweSmithTrajectoryRow,
  type SweSmithTrajectorySplit,
} from "./public-trajectories-types.js";
import { buildTaskUpdateSourceQualityFields } from "./public-trajectories-source-quality.js";
import {
  extractSweSmithMessageText,
  parseSweSmithMessages,
  readSweSmithSplit,
  type SweSmithMessage,
} from "./public-trajectories-swe-smith-fetch.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

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
  const split = readSweSmithSplit(options.split);
  const taskId = `public:swe-smith:${trajectorySlug(row.traj_id)}`;
  const eventSource = {
    id: `public:swe-smith:${slug(row.traj_id)}`,
    kind: DEFAULT_SOURCE_KIND,
    label: `SWE-smith ${row.model}`,
  };
  const issueText = readIssueText(messages);
  const issueTitle =
    readIssueTitle(issueText) ?? `Imported SWE-smith trajectory ${row.instance_id}`;
  const issueSummary = toSingleLine(issueText) ?? row.instance_id;
  const entries: ImportedSessionEntry[] = [];
  const promptIndex = messages.findIndex((message) => message.role === "user");

  let lastToolFamily: string | undefined;

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "system") {
      const systemText = extractSweSmithMessageText(message);
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
      const promptText = extractSweSmithMessageText(message);
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
          summary: clipSourceEventSummary(issueSummary),
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
        ...(assistantSummary
          ? { text: assistantSummary, excerpt: clipText(assistantSummary, 240) }
          : {}),
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
                summary: clipSourceEventSummary(assistantSummary),
                status: inferAssistantStatus(assistantSummary),
              },
            }
          : {}),
      });
      continue;
    }

    if (message.role === "tool" || message.role === "user") {
      const observationText = extractSweSmithMessageText(message);
      if (!observationText) {
        continue;
      }

      const status = inferObservationStatus(observationText, lastToolFamily);
      const sourceQuality = buildTaskUpdateSourceQualityFields({
        summary: toSingleLine(observationText) ?? observationText,
        status,
      });
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
          ...sourceQuality,
          title: buildObservationTitle(status, lastToolFamily),
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
        summary: clipSourceEventSummary(issueSummary),
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
    schemaVersion: IMPORTED_SESSION_SCHEMA_VERSION,
    sessionId: taskId,
    title: issueTitle,
    description: `Imported from ${SWE_SMITH_DATASET} (${split}, ${row.model}) for ${row.instance_id}.`,
    doctrineTags: ["public_seed", "trajectory", "swe-smith", split],
    source: defaultSweSmithBundleSource(row, split),
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
  const split = readSweSmithSplit(options.split);
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

function readIssueText(messages: SweSmithMessage[]): string {
  const prompt = messages.find((message) => message.role === "user");
  const text = prompt ? extractSweSmithMessageText(prompt) : "";
  const issueIndex = text.indexOf("ISSUE:");
  if (issueIndex >= 0) {
    return text.slice(issueIndex + "ISSUE:".length).trim();
  }
  return text.trim();
}

function readAssistantSummary(message: SweSmithMessage): string | null {
  const content = extractSweSmithMessageText(message);
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
  const patchSummary =
    row.patch.trim().length > 0 ? "Patch attached." : "No patch payload captured.";
  return row.resolved
    ? `Trajectory resolved the task. ${patchSummary}`
    : `Trajectory finished without a verified resolution. ${patchSummary}`;
}

function readExitStatusFallback(row: SweSmithRow): string {
  return row.resolved ? "resolved" : "unfinished";
}
