import { mkdir, writeFile } from "node:fs/promises";

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
  DEFAULT_OPEN_AGENT_SESSIONS_RAW_DIR,
  DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
  OPEN_AGENT_SESSIONS_SITE_URL,
  OPEN_AGENT_SESSIONS_URLS_URL,
  type OpenAgentSessionsContentBlock,
  type OpenAgentSessionsEvent,
  type OpenAgentSessionsMessage,
  type OpenAgentSessionsMetadata,
  type OpenAgentSessionsRow,
  type OpenAgentSessionsSplit,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";

const DEFAULT_SOURCE_KIND = "public-trajectory";

export async function fetchOpenAgentSessionsRows(
  options: {
    split?: OpenAgentSessionsSplit;
    offset?: number;
    limit?: number;
    dryRun?: boolean;
  } = {},
): Promise<OpenAgentSessionsRow[]> {
  const split = readOpenAgentSessionsSplit(options.split);
  if (split !== "approved") {
    throw new Error("OpenAgentSessions split must be: approved");
  }

  const [urlsText, homepageText] = await Promise.all([
    fetchText(OPEN_AGENT_SESSIONS_URLS_URL, "OpenAgentSessions url feed"),
    fetchText(OPEN_AGENT_SESSIONS_SITE_URL, "OpenAgentSessions homepage"),
  ]);
  const urls = mergeOpenAgentSessionsUrls(
    parseOpenAgentSessionsUrls(urlsText),
    parseOpenAgentSessionsApprovedUrls(homepageText),
  );
  const offset = options.offset ?? 0;
  const limit = options.limit ?? urls.length;
  const selected = urls.slice(offset, offset + limit);

  return Promise.all(selected.map((url) => fetchOpenAgentSessionsRow(url, {
    mirrorRaw: !options.dryRun,
  })));
}

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
  const title = readIssueTitle(firstPrompt || metadataTopic || "")
    ?? clipText(metadataTopic ?? `Imported OpenAgentSessions session ${row.session_id}`, 96);
  const summary = toSingleLine(firstPrompt) ?? metadataTopic ?? `OpenAgentSessions ${row.session_id}`;
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
          summary: clipText(userText, 240),
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
            summary: clipText(assistantText, 240),
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
          ...(toolCallSummary ? { text: toolCallSummary, excerpt: clipText(toolCallSummary, 240) } : {}),
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
            ...(toolCallSummary ? { summary: clipText(toolCallSummary, 240) } : {}),
            status: "running",
          },
        });
      }
      continue;
    }

    if (message.role === "toolResult" || message.role === "bashExecution") {
      const toolName = message.role === "bashExecution"
        ? "bash"
        : typeof message.toolName === "string"
          ? message.toolName.trim()
          : "";
      const toolFamily = normalizeToolFamily(toolName || lastToolFamily);
      if (toolFamily) {
        lastToolFamily = toolFamily;
      }
      const toolResultText = readOpenAgentSessionsToolResultText(message);
      const toolResultStatus = inferOpenAgentSessionsToolResultStatus(message, toolResultText, toolFamily);
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
          ...(toolResultText ? { summary: clipText(toolResultText, 240) } : {}),
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
        summary: clipText(summary, 220),
      },
    });
  }

  for (const [index, entry] of entries.entries()) {
    entry.index = index;
  }

  const metadataTags = Array.isArray(row.metadata?.tags) ? row.metadata.tags.map((tag) => slug(tag)) : [];

  return {
    schemaVersion: 1,
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

export function parseOpenAgentSessionsJsonlText(
  value: string,
  gistId: string,
): OpenAgentSessionsEvent[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, lineIndex) => parseOpenAgentSessionsEvent(line, gistId, lineIndex));
}

export function readOpenAgentSessionsSplit(
  value: PublicTrajectorySplit | undefined,
): OpenAgentSessionsSplit {
  if (value === undefined || value === "approved") {
    return value ?? DEFAULT_OPEN_AGENT_SESSIONS_SPLIT;
  }

  throw new Error("OpenAgentSessions split must be: approved");
}

