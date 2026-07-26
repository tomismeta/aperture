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
  clipText,
  coerceImportedTimestamp,
  inferAssistantStatus,
  normalizeToolFamily,
  readIssueTitle,
  slug,
  stringifyStructuredValue,
  toSingleLine,
  trajectorySlug,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DATACLAW_DATASET,
  DEFAULT_DATACLAW_SPLIT,
  type DataclawMessage,
  type DataclawRow,
  type DataclawSplit,
  type DataclawToolUse,
} from "./public-trajectories-types.js";
import { readDataclawSplit } from "./public-trajectories-dataclaw-fetch.js";
import { inferDataclawToolResultStatus } from "./public-trajectories-dataclaw-status.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

export function createImportedSessionFromDataclawRow(
  row: DataclawRow,
  options: { split?: DataclawSplit } = {},
): ImportedSession {
  const split = readDataclawSplit(options.split);
  const taskId = `public:dataclaw:${trajectorySlug(row.session_id)}`;
  const eventSource = {
    id: `public:dataclaw:${slug(row.session_id)}`,
    kind: DEFAULT_SOURCE_KIND,
    label: `DataClaw ${row.source}`,
  };
  const firstPrompt = readDataclawFirstPrompt(row.messages);
  const title =
    readIssueTitle(firstPrompt) ?? `Imported DataClaw session ${clipText(row.project, 64)}`;
  const summary = toSingleLine(firstPrompt) ?? `${row.project} (${row.model})`;
  const entries: ImportedSessionEntry[] = [];

  let started = false;

  for (const [messageIndex, message] of row.messages.entries()) {
    const timestamp = coerceImportedTimestamp(message.timestamp, row.start_time, entries.length);
    const messageText = readDataclawMessageText(message);
    const localCommandNoise = messageText ? isDataclawLocalCommandNoise(messageText) : false;
    const compactionContext = messageText ? isDataclawCompactionContext(messageText) : false;
    const actionableUserText =
      message.role === "user" && messageText && !localCommandNoise && !compactionContext;
    const actionableAssistantText =
      message.role === "assistant" &&
      messageText &&
      !isDataclawNonActionableAssistantText(messageText);

    if (message.role === "system") {
      entries.push({
        index: entries.length,
        timestamp,
        role: "system",
        kind: "message",
        significance: "context",
        label: `system:${messageIndex}`,
        ...(messageText ? { text: messageText, excerpt: clipText(messageText, 240) } : {}),
        rawRef: { messageIndex },
      });
      continue;
    }

    if (message.role === "user" && messageText) {
      if (!started && actionableUserText) {
        entries.push({
          index: entries.length,
          timestamp,
          role: "user",
          kind: "message",
          significance: "attention",
          label: "session prompt",
          text: messageText,
          excerpt: clipText(summary, 220),
          rawRef: { messageIndex },
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
        role: "user",
        kind: "message",
        significance: actionableUserText ? "attention" : "context",
        label: actionableUserText
          ? `user:followup:${messageIndex}`
          : `user:context:${messageIndex}`,
        text: messageText,
        excerpt: clipText(messageText, 240),
        rawRef: { messageIndex },
        ...(actionableUserText
          ? {
              sourceEvent: {
                id: `${taskId}:user:${entries.length}`,
                type: "task.updated",
                taskId,
                timestamp,
                source: eventSource,
                title: "user follow-up",
                summary: clipText(messageText, 240),
                status: "running",
              },
            }
          : {}),
      });
      continue;
    }

    if (message.role === "assistant" && actionableAssistantText) {
      const assistantSummary = messageText;
      entries.push({
        index: entries.length,
        timestamp,
        role: "assistant",
        kind: "message",
        significance: "attention",
        label: `assistant:message:${messageIndex}`,
        text: assistantSummary,
        excerpt: clipText(assistantSummary, 240),
        rawRef: { messageIndex },
        sourceEvent: {
          id: `${taskId}:assistant:${entries.length}`,
          type: "task.updated",
          taskId,
          timestamp,
          source: eventSource,
          title: clipText(assistantSummary, 96),
          summary: clipText(assistantSummary, 240),
          status: inferAssistantStatus(assistantSummary),
        },
      });
    } else if (message.role === "assistant" && messageText) {
      entries.push({
        index: entries.length,
        timestamp,
        role: "assistant",
        kind: "message",
        significance: "context",
        label: `assistant:context:${messageIndex}`,
        text: messageText,
        excerpt: clipText(messageText, 240),
        rawRef: { messageIndex },
      });
    }

    if (
      message.role !== "assistant" ||
      !Array.isArray(message.tool_uses) ||
      message.tool_uses.length === 0
    ) {
      continue;
    }

    for (const [toolUseIndex, toolUse] of message.tool_uses.entries()) {
      const toolName = toolUse.tool.trim();
      const toolFamily = normalizeToolFamily(toolName);
      const toolCallSummary = summarizeDataclawToolCall(toolUse);
      entries.push({
        index: entries.length,
        timestamp,
        role: "assistant",
        kind: "tool_call",
        significance: "attention",
        label: `assistant:tool:${messageIndex}:${toolUseIndex}`,
        ...(toolCallSummary
          ? { text: toolCallSummary, excerpt: clipText(toolCallSummary, 240) }
          : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolFamily ? { toolFamily } : {}),
        rawRef: { messageIndex, toolUseIndex },
        sourceEvent: {
          id: `${taskId}:assistant:${messageIndex}:${toolUseIndex}`,
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

      const toolResultText = summarizeDataclawToolResult(toolUse);
      const toolResultStatus = inferDataclawToolResultStatus(toolUse, toolResultText, toolFamily);
      if (!toolResultText && toolResultStatus === "running") {
        continue;
      }

      entries.push({
        index: entries.length,
        timestamp,
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        label: `tool:result:${messageIndex}:${toolUseIndex}`,
        ...(toolResultText ? { text: toolResultText, excerpt: clipText(toolResultText, 240) } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolFamily ? { toolFamily } : {}),
        rawRef: { messageIndex, toolUseIndex },
        sourceEvent: {
          id: `${taskId}:tool:${messageIndex}:${toolUseIndex}`,
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
    }
  }

  if (!started) {
    entries.unshift({
      index: 0,
      timestamp: coerceImportedTimestamp(row.start_time, row.start_time, 0),
      role: "user",
      kind: "message",
      significance: "attention",
      label: "session prompt",
      text: firstPrompt,
      excerpt: clipText(summary, 220),
      sourceEvent: {
        id: `${taskId}:start`,
        type: "task.started",
        taskId,
        timestamp: coerceImportedTimestamp(row.start_time, row.start_time, 0),
        source: eventSource,
        title,
        summary: clipText(summary, 220),
      },
    });
  }

  for (const [index, entry] of entries.entries()) {
    entry.index = index;
  }

  return {
    schemaVersion: IMPORTED_SESSION_SCHEMA_VERSION,
    sessionId: taskId,
    title,
    description: `Imported from ${DATACLAW_DATASET} (${split}, ${row.source}, ${row.model}) for ${row.project}.`,
    doctrineTags: [
      "public_seed",
      "trajectory",
      "dataclaw",
      split,
      slug(row.source),
      slug(row.project),
    ],
    source: defaultDataclawBundleSource(row, split),
    importedAt: coerceImportedTimestamp(row.start_time, row.start_time, 0),
    entries,
  };
}

export function createReplayScenarioFromDataclawRow(
  row: DataclawRow,
  options: { split?: DataclawSplit } = {},
): ReplayScenario {
  return createReplayScenarioFromImportedSession(
    createImportedSessionFromDataclawRow(row, options),
  );
}

export function createSessionBundleFromDataclawRow(
  row: DataclawRow,
  options: {
    split?: DataclawSplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = readDataclawSplit(options.split);
  const session = createImportedSessionFromDataclawRow(row, { split });
  const bundle = createSessionBundleFromImportedSession(session, {
    source: defaultDataclawBundleSource(row, split),
    exportedAt: options.exportedAt ?? session.importedAt,
    replayTimeSource: deterministicReplayTimeSource(session.importedAt),
  });
  return validateImportedTrajectoryBundle(bundle);
}

function deterministicReplayTimeSource(startIso: string): () => number {
  const startMs = Date.parse(startIso);
  let tick = 0;
  return () => startMs + tick++;
}

export function defaultDataclawBundleSource(
  row: DataclawRow,
  split: DataclawSplit = DEFAULT_DATACLAW_SPLIT,
): ReplaySessionBundleSource {
  return {
    id: "huggingface:dataclaw",
    kind: "public-dataset",
    label: "DataClaw sessions",
    redacted: false,
    capture: {
      eventTransport: "huggingface-datasets-server",
      semanticCapture: "source+normalized+trace",
      notes: [
        `dataset=${DATACLAW_DATASET}`,
        `split=${split}`,
        `session=${row.session_id}`,
        `project=${row.project}`,
        `source=${row.source}`,
        `model=${row.model}`,
        ...(row.git_branch ? [`branch=${row.git_branch}`] : []),
      ],
    },
  };
}

function readDataclawFirstPrompt(messages: DataclawMessage[]): string {
  const firstUserMessage = messages.find((message) => {
    if (message.role !== "user") {
      return false;
    }
    const text = readDataclawMessageText(message);
    return (
      Boolean(text) && !isDataclawLocalCommandNoise(text) && !isDataclawCompactionContext(text)
    );
  });

  return firstUserMessage ? readDataclawMessageText(firstUserMessage) : "Imported DataClaw session";
}

function readDataclawMessageText(message: DataclawMessage): string {
  return typeof message.content === "string" ? message.content.trim() : "";
}

function summarizeDataclawToolCall(toolUse: DataclawToolUse): string | null {
  const fragments = [stringifyStructuredValue(toolUse.input)].filter((value): value is string =>
    Boolean(value),
  );

  if (fragments.length === 0) {
    return toolUse.tool.trim();
  }

  return `${toolUse.tool.trim()}: ${fragments[0]}`;
}

function summarizeDataclawToolResult(toolUse: DataclawToolUse): string | null {
  const outputText = stringifyStructuredValue(toolUse.output);
  if (outputText) {
    return outputText;
  }

  if (typeof toolUse.status === "string" && toolUse.status.trim().length > 0) {
    return `${toolUse.tool.trim()} ${toolUse.status.trim()}`;
  }

  return null;
}

function isDataclawLocalCommandNoise(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("<local-command-caveat>") ||
    normalized.includes("<command-name>") ||
    normalized.includes("<command-message>") ||
    normalized.includes("<command-args>") ||
    normalized.includes("<local-command-stdout>") ||
    normalized.includes("<local-command-stderr>")
  );
}

function isDataclawCompactionContext(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.startsWith("this session is being continued from a previous conversation") ||
    normalized.startsWith("you've hit your limit") ||
    normalized === "no response requested."
  );
}

function isDataclawNonActionableAssistantText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized === "no response requested." ||
    normalized.startsWith("let me first check the previous conversation") ||
    normalized.startsWith("let me read the previous conversation") ||
    normalized.startsWith("let me first read the file")
  );
}
