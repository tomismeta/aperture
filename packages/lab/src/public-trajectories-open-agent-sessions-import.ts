import type { SourceEvent } from "@tomismeta/aperture-core";

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
  coerceImportedTimestamp,
  inferAssistantStatus,
  inferObservationStatus,
  isRecord,
  normalizeToolFamily,
  readIssueTitle,
  slug,
  stringifyStructuredValue,
  syntheticTimestamp,
  toSingleLine,
  trajectorySlug,
  validateImportedTrajectoryBundle,
} from "./public-trajectories-shared.js";
import {
  DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
  type OpenAgentSessionsContentBlock,
  type OpenAgentSessionsEvent,
  type OpenAgentSessionsMessage,
  type OpenAgentSessionsRow,
  type OpenAgentSessionsSplit,
} from "./public-trajectories-types.js";
import { readOpenAgentSessionsSplit } from "./public-trajectories-open-agent-sessions-fetch.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

export function createImportedSessionFromOpenAgentSessionsRow(
  row: OpenAgentSessionsRow,
  options: { split?: OpenAgentSessionsSplit } = {},
): ImportedSession {
  const split = readOpenAgentSessionsSplit(options.split);
  const recordId = buildOpenAgentSessionsRecordId(row);
  const taskId = `public:open-agent-sessions:${trajectorySlug(recordId)}`;
  const eventSource = {
    id: `public:open-agent-sessions:${slug(recordId)}`,
    kind: DEFAULT_SOURCE_KIND,
    label: "OpenAgentSessions",
  };
  const firstPrompt = readOpenAgentSessionsFirstPrompt(row.events);
  const metadataTopic = row.metadata?.session?.topic?.trim();
  const title =
    readIssueTitle(firstPrompt || metadataTopic || "") ??
    clipText(metadataTopic ?? `Imported OpenAgentSessions session ${row.session_id}`, 96);
  const summary =
    toSingleLine(firstPrompt) ?? metadataTopic ?? `OpenAgentSessions ${row.session_id}`;
  const entries: ImportedSessionEntry[] = [];
  let started = false;
  let lastToolFamily: string | undefined;

  for (const [eventIndex, event] of row.events.entries()) {
    if (event.type !== "message" || !isRecord(event.message)) {
      continue;
    }

    const message = event.message;
    const timestamp = coerceImportedTimestamp(
      readOpenAgentSessionsTimestamp(message.timestamp, event.timestamp),
      row.metadata?.created_at,
      entries.length,
    );
    const rawRefBase = {
      line: eventIndex + 1,
      ...(typeof event.id === "string" ? { id: event.id } : {}),
    };

    if (message.role === "user") {
      const userText = readOpenAgentSessionsTextContent(message.content);
      if (!userText) {
        continue;
      }

      if (!started) {
        entries.push({
          index: entries.length,
          timestamp,
          role: "user",
          kind: "message",
          significance: "attention",
          label: "session prompt",
          text: userText,
          excerpt: clipText(summary, 220),
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:start`,
            type: "task.started",
            taskId,
            timestamp,
            source: eventSource,
            title,
            summary: clipSourceEventSummary(summary),
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
        significance: "attention",
        label: `user:followup:${eventIndex}`,
        text: userText,
        excerpt: clipText(userText, 240),
        rawRef: rawRefBase,
        sourceEvent: {
          id: `${taskId}:user:${entries.length}`,
          type: "task.updated",
          taskId,
          timestamp,
          source: eventSource,
          title: "user follow-up",
          summary: clipSourceEventSummary(userText),
          status: "running",
        },
      });
      continue;
    }

    if (message.role === "assistant") {
      const assistantText = readOpenAgentSessionsTextContent(message.content);
      if (assistantText) {
        entries.push({
          index: entries.length,
          timestamp,
          role: "assistant",
          kind: "message",
          significance: "attention",
          label: `assistant:message:${eventIndex}`,
          text: assistantText,
          excerpt: clipText(assistantText, 240),
          rawRef: rawRefBase,
          sourceEvent: {
            id: `${taskId}:assistant:${entries.length}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            title: clipText(assistantText, 96),
            summary: clipSourceEventSummary(assistantText),
            status: inferAssistantStatus(assistantText),
          },
        });
      }

      const toolCalls = readOpenAgentSessionsToolCalls(message.content);
      for (const [toolUseIndex, toolCall] of toolCalls.entries()) {
        const toolName = toolCall.name.trim();
        const toolFamily = normalizeToolFamily(toolName);
        if (toolFamily) {
          lastToolFamily = toolFamily;
        }
        const toolCallSummary = summarizeOpenAgentSessionsToolCall(toolCall);
        entries.push({
          index: entries.length,
          timestamp,
          role: "assistant",
          kind: "tool_call",
          significance: "attention",
          label: `assistant:tool:${eventIndex}:${toolUseIndex}`,
          ...(toolCallSummary
            ? { text: toolCallSummary, excerpt: clipText(toolCallSummary, 240) }
            : {}),
          ...(toolName ? { toolName } : {}),
          ...(toolFamily ? { toolFamily } : {}),
          rawRef: { ...rawRefBase, toolUseIndex },
          sourceEvent: {
            id: `${taskId}:assistant:${eventIndex}:${toolUseIndex}`,
            type: "task.updated",
            taskId,
            timestamp,
            source: eventSource,
            ...(toolFamily ? { toolFamily } : {}),
            title: buildAssistantTitle(toolFamily, toolCallSummary ?? toolName),
            ...(toolCallSummary ? { summary: clipSourceEventSummary(toolCallSummary) } : {}),
            status: "running",
          },
        });
      }
      continue;
    }

    if (message.role === "toolResult" || message.role === "bashExecution") {
      const toolName =
        message.role === "bashExecution"
          ? "bash"
          : typeof message.toolName === "string"
            ? message.toolName.trim()
            : "";
      const toolFamily = normalizeToolFamily(toolName || lastToolFamily);
      if (toolFamily) {
        lastToolFamily = toolFamily;
      }
      const toolResultText = readOpenAgentSessionsToolResultText(message);
      const toolResultStatus = inferOpenAgentSessionsToolResultStatus(
        message,
        toolResultText,
        toolFamily,
      );
      if (!toolResultText && toolResultStatus === "running") {
        continue;
      }

      entries.push({
        index: entries.length,
        timestamp,
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        label: `tool:result:${eventIndex}`,
        ...(toolResultText ? { text: toolResultText, excerpt: clipText(toolResultText, 240) } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolFamily ? { toolFamily } : {}),
        rawRef: rawRefBase,
        sourceEvent: {
          id: `${taskId}:tool:${eventIndex}`,
          type: "task.updated",
          taskId,
          timestamp,
          source: eventSource,
          ...(toolFamily ? { toolFamily } : {}),
          title: buildObservationTitle(toolResultStatus, toolFamily),
          ...(toolResultText ? { summary: clipSourceEventSummary(toolResultText) } : {}),
          status: toolResultStatus,
        },
      });
    }
  }

  if (!started) {
    const importedAt = row.metadata?.created_at ?? syntheticTimestamp(0);
    entries.unshift({
      index: 0,
      timestamp: importedAt,
      role: "user",
      kind: "message",
      significance: "attention",
      label: "session prompt",
      text: firstPrompt || metadataTopic || title,
      excerpt: clipText(summary, 220),
      sourceEvent: {
        id: `${taskId}:start`,
        type: "task.started",
        taskId,
        timestamp: importedAt,
        source: eventSource,
        title,
        summary: clipSourceEventSummary(summary),
      },
    });
  }

  for (const [index, entry] of entries.entries()) {
    entry.index = index;
  }

  const metadataTags = Array.isArray(row.metadata?.tags)
    ? row.metadata.tags.map((tag) => slug(tag))
    : [];

  return {
    schemaVersion: IMPORTED_SESSION_SCHEMA_VERSION,
    sessionId: taskId,
    title,
    description: `Imported from OpenAgentSessions (${split}) for session ${row.session_id}.`,
    doctrineTags: [
      "public_seed",
      "trajectory",
      "open-agent-sessions",
      split,
      ...(row.metadata?.session?.agent ? [slug(row.metadata.session.agent)] : []),
      ...(row.metadata?.session?.model ? [slug(row.metadata.session.model)] : []),
      ...metadataTags,
    ],
    source: {
      id: "open-agent-sessions:approved",
      kind: "public-dataset",
      label: "OpenAgentSessions",
      redacted: true,
      upstreamUrl: row.gist_url,
      ...(row.raw_mirror_dir ? { rawMirrorPath: row.raw_mirror_dir } : {}),
      ...(row.metadata?.license ? { license: row.metadata.license } : {}),
      ...(row.contributor ? { contributor: row.contributor } : {}),
      capture: {
        eventTransport: "jsonl-gist",
        semanticCapture: "source+normalized+trace",
        notes: [
          "dataset=open-agent-sessions",
          `split=${split}`,
          `gist=${row.gist_id}`,
          `session=${row.session_id}`,
          ...(row.metadata?.session?.agent ? [`agent=${row.metadata.session.agent}`] : []),
          ...(row.metadata?.session?.model ? [`model=${row.metadata.session.model}`] : []),
          ...(row.metadata?.session?.topic ? [`topic=${row.metadata.session.topic}`] : []),
        ],
      },
    },
    importedAt: row.metadata?.created_at ?? syntheticTimestamp(0),
    entries,
  };
}

