import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultPublicTrajectorySplit,
  parseDataclawRowsResponse,
  parseOpenAgentSessionsJsonlText,
  parsePiRow,
  parseSweSmithRowsResponse,
  type DataclawRow,
  type OpenAgentSessionsEvent,
  type OpenAgentSessionsMetadata,
  type OpenAgentSessionsRow,
  type PiRow,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
  type SweSmithTrajectoryRow,
} from "./public-trajectories.js";
import { isRecord } from "./shape.js";
import type { ImportTrajectoryBundlesFromFileOptions } from "./fstop-ingest.js";

export type RawTrajectoryRecord =
  | {
      dataset: "swe-smith";
      row: SweSmithTrajectoryRow;
      split: PublicTrajectorySplit;
      recordId: string;
    }
  | {
      dataset: "dataclaw";
      row: DataclawRow;
      split: PublicTrajectorySplit;
      recordId: string;
    }
  | {
      dataset: "pi";
      row: PiRow;
      split: PublicTrajectorySplit;
      recordId: string;
    }
  | {
      dataset: "open-agent-sessions";
      row: OpenAgentSessionsRow;
      split: PublicTrajectorySplit;
      recordId: string;
    };

export async function loadRawTrajectoryRecords(
  filePath: string,
  options: ImportTrajectoryBundlesFromFileOptions,
): Promise<RawTrajectoryRecord[]> {
  const text = await readFile(filePath, "utf8");
  const datasetHint = options.dataset;
  const splitHint = options.split;

  try {
    const parsed = JSON.parse(stripJsonBom(text)) as unknown;
    return await parseRawJsonValue(parsed, filePath, datasetHint, splitHint);
  } catch (error) {
    if (looksLikeJsonParseError(error)) {
      return await parseRawJsonLines(text, filePath, datasetHint, splitHint);
    }
    throw error;
  }
}

async function parseRawJsonValue(
  value: unknown,
  filePath: string,
  datasetHint: PublicTrajectoryDataset | undefined,
  splitHint: PublicTrajectorySplit | undefined,
): Promise<RawTrajectoryRecord[]> {
  if (isRecord(value) && Array.isArray(value.rows)) {
    if (datasetHint === "dataclaw" || (!datasetHint && looksLikeRowsResponseForDataset(value, "dataclaw"))) {
      return parseDataclawRowsResponse(value).map((row) => ({
        dataset: "dataclaw" as const,
        row,
        split: resolveSplit("dataclaw", splitHint),
        recordId: row.session_id,
      }));
    }
    if (datasetHint === "swe-smith" || (!datasetHint && looksLikeRowsResponseForDataset(value, "swe-smith"))) {
      return parseSweSmithRowsResponse(value).map((row) => ({
        dataset: "swe-smith" as const,
        row,
        split: resolveSplit("swe-smith", splitHint),
        recordId: row.traj_id,
      }));
    }
    if (datasetHint === "pi" || (!datasetHint && looksLikeRowsResponseForDataset(value, "pi"))) {
      return value.rows
        .map((entry) => (isRecord(entry) && isRecord(entry.row) ? entry.row : undefined))
        .filter((row): row is Record<string, unknown> => row !== undefined)
        .map((row) => {
          const parsed = parseSinglePiRow(row);
          return {
            dataset: "pi" as const,
            row: parsed,
            split: resolveSplit("pi", splitHint),
            recordId: parsed.session_id,
          };
        });
    }
  }

  if (Array.isArray(value)) {
    if (datasetHint === "pi" || looksLikePiTraceLog(value)) {
      return [
        {
          dataset: "pi",
          row: buildPiRowFromEvents(value, filePath),
          split: resolveSplit("pi", splitHint),
          recordId: readPiRecordIdFromFile(value, filePath),
        },
      ];
    }

    if (value.every((entry) => looksLikeOpenAgentSessionsEvent(entry))) {
      return [
        {
          dataset: "open-agent-sessions",
          row: await buildOpenAgentSessionsRowFromEvents(value, filePath),
          split: resolveSplit("open-agent-sessions", splitHint),
          recordId: readOpenAgentSessionsRecordIdFromFile(value, filePath),
        },
      ];
    }

    return Promise.all(
      value.map((entry, index) =>
        parseRawRecord(
          entry,
          filePath,
          datasetHint,
          splitHint,
          `entry ${index}`,
        )),
    );
  }

  return [
    await parseRawRecord(value, filePath, datasetHint, splitHint, "file"),
  ];
}

