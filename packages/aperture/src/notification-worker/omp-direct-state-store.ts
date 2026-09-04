import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { SourceEvent } from "@tomismeta/aperture-core";

import { assertOmpDirectState, decodeOmpDirectState } from "./omp-direct-state-validation.js";
export { migrateOmpDirectStateV1, migrateOmpDirectStateV2 } from "./omp-direct-state-validation.js";

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
export type PersistedOmpDirectTombstone =
  | {
      kind: "interaction";
      key: string;
      eventId: string;
      occurredAt: string;
    }
  | {
      kind: "session";
      sessionId: string;
      eventId: string;
      occurredAt: string;
    };

export type OmpDirectPersistedState = {
  schemaVersion: 3;
  active: PersistedOmpDirectEntry[];
  tombstones: PersistedOmpDirectTombstone[];
};

export type OmpDirectStateLoad = {
  state: OmpDirectPersistedState;
  recoveredCorruptState: boolean;
};

export function emptyOmpDirectState(): OmpDirectPersistedState {
  return { schemaVersion: 3, active: [], tombstones: [] };
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
    const decoded = decodeOmpDirectState(parsed);
    const validated = decoded.state;
    const bounded = fitStateToBounds(pruneOmpDirectState(validated, now));
    if (decoded.migrated || JSON.stringify(bounded) !== JSON.stringify(validated)) {
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
  signal?: AbortSignal,
): Promise<OmpDirectPersistedState> {
  signal?.throwIfAborted();
  await ensurePrivateDirectory(rootDir);
  signal?.throwIfAborted();
  const bounded = fitStateToBounds(pruneOmpDirectState(assertOmpDirectState(state), now));
  const targetPath = path.join(rootDir, STATE_FILE_NAME);
  const temporaryPath = path.join(rootDir, `.omp-direct-state-${randomUUID()}.tmp`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(bounded)}\n`, {
        encoding: "utf8",
        signal,
      });
      signal?.throwIfAborted();
      await file.sync();
      signal?.throwIfAborted();
    } finally {
      await file.close();
    }
    signal?.throwIfAborted();
    renameSync(temporaryPath, targetPath);
    return bounded;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export function ompDirectRecordCount(state: OmpDirectPersistedState): number {
  return (
    state.tombstones.length +
    state.active.reduce((total, entry) => total + entry.revisions.length, 0)
  );
}

export function pruneOmpDirectState(
  state: OmpDirectPersistedState,
  now = Date.now(),
): OmpDirectPersistedState {
  const cutoff = now - MAXIMUM_AGE_MS;
  const active = state.active
    .map((entry) => ({
      ...entry,
      revisions: entry.revisions.filter((revision) => Date.parse(revision.occurredAt) >= cutoff),
    }))
    .filter((entry) => entry.revisions.length > 0);
  const tombstones = state.tombstones.filter(
    (tombstone) => Date.parse(tombstone.occurredAt) >= cutoff,
  );
  while (recordCount(active, tombstones) > MAXIMUM_RECORDS) {
    removeOldest(active, tombstones);
  }
  return { schemaVersion: 3, active, tombstones };
}

function fitStateToBounds(state: OmpDirectPersistedState): OmpDirectPersistedState {
  const active = state.active.map((entry) => ({ ...entry, revisions: [...entry.revisions] }));
  const tombstones = state.tombstones.map((tombstone) => ({ ...tombstone }));
  while (
    Buffer.byteLength(`${JSON.stringify({ schemaVersion: 3, active, tombstones })}\n`, "utf8") >
    MAXIMUM_BYTES
  ) {
    if (!removeOldest(active, tombstones)) {
      throw new Error("OMP direct state cannot fit within the byte limit");
    }
  }
  return { schemaVersion: 3, active, tombstones };
}

function recordCount(
  active: PersistedOmpDirectEntry[],
  tombstones: PersistedOmpDirectTombstone[],
): number {
  return tombstones.length + active.reduce((total, entry) => total + entry.revisions.length, 0);
}

function removeOldest(
  active: PersistedOmpDirectEntry[],
  tombstones: PersistedOmpDirectTombstone[],
): boolean {
  let oldestActiveIndex = -1;
  let oldestTimestamp: string | undefined;
  for (let index = 0; index < active.length; index += 1) {
    const timestamp = active[index]?.revisions[0]?.occurredAt;
    if (timestamp !== undefined && (oldestTimestamp === undefined || timestamp < oldestTimestamp)) {
      oldestTimestamp = timestamp;
      oldestActiveIndex = index;
    }
  }
  let oldestTombstoneIndex = -1;
  for (let index = 0; index < tombstones.length; index += 1) {
    const timestamp = tombstones[index]!.occurredAt;
    if (oldestTimestamp === undefined || timestamp < oldestTimestamp) {
      oldestTimestamp = timestamp;
      oldestActiveIndex = -1;
      oldestTombstoneIndex = index;
    }
  }
  if (oldestTombstoneIndex !== -1) {
    tombstones.splice(oldestTombstoneIndex, 1);
    return true;
  }
  if (oldestActiveIndex === -1) return false;
  const revisions = active[oldestActiveIndex]!.revisions;
  revisions.shift();
  if (revisions.length === 0) active.splice(oldestActiveIndex, 1);
  return true;
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

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