export function createReplayScenarioFromOpenAgentSessionsRow(
  row: OpenAgentSessionsRow,
  options: { split?: OpenAgentSessionsSplit } = {},
): ReplayScenario {
  return createReplayScenarioFromImportedSession(
    createImportedSessionFromOpenAgentSessionsRow(row, options),
  );
}

export function createSessionBundleFromOpenAgentSessionsRow(
  row: OpenAgentSessionsRow,
  options: {
    split?: OpenAgentSessionsSplit;
    exportedAt?: string;
  } = {},
): ReplaySessionBundle {
  const split = readOpenAgentSessionsSplit(options.split);
  const session = createImportedSessionFromOpenAgentSessionsRow(row, { split });
  const bundle = createSessionBundleFromImportedSession(session, {
    source: defaultOpenAgentSessionsBundleSource(row, split),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
  });
  return validateImportedTrajectoryBundle(bundle);
}

export function defaultOpenAgentSessionsBundleSource(
  row: OpenAgentSessionsRow,
  split: OpenAgentSessionsSplit = DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
): ReplaySessionBundleSource {
  return {
    id: "open-agent-sessions:approved",
    kind: "public-dataset",
    label: "OpenAgentSessions",
    redacted: true,
    ...(row.gist_url ? { upstreamUrl: row.gist_url } : {}),
    ...(row.raw_mirror_dir ? { rawMirrorPath: row.raw_mirror_dir } : {}),
    ...(row.metadata?.license ? { license: row.metadata.license } : {}),
    ...(row.contributor ? { contributor: row.contributor } : {}),
    capture: {
      eventTransport: "jsonl-gist",
      semanticCapture: "source+normalized+trace",
      notes: [
        "dataset=open-agent-sessions",
        `split=${split}`,
        `gist=${row.gist_id}`,
        `session=${row.session_id}`,
        ...(row.metadata?.session?.agent ? [`agent=${row.metadata.session.agent}`] : []),
        ...(row.metadata?.session?.model ? [`model=${row.metadata.session.model}`] : []),
        ...(row.metadata?.session?.topic ? [`topic=${row.metadata.session.topic}`] : []),
      ],
    },
  };
}