async function parseRawJsonLines(
  text: string,
  filePath: string,
  datasetHint: PublicTrajectoryDataset | undefined,
  splitHint: PublicTrajectorySplit | undefined,
): Promise<RawTrajectoryRecord[]> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`Raw trajectory file is empty: ${filePath}`);
  }

  const entries = lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`Failed to parse JSONL at ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  if (datasetHint === "pi" || looksLikePiTraceLog(entries)) {
    return [
      {
        dataset: "pi",
        row: buildPiRowFromEvents(entries, filePath),
        split: resolveSplit("pi", splitHint),
        recordId: readPiRecordIdFromFile(entries, filePath),
      },
    ];
  }

  if (entries.every((entry) => looksLikeOpenAgentSessionsEvent(entry))) {
    const events = entries as OpenAgentSessionsEvent[];
    return [
      {
        dataset: "open-agent-sessions",
        row: await buildOpenAgentSessionsRowFromEvents(events, filePath),
        split: resolveSplit("open-agent-sessions", splitHint),
        recordId: readOpenAgentSessionsRecordIdFromFile(events, filePath),
      },
    ];
  }

  return Promise.all(
    entries.map((entry, index) =>
      parseRawRecord(
        entry,
        filePath,
        datasetHint,
        splitHint,
        `line ${index + 1}`,
      )),
  );
}

async function parseRawRecord(
  value: unknown,
  filePath: string,
  datasetHint: PublicTrajectoryDataset | undefined,
  splitHint: PublicTrajectorySplit | undefined,
  label: string,
): Promise<RawTrajectoryRecord> {
  if (!isRecord(value)) {
    throw new Error(`Unsupported raw trajectory ${label}: expected a JSON object.`);
  }

  if (datasetHint === "dataclaw") {
    const row = parseSingleDataclawRow(value);
    return {
      dataset: "dataclaw",
      row,
      split: resolveSplit("dataclaw", splitHint),
      recordId: row.session_id,
    };
  }

  if (datasetHint === "swe-smith") {
    const row = parseSingleSweSmithRow(value);
    return {
      dataset: "swe-smith",
      row,
      split: resolveSplit("swe-smith", splitHint),
      recordId: row.traj_id,
    };
  }

  if (datasetHint === "open-agent-sessions") {
    const row = await normalizeOpenAgentSessionsRow(value, filePath);
    return {
      dataset: "open-agent-sessions",
      row,
      split: resolveSplit("open-agent-sessions", splitHint),
      recordId: row.session_id,
    };
  }

  if (datasetHint === "pi") {
    const row = parseSinglePiRow(value);
    return {
      dataset: "pi",
      row,
      split: resolveSplit("pi", splitHint),
      recordId: row.session_id,
    };
  }

  if (looksLikeDataclawRow(value)) {
    const row = parseSingleDataclawRow(value);
    return {
      dataset: "dataclaw",
      row,
      split: resolveSplit("dataclaw", splitHint),
      recordId: row.session_id,
    };
  }

  if (looksLikeSweSmithRow(value)) {
    const row = parseSingleSweSmithRow(value);
    return {
      dataset: "swe-smith",
      row,
      split: resolveSplit("swe-smith", splitHint),
      recordId: row.traj_id,
    };
  }

  if (looksLikeOpenAgentSessionsRow(value)) {
    const row = await normalizeOpenAgentSessionsRow(value, filePath);
    return {
      dataset: "open-agent-sessions",
      row,
      split: resolveSplit("open-agent-sessions", splitHint),
      recordId: row.session_id,
    };
  }

  if (looksLikePiRow(value)) {
    const row = parseSinglePiRow(value);
    return {
      dataset: "pi",
      row,
      split: resolveSplit("pi", splitHint),
      recordId: row.session_id,
    };
  }

  throw new Error(
    `Unsupported raw trajectory ${label}: expected a SWE-smith row, DataClaw row, Pi row, OpenAgentSessions row, or a supported raw JSONL event log.`,
  );
}

function parseSingleDataclawRow(value: Record<string, unknown>): DataclawRow {
  return parseDataclawRowsResponse({
    rows: [{ row: value }],
  })[0]!;
}

function parseSingleSweSmithRow(value: Record<string, unknown>): SweSmithTrajectoryRow {
  return parseSweSmithRowsResponse({
    rows: [{ row: value }],
  })[0]!;
}

function parseSinglePiRow(value: Record<string, unknown>): PiRow {
  return parsePiRow(value);
}

async function normalizeOpenAgentSessionsRow(
  value: Record<string, unknown>,
  filePath: string,
): Promise<OpenAgentSessionsRow> {
  if (typeof value.session_id !== "string" || !Array.isArray(value.events)) {
    throw new Error(`Invalid OpenAgentSessions row: expected session_id and events in ${filePath}`);
  }

  const events = value.events as OpenAgentSessionsEvent[];
  const inferredGistId = typeof value.gist_id === "string"
    ? value.gist_id
    : buildStableLocalRecordId(filePath);
  const inferredMetadata = isRecord(value.metadata)
    ? value.metadata as OpenAgentSessionsMetadata
    : await maybeLoadOpenAgentSessionsMetadata(filePath);

  return {
    gist_id: inferredGistId,
    gist_url: typeof value.gist_url === "string" ? value.gist_url : filePath,
    jsonl_raw_url: typeof value.jsonl_raw_url === "string" ? value.jsonl_raw_url : filePath,
    jsonl_file_name: typeof value.jsonl_file_name === "string"
      ? value.jsonl_file_name
      : path.basename(filePath),
    ...(typeof value.metadata_raw_url === "string" ? { metadata_raw_url: value.metadata_raw_url } : {}),
    ...(typeof value.metadata_file_name === "string"
      ? { metadata_file_name: value.metadata_file_name }
      : inferredMetadata
        ? { metadata_file_name: "openagentsessions.json" }
        : {}),
    ...(typeof value.contributor === "string" ? { contributor: value.contributor } : {}),
    session_id: value.session_id,
    events,
    ...(inferredMetadata ? { metadata: inferredMetadata } : {}),
    ...(typeof value.raw_mirror_dir === "string"
      ? { raw_mirror_dir: value.raw_mirror_dir }
      : { raw_mirror_dir: path.dirname(filePath) }),
  };
}

function buildPiRowFromEvents(
  events: readonly unknown[],
  filePath: string,
): PiRow {
  const sessionId = readPiRecordIdFromFile(events, filePath);
  const sessionEvent = events.find((event) =>
    isRecord(event) && event.type === "session" && typeof event.id === "string");
  const harness = isRecord(sessionEvent) && typeof sessionEvent.provider === "string"
    ? sessionEvent.provider
    : "pi";

  return parsePiRow({
    harness,
    session_id: sessionId,
    file_name: path.basename(filePath),
    ...(inferPiSourceDataset(filePath) ? { source_dataset: inferPiSourceDataset(filePath) } : {}),
    traces: events,
  });
}

async function buildOpenAgentSessionsRowFromEvents(
  events: readonly OpenAgentSessionsEvent[],
  filePath: string,
): Promise<OpenAgentSessionsRow> {
  const metadata = await maybeLoadOpenAgentSessionsMetadata(filePath);
  const gistId = buildStableLocalRecordId(filePath);
  const sessionEvent = events.find((event) => event.type === "session" && typeof event.id === "string");
  const sessionId = sessionEvent?.id
    ?? findFirstMessageId(events)
    ?? `open-agent-sessions-${gistId}`;

  return {
    gist_id: gistId,
    gist_url: filePath,
    jsonl_raw_url: filePath,
    jsonl_file_name: path.basename(filePath),
    ...(metadata ? { metadata_raw_url: path.join(path.dirname(filePath), "openagentsessions.json") } : {}),
    ...(metadata ? { metadata_file_name: "openagentsessions.json" } : {}),
    session_id: sessionId,
    events: [...events],
    ...(metadata ? { metadata } : {}),
    raw_mirror_dir: path.dirname(filePath),
  };
}

async function maybeLoadOpenAgentSessionsMetadata(
  filePath: string,
): Promise<OpenAgentSessionsMetadata | undefined> {
  const metadataPath = path.join(path.dirname(filePath), "openagentsessions.json");
  try {
    await access(metadataPath);
  } catch {
    return undefined;
  }

  const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed as OpenAgentSessionsMetadata : undefined;
}

function readOpenAgentSessionsRecordIdFromFile(
  events: readonly OpenAgentSessionsEvent[],
  filePath: string,
): string {
  const sessionEvent = events.find((event) => event.type === "session" && typeof event.id === "string");
  return sessionEvent?.id ?? `open-agent-sessions-${buildStableLocalRecordId(filePath)}`;
}

function readPiRecordIdFromFile(
  events: readonly unknown[],
  filePath: string,
): string {
  const sessionEvent = events.find((event) =>
    isRecord(event) && event.type === "session" && typeof event.id === "string");
  if (isRecord(sessionEvent) && typeof sessionEvent.id === "string") {
    return sessionEvent.id;
  }
  return `pi-${buildStableLocalRecordId(filePath)}`;
}

function findFirstMessageId(events: readonly OpenAgentSessionsEvent[]): string | undefined {
  return events.find((event) => typeof event.id === "string")?.id;
}

function resolveSplit(
  dataset: PublicTrajectoryDataset,
  splitHint: PublicTrajectorySplit | undefined,
): PublicTrajectorySplit {
  return splitHint ?? defaultPublicTrajectorySplit(dataset);
}

function looksLikeRowsResponseForDataset(
  value: Record<string, unknown>,
  dataset: PublicTrajectoryDataset,
): boolean {
  const firstRow = Array.isArray(value.rows) ? value.rows[0] : undefined;
  const row = isRecord(firstRow) && isRecord(firstRow.row) ? firstRow.row : undefined;
  if (!row) {
    return false;
  }
  if (dataset === "dataclaw") {
    return looksLikeDataclawRow(row);
  }
  if (dataset === "swe-smith") {
    return looksLikeSweSmithRow(row);
  }
  if (dataset === "pi") {
    return looksLikePiRow(row);
  }
  return looksLikeOpenAgentSessionsRow(row);
}

function looksLikeDataclawRow(value: Record<string, unknown>): boolean {
  return (
    typeof value.session_id === "string"
    && typeof value.model === "string"
    && typeof value.project === "string"
    && typeof value.source === "string"
    && typeof value.start_time === "string"
    && Array.isArray(value.messages)
  );
}

function looksLikeSweSmithRow(value: Record<string, unknown>): boolean {
  return (
    typeof value.messages === "string"
    && typeof value.instance_id === "string"
    && typeof value.model === "string"
    && typeof value.traj_id === "string"
    && typeof value.patch === "string"
    && typeof value.resolved === "boolean"
  );
}

function looksLikePiRow(value: Record<string, unknown>): boolean {
  return (
    typeof value.harness === "string"
    && typeof value.session_id === "string"
    && typeof value.file_name === "string"
    && Array.isArray(value.traces)
  );
}

function looksLikeOpenAgentSessionsRow(value: Record<string, unknown>): boolean {
  return typeof value.session_id === "string" && Array.isArray(value.events);
}

function looksLikeOpenAgentSessionsEvent(value: unknown): value is OpenAgentSessionsEvent {
  return isRecord(value) && typeof value.type === "string";
}

function looksLikePiTraceEntry(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  return (
    typeof value.parentId === "string"
    || value.parentId === null
    || typeof value.version === "number"
    || typeof value.cwd === "string"
    || typeof value.provider === "string"
    || typeof value.modelId === "string"
    || typeof value.thinkingLevel === "string"
    || value.type === "model_change"
    || value.type === "thinking_level_change"
    || value.type === "session_info"
    || isRecord(value.message)
  );
}

function looksLikePiTraceLog(entries: readonly unknown[]): boolean {
  if (entries.length === 0 || !entries.every((entry) => looksLikePiTraceEntry(entry))) {
    return false;
  }

  return entries.some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    if (
      typeof entry.parentId === "string"
      || entry.parentId === null
      || typeof entry.version === "number"
      || typeof entry.cwd === "string"
      || typeof entry.provider === "string"
      || typeof entry.modelId === "string"
      || typeof entry.thinkingLevel === "string"
    ) {
      return true;
    }

    if (
      entry.type === "model_change"
      || entry.type === "thinking_level_change"
      || entry.type === "session_info"
      || entry.type === "compaction"
      || entry.type === "branch_summary"
      || entry.type === "custom"
      || entry.type === "custom_message"
      || entry.type === "label"
    ) {
      return true;
    }

    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message) {
      return false;
    }

    return (
      typeof message.api === "string"
      || "details" in message
      || typeof message.errorMessage === "string"
      || typeof message.fullOutputPath === "string"
      || typeof message.customType === "string"
      || typeof message.summary === "string"
      || typeof message.fromId === "string"
      || typeof message.tokensBefore === "number"
    );
  });
}

function inferPiSourceDataset(filePath: string): string | undefined {
  const normalized = filePath.toLowerCase();
  if (normalized.includes("pi-mono")) {
    return "badlogicgames/pi-mono";
  }
  if (normalized.includes("pi-sessions")) {
    return "0xSero/pi-sessions";
  }
  return undefined;
}

function buildStableLocalRecordId(filePath: string): string {
  return createHash("sha1")
    .update(path.resolve(filePath))
    .digest("hex")
    .slice(0, 16);
}

function stripJsonBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export async function loadOpenAgentSessionsEventsFromJsonlFile(
  filePath: string,
): Promise<OpenAgentSessionsEvent[]> {
  const text = await readFile(filePath, "utf8");
  return parseOpenAgentSessionsJsonlText(text, buildStableLocalRecordId(filePath));
}
