import { mkdir, writeFile } from "node:fs/promises";

import { isRecord } from "./public-trajectories-shared.js";
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