function buildOpenAgentSessionsRecordId(row: OpenAgentSessionsRow): string {
  const sessionId = row.session_id.trim();
  if (!isRedactedOpenAgentSessionsSessionId(sessionId)) {
    return sessionId;
  }

  return `${sessionId}-${row.gist_id}`;
}

function isRedactedOpenAgentSessionsSessionId(value: string): boolean {
  return /^\[[A-Z0-9_ -]+\]$/i.test(value) || value.toUpperCase().includes("REDACTED");
}

function readOpenAgentSessionsFirstPrompt(events: OpenAgentSessionsEvent[]): string {
  for (const event of events) {
    if (event.type !== "message" || !isRecord(event.message) || event.message.role !== "user") {
      continue;
    }

    const text = readOpenAgentSessionsTextContent(event.message.content);
    if (text) {
      return text;
    }
  }

  return "";
}

function readOpenAgentSessionsTextContent(
  blocks: OpenAgentSessionsContentBlock[] | undefined,
): string {
  if (!Array.isArray(blocks)) {
    return "";
  }

  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}

function readOpenAgentSessionsToolResultText(message: OpenAgentSessionsMessage): string {
  if (message.role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command.trim() : "";
    const output = typeof message.output === "string" ? message.output.trim() : "";
    if (command && output) {
      return `command: ${command}\n${output}`.trim();
    }
    return output || command;
  }

  return readOpenAgentSessionsTextContent(message.content);
}

function readOpenAgentSessionsToolCalls(
  blocks: OpenAgentSessionsContentBlock[] | undefined,
): Array<OpenAgentSessionsContentBlock & { name: string }> {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.filter(
    (block): block is OpenAgentSessionsContentBlock & { name: string } =>
      block.type === "toolCall" && typeof block.name === "string" && block.name.trim().length > 0,
  );
}

function inferOpenAgentSessionsToolResultStatus(
  message: OpenAgentSessionsMessage,
  text: string,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  if (
    message.role === "bashExecution" &&
    (message.cancelled || (typeof message.exitCode === "number" && message.exitCode !== 0))
  ) {
    return "failed";
  }

  if (message.isError) {
    return "failed";
  }

  if (text) {
    return inferObservationStatus(text, toolFamily);
  }

  return "running";
}

function summarizeOpenAgentSessionsToolCall(
  toolCall: OpenAgentSessionsContentBlock & { name: string },
): string | null {
  const argumentsText = stringifyStructuredValue(toolCall.arguments);
  if (argumentsText) {
    return `${toolCall.name.trim()}: ${argumentsText}`;
  }

  if (typeof toolCall.partialJson === "string" && toolCall.partialJson.trim().length > 0) {
    return `${toolCall.name.trim()}: ${toolCall.partialJson.trim()}`;
  }

  return toolCall.name.trim();
}

function readOpenAgentSessionsTimestamp(
  messageTimestamp: number | undefined,
  eventTimestamp: string | undefined,
): string | undefined {
  if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
    return new Date(messageTimestamp).toISOString();
  }

  return eventTimestamp;
}