function parseOpenAgentSessionsUrls(text: string): string[] {
  return mergeOpenAgentSessionsUrls(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

function parseOpenAgentSessionsApprovedUrls(text: string): string[] {
  const matches = text.match(/https:\/\/gist\.github\.com\/[A-Za-z0-9_.-]+\/[a-f0-9]+/gi) ?? [];
  return mergeOpenAgentSessionsUrls(matches);
}

function mergeOpenAgentSessionsUrls(...groups: readonly string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const candidate of group) {
      try {
        const normalized = normalizeOpenAgentSessionsGistUrl(candidate);
        const gistId = readOpenAgentSessionsGistId(normalized).toLowerCase();
        if (seen.has(gistId)) {
          continue;
        }
        seen.add(gistId);
        merged.push(normalized);
      } catch {
        continue;
      }
    }
  }

  return merged;
}

function normalizeOpenAgentSessionsGistUrl(url: string): string {
  return url.trim().replace(/[\\/]+$/g, "");
}

async function fetchOpenAgentSessionsRow(
  gistUrl: string,
  options: { mirrorRaw: boolean },
): Promise<OpenAgentSessionsRow> {
  const gistId = readOpenAgentSessionsGistId(gistUrl);
  const gistResponse = await fetch(`https://api.github.com/gists/${gistId}`);
  if (!gistResponse.ok) {
    throw new Error(`Failed to fetch OpenAgentSessions gist ${gistId}: ${gistResponse.status} ${gistResponse.statusText}`);
  }

  const gist = await gistResponse.json() as unknown;
  if (!isRecord(gist) || !isRecord(gist.files)) {
    throw new Error(`Invalid OpenAgentSessions gist payload for ${gistId}.`);
  }

  const files = Object.entries(gist.files)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  const jsonlFile = files.find(([name, file]) =>
    name.endsWith(".redacted.jsonl") || (name.endsWith(".jsonl") && typeof file.raw_url === "string"));
  if (!jsonlFile) {
    throw new Error(`OpenAgentSessions gist ${gistId} does not contain a redacted JSONL export.`);
  }

  const metadataFile = files.find(([name, file]) =>
    name === "openagentsessions.json" && typeof file.raw_url === "string");
  const jsonlRawUrl = typeof jsonlFile[1].raw_url === "string" ? jsonlFile[1].raw_url : undefined;
  const metadataRawUrl = typeof metadataFile?.[1].raw_url === "string"
    ? metadataFile[1].raw_url
    : undefined;
  if (typeof jsonlRawUrl !== "string") {
    throw new Error(`OpenAgentSessions gist ${gistId} is missing a JSONL raw URL.`);
  }

  const [jsonlText, metadata] = await Promise.all([
    fetchText(jsonlRawUrl, `OpenAgentSessions session ${gistId}`),
    metadataRawUrl ? fetchJson(metadataRawUrl, `OpenAgentSessions metadata ${gistId}`) : Promise.resolve(undefined),
  ]);

  const rawMirrorDir = options.mirrorRaw
    ? await mirrorOpenAgentSessionsRaw(gistId, jsonlFile[0], jsonlText, metadataFile?.[0], metadata)
    : undefined;
  const events = parseOpenAgentSessionsJsonlText(jsonlText, gistId);
  const sessionEvent = events.find((event) => event.type === "session");
  const sessionId = typeof sessionEvent?.id === "string"
    ? sessionEvent.id
    : `open-agent-sessions-${gistId}`;
  const contributor = isRecord(gist.owner) && typeof gist.owner.login === "string"
    ? gist.owner.login
    : undefined;

  return {
    gist_id: gistId,
    gist_url: gistUrl,
    jsonl_raw_url: jsonlRawUrl,
    jsonl_file_name: jsonlFile[0],
    ...(metadataRawUrl ? { metadata_raw_url: metadataRawUrl } : {}),
    ...(metadataFile?.[0] ? { metadata_file_name: metadataFile[0] } : {}),
    ...(contributor ? { contributor } : {}),
    session_id: sessionId,
    events,
    ...(isOpenAgentSessionsMetadata(metadata) ? { metadata } : {}),
    ...(rawMirrorDir ? { raw_mirror_dir: rawMirrorDir } : {}),
  };
}

