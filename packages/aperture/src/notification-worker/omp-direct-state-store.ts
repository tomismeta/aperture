import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { type SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";

import { assertOmpAttentionDisplayText, assertOmpSessionId } from "../omp-attention-event.js";

const STATE_FILE_NAME = "omp-direct-state.json";
const MAXIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_RECORDS = 1_024;
const MAXIMUM_BYTES = 4 * 1024 * 1024;

export type PersistedOmpDirectRevision = {
  occurredAt: string;
  displayTitle: string;
  sourceEvent: SourceEvent;
};

export type PersistedOmpDirectEntry = {
  key: string;
  taskId: string;
  interactionId: string;
  sessionId: string;
  revisions: PersistedOmpDirectRevision[];
};

export type OmpDirectPersistedState = {
  schemaVersion: 2;
  active: PersistedOmpDirectEntry[];
};

export type OmpDirectStateLoad = {
  state: OmpDirectPersistedState;
  recoveredCorruptState: boolean;
};

export function emptyOmpDirectState(): OmpDirectPersistedState {
  return { schemaVersion: 2, active: [] };
}

export async function loadOmpDirectState(
  rootDir: string,
  now = Date.now(),
): Promise<OmpDirectStateLoad> {
  await ensurePrivateDirectory(rootDir);
  await removeStaleTemporaryFiles(rootDir);
  const statePath = path.join(rootDir, STATE_FILE_NAME);
  try {
    const metadata = await lstat(statePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_BYTES) {
      return recoverInvalidState(statePath);
    }
    await chmod(statePath, 0o600);
    const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
    const validated = assertOmpDirectState(parsed);
    const bounded = fitStateToBounds(pruneOmpDirectState(validated, now));
    if (JSON.stringify(bounded) !== JSON.stringify(validated)) {
      return {
        state: await saveOmpDirectState(rootDir, bounded, now),
        recoveredCorruptState: false,
      };
    }
    return { state: bounded, recoveredCorruptState: false };
  } catch (error) {
    if (isMissing(error)) return { state: emptyOmpDirectState(), recoveredCorruptState: false };
    return recoverInvalidState(statePath);
  }
}

export async function saveOmpDirectState(
  rootDir: string,
  state: OmpDirectPersistedState,
  now = Date.now(),
): Promise<OmpDirectPersistedState> {
  await ensurePrivateDirectory(rootDir);
  const bounded = fitStateToBounds(pruneOmpDirectState(assertOmpDirectState(state), now));
  const targetPath = path.join(rootDir, STATE_FILE_NAME);
  const temporaryPath = path.join(rootDir, `.omp-direct-state-${randomUUID()}.tmp`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(bounded)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
    return bounded;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export function ompDirectRecordCount(state: OmpDirectPersistedState): number {
  return state.active.reduce((total, entry) => total + entry.revisions.length, 0);
}

export function pruneOmpDirectState(
  state: OmpDirectPersistedState,
  now = Date.now(),
): OmpDirectPersistedState {
  const cutoff = now - MAXIMUM_AGE_MS;
  const active = state.active
    .map((entry) => ({
      ...entry,
      revisions: entry.revisions
        .filter((revision) => Date.parse(revision.occurredAt) >= cutoff)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    }))
    .filter((entry) => entry.revisions.length > 0)
    .sort((left, right) =>
      left.revisions[0]!.occurredAt.localeCompare(right.revisions[0]!.occurredAt),
    );
  while (active.reduce((total, entry) => total + entry.revisions.length, 0) > MAXIMUM_RECORDS) {
    removeOldest(active);
  }
  return { schemaVersion: 2, active };
}

function fitStateToBounds(state: OmpDirectPersistedState): OmpDirectPersistedState {
  const active = state.active.map((entry) => ({ ...entry, revisions: [...entry.revisions] }));
  while (
    Buffer.byteLength(`${JSON.stringify({ schemaVersion: 2, active })}\n`, "utf8") > MAXIMUM_BYTES
  ) {
    if (!removeOldest(active)) throw new Error("OMP direct state cannot fit within the byte limit");
  }
  return { schemaVersion: 2, active };
}

function removeOldest(active: PersistedOmpDirectEntry[]): boolean {
  let oldestIndex = -1;
  let oldestTimestamp: string | undefined;
  for (let index = 0; index < active.length; index += 1) {
    const timestamp = active[index]?.revisions[0]?.occurredAt;
    if (timestamp !== undefined && (oldestTimestamp === undefined || timestamp < oldestTimestamp)) {
      oldestTimestamp = timestamp;
      oldestIndex = index;
    }
  }
  if (oldestIndex === -1) return false;
  const revisions = active[oldestIndex]!.revisions;
  revisions.shift();
  if (revisions.length === 0) active.splice(oldestIndex, 1);
  return true;
}

function assertOmpDirectState(value: unknown): OmpDirectPersistedState {
  const state = asRecord(value, "OMP direct state");
  assertExactKeys(state, ["schemaVersion", "active"], "OMP direct state");
  if (state.schemaVersion !== 2 || !Array.isArray(state.active)) {
    throw new Error("OMP direct state schema is unsupported");
  }
  for (const entry of state.active) assertOmpDirectEntry(entry);
  return value as OmpDirectPersistedState;
}

function assertOmpDirectEntry(value: unknown): void {
  const entry = asRecord(value, "OMP direct active entry");
  assertExactKeys(
    entry,
    ["key", "taskId", "interactionId", "sessionId", "revisions"],
    "OMP direct active entry",
  );
  storedText(entry.key, 160, "OMP direct key");
  const taskId = storedText(entry.taskId, 160, "OMP direct taskId");
  const interactionId = storedText(entry.interactionId, 160, "OMP direct interactionId");
  const sessionId = assertOmpSessionId(entry.sessionId);
  if (!Array.isArray(entry.revisions) || entry.revisions.length === 0) {
    throw new Error("OMP direct revisions are invalid");
  }
  let previousTimestamp = "";
  for (const revision of entry.revisions) {
    const timestamp = assertOmpDirectRevision(revision, taskId, interactionId, sessionId);
    if (previousTimestamp && timestamp < previousTimestamp) {
      throw new Error("OMP direct revisions are out of order");
    }
    previousTimestamp = timestamp;
  }
}

function assertOmpDirectRevision(
  value: unknown,
  taskId: string,
  interactionId: string,
  sessionId: string,
): string {
  const revision = asRecord(value, "OMP direct revision");
  assertExactKeys(revision, ["occurredAt", "displayTitle", "sourceEvent"], "OMP direct revision");
  const occurredAt = storedTimestamp(revision.occurredAt, "OMP direct occurrence");
  assertOmpAttentionDisplayText(revision.displayTitle, 160, "persisted display title");
  const sourceEventRecord = asRecord(revision.sourceEvent, "OMP direct source event");
  assertDirectSourceEventFields(sourceEventRecord);
  const sourceEvent = revision.sourceEvent as SourceEvent;
  assertValidSourceEvent(sourceEvent);
  if (sourceEvent.taskId !== taskId || sourceEvent.timestamp !== occurredAt) {
    throw new Error("OMP direct source event identity is invalid");
  }
  if (sourceEvent.type === "human.input.requested" && sourceEvent.interactionId !== interactionId) {
    throw new Error("OMP direct interaction identity is invalid");
  }
  const source = asRecord(sourceEvent.source, "OMP direct source");
  assertExactKeys(source, ["id", "kind", "label"], "OMP direct source");
  if (source.kind !== "omp" || source.label !== "OMP") {
    throw new Error("OMP direct source is invalid");
  }
  const metadata = asRecord(sourceEvent.metadata, "OMP direct metadata");
  assertExactKeys(metadata, ["ompDirect"], "OMP direct metadata");
  const direct = asRecord(metadata.ompDirect, "OMP direct metadata facts");
  assertExactKeys(direct, ["classification", "sessionId"], "OMP direct metadata facts");
  if (direct.sessionId !== sessionId || typeof direct.classification !== "string") {
    throw new Error("OMP direct metadata identity is invalid");
  }
  if ("title" in sourceEvent) {
    assertOmpAttentionDisplayText(sourceEvent.title, 160, "persisted event title");
  }
  if ("summary" in sourceEvent && sourceEvent.summary !== undefined) {
    assertOmpAttentionDisplayText(sourceEvent.summary, 320, "persisted event summary");
  }
  return occurredAt;
}

function assertDirectSourceEventFields(event: Record<string, unknown>): void {
  switch (event.type) {
    case "human.input.requested":
      assertExactKeys(
        event,
        [
          "id",
          "taskId",
          "timestamp",
          "source",
          "metadata",
          "type",
          "interactionId",
          "activityClass",
          "title",
          "summary",
          "request",
          "riskHint",
        ],
        "OMP direct human input event",
      );
      return;
    case "task.updated":
      assertExactKeys(
        event,
        [
          "id",
          "taskId",
          "timestamp",
          "source",
          "metadata",
          "type",
          "title",
          "summary",
          "status",
          "activityClass",
          "semanticHints",
        ],
        "OMP direct task update",
      );
      return;
    case "task.completed":
      assertExactKeys(
        event,
        ["id", "taskId", "timestamp", "source", "metadata", "type", "summary"],
        "OMP direct task completion",
      );
      return;
    default:
      throw new Error("OMP direct source event type is invalid");
  }
}

async function recoverInvalidState(statePath: string): Promise<OmpDirectStateLoad> {
  await rm(statePath, { force: true });
  return { state: emptyOmpDirectState(), recoveredCorruptState: true };
}

async function ensurePrivateDirectory(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  await chmod(rootDir, 0o700);
}

async function removeStaleTemporaryFiles(rootDir: string): Promise<void> {
  const entries = await readdir(rootDir);
  await Promise.all(
    entries
      .filter((entry) => /^\.omp-direct-state-[0-9a-f-]+\.tmp$/i.test(entry))
      .map((entry) => rm(path.join(rootDir, entry), { force: true })),
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are invalid`);
  }
}

function storedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  if (Array.from(value).length > maximum) throw new Error(`${label} exceeded its limit`);
  return value;
}

function storedTimestamp(value: unknown, label: string): string {
  const timestamp = storedText(value, 64, label);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${label} is invalid`);
  return timestamp;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