async function fetchText(url: string, label: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function mirrorOpenAgentSessionsRaw(
  gistId: string,
  jsonlFileName: string,
  jsonlText: string,
  metadataFileName: string | undefined,
  metadata: unknown,
): Promise<string> {
  const rawDir = `${DEFAULT_OPEN_AGENT_SESSIONS_RAW_DIR}/${gistId}`;
  await mkdir(rawDir, { recursive: true });
  await writeFile(`${rawDir}/${jsonlFileName}`, jsonlText, "utf8");
  if (metadataFileName && metadata !== undefined) {
    await writeFile(`${rawDir}/${metadataFileName}`, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }
  return rawDir;
}

function parseOpenAgentSessionsEvent(
  line: string,
  gistId: string,
  lineIndex: number,
): OpenAgentSessionsEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Failed to parse OpenAgentSessions JSONL at ${gistId}:${lineIndex + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error(`Invalid OpenAgentSessions event at ${gistId}:${lineIndex + 1}.`);
  }

  const event: OpenAgentSessionsEvent = {
    type: parsed.type,
    ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
    ...(typeof parsed.parentId === "string" || parsed.parentId === null ? { parentId: parsed.parentId } : {}),
    ...(typeof parsed.timestamp === "string" ? { timestamp: parsed.timestamp } : {}),
    ...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
    ...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
    ...(typeof parsed.provider === "string" ? { provider: parsed.provider } : {}),
    ...(typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}),
    ...(typeof parsed.thinkingLevel === "string" ? { thinkingLevel: parsed.thinkingLevel } : {}),
  };

  if (isRecord(parsed.message)) {
    event.message = parseOpenAgentSessionsMessage(parsed.message, gistId, lineIndex);
  }

  return event;
}

function parseOpenAgentSessionsMessage(
  value: Record<string, unknown>,
  gistId: string,
  lineIndex: number,
): OpenAgentSessionsMessage {
  if (
    value.role !== "system"
    && value.role !== "user"
    && value.role !== "assistant"
    && value.role !== "toolResult"
    && value.role !== "bashExecution"
  ) {
    throw new Error(`Invalid OpenAgentSessions message role at ${gistId}:${lineIndex + 1}.`);
  }

  return {
    role: value.role,
    ...(Array.isArray(value.content)
      ? {
          content: value.content.map((block, blockIndex) =>
            parseOpenAgentSessionsContentBlock(block, gistId, lineIndex, blockIndex)),
        }
      : {}),
    ...(typeof value.timestamp === "number" ? { timestamp: value.timestamp } : {}),
    ...(typeof value.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
    ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
    ...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
    ...(typeof value.excludeFromContext === "boolean" ? { excludeFromContext: value.excludeFromContext } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.stopReason === "string" ? { stopReason: value.stopReason } : {}),
    ...("usage" in value ? { usage: value.usage } : {}),
  };
}

function parseOpenAgentSessionsContentBlock(
  value: unknown,
  gistId: string,
  lineIndex: number,
  blockIndex: number,
): OpenAgentSessionsContentBlock {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`Invalid OpenAgentSessions content block at ${gistId}:${lineIndex + 1}[${blockIndex}].`);
  }

  return {
    type: value.type,
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    ...(typeof value.thinkingSignature === "string" ? { thinkingSignature: value.thinkingSignature } : {}),
    ...(typeof value.textSignature === "string" ? { textSignature: value.textSignature } : {}),
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.partialJson === "string" ? { partialJson: value.partialJson } : {}),
    ...("arguments" in value ? { arguments: value.arguments } : {}),
  };
}

function isOpenAgentSessionsMetadata(value: unknown): value is OpenAgentSessionsMetadata {
  return isRecord(value);
}

function readOpenAgentSessionsGistId(gistUrl: string): string {
  const match = gistUrl.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
  if (!match?.[1]) {
    throw new Error(`Invalid OpenAgentSessions gist URL: ${gistUrl}`);
  }

  return match[1];
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

function readOpenAgentSessionsToolResultText(
  message: OpenAgentSessionsMessage,
): string {
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

  return blocks.filter((block): block is OpenAgentSessionsContentBlock & { name: string } =>
    block.type === "toolCall" && typeof block.name === "string" && block.name.trim().length > 0);
}

function inferOpenAgentSessionsToolResultStatus(
  message: OpenAgentSessionsMessage,
  text: string,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  if (
    message.role === "bashExecution"
    && (message.cancelled || (typeof message.exitCode === "number" && message.exitCode !== 0))
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
