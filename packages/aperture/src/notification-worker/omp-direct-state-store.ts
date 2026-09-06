import { randomUUID } from "node:crypto";
import { renameSync, type Stats } from "node:fs";
import { lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { SourceEvent } from "@tomismeta/aperture-core";

import { DirectAttentionPrecommitError } from "./direct-message-execution.js";
import { assertOmpDirectState } from "./omp-direct-state-validation.js";
import type { ProjectedOmpSessionPresentation } from "./omp-session-presentation.js";
import {
  assertOwnedStateRoot,
  assertPrivateOwnedFile,
  prepareOwnedStateRoot,
  sameStateIdentity,
  type OwnedStateRoot,
} from "./owned-state-path.js";

const STATE_FILE_NAME = "omp-direct-state.json";
const MAXIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_RECORDS = 1_024;
const MAXIMUM_BYTES = 4 * 1024 * 1024;

export type PersistedOmpDirectRevision = {
  occurredAt: string;
  displayTitle: string;
  presentation: ProjectedOmpSessionPresentation;
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
  active: PersistedOmpDirectEntry[];
  tombstones: PersistedOmpDirectTombstone[];
};

export type OmpDirectStateLoad = {
  state: OmpDirectPersistedState;
  recoveredCorruptState: boolean;
};

export function emptyOmpDirectState(): OmpDirectPersistedState {
  return { active: [], tombstones: [] };
}

export async function loadOmpDirectState(
  rootDir: string,
  now = Date.now(),
): Promise<OmpDirectStateLoad> {
  const root = await prepareOwnedStateRoot(rootDir);
  await removeStaleTemporaryFiles(rootDir, root);
  const statePath = path.join(rootDir, STATE_FILE_NAME);
  let identity: Stats;
  try {
    identity = await lstat(statePath);
  } catch (error) {
    if (isMissing(error)) return { state: emptyOmpDirectState(), recoveredCorruptState: false };
    throw error;
  }
  assertPrivateOwnedFile(identity, root.uid);
  if (identity.size > MAXIMUM_BYTES) return recoverInvalidState(statePath, root, identity);
  const raw = await readFile(statePath, "utf8");
  const after = await lstat(statePath);
  assertPrivateOwnedFile(after, root.uid);
  if (!sameStateIdentity(identity, after)) {
    throw new Error("Aperture worker state file changed while reading");
  }
  await assertOwnedStateRoot(root);
  let validated: OmpDirectPersistedState;
  let bounded: OmpDirectPersistedState;
  try {
    validated = assertOmpDirectState(JSON.parse(raw));
    bounded = fitStateToBounds(pruneOmpDirectState(validated, now));
  } catch {
    return recoverInvalidState(statePath, root, identity);
  }
  if (JSON.stringify(bounded) !== JSON.stringify(validated)) {
    return {
      state: await saveOmpDirectState(rootDir, bounded, now),
      recoveredCorruptState: false,
    };
  }
  return { state: bounded, recoveredCorruptState: false };
}

export async function saveOmpDirectState(
  rootDir: string,
  state: OmpDirectPersistedState,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<OmpDirectPersistedState> {
  let root: OwnedStateRoot | undefined;
  let temporaryPath: string | undefined;
  let installationAttempted = false;
  try {
    signal?.throwIfAborted();
    root = await prepareOwnedStateRoot(rootDir);
    signal?.throwIfAborted();
    const bounded = fitStateToBounds(pruneOmpDirectState(assertOmpDirectState(state), now));
    const targetPath = path.join(rootDir, STATE_FILE_NAME);
    const previous = await existingPrivateFile(targetPath, root.uid);
    temporaryPath = path.join(rootDir, `.omp-direct-state-${randomUUID()}.tmp`);
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
    const created = await lstat(temporaryPath);
    assertPrivateOwnedFile(created, root.uid);
    await assertOwnedStateRoot(root);
    await assertTargetUnchanged(targetPath, previous, root.uid);
    installationAttempted = true;
    renameSync(temporaryPath, targetPath);
    const installed = await lstat(targetPath);
    assertPrivateOwnedFile(installed, root.uid);
    if (!sameStateIdentity(created, installed)) {
      throw new Error("Aperture worker state file changed while installing");
    }
    await assertOwnedStateRoot(root);
    return bounded;
  } catch (error) {
    if (temporaryPath && root) {
      await unlinkPrivateTemporaryFile(temporaryPath, root).catch(() => undefined);
    }
    if (!installationAttempted && !signal?.aborted && isTransientStateWriteError(error)) {
      throw new DirectAttentionPrecommitError(error);
    }
    throw error;
  }
}

function isTransientStateWriteError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  switch (error.code) {
    case "EAGAIN":
    case "EBUSY":
    case "EDQUOT":
    case "EIO":
    case "EMFILE":
    case "ENFILE":
    case "ENOSPC":
      return true;
    default:
      return false;
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
  while (recordCount(active, tombstones) > MAXIMUM_RECORDS) removeOldest(active, tombstones);
  return { active, tombstones };
}

function fitStateToBounds(state: OmpDirectPersistedState): OmpDirectPersistedState {
  const active = state.active.map((entry) => ({ ...entry, revisions: [...entry.revisions] }));
  const tombstones = state.tombstones.map((tombstone) => ({ ...tombstone }));
  while (Buffer.byteLength(`${JSON.stringify({ active, tombstones })}\n`, "utf8") > MAXIMUM_BYTES) {
    if (!removeOldest(active, tombstones)) {
      throw new Error("OMP direct state cannot fit within the byte limit");
    }
  }
  return { active, tombstones };
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

async function recoverInvalidState(
  statePath: string,
  root: OwnedStateRoot,
  identity: Stats,
): Promise<OmpDirectStateLoad> {
  await assertOwnedStateRoot(root);
  const current = await lstat(statePath);
  assertPrivateOwnedFile(current, root.uid);
  if (!sameStateIdentity(current, identity)) {
    throw new Error("Aperture worker state file changed before recovery");
  }
  await unlink(statePath);
  return { state: emptyOmpDirectState(), recoveredCorruptState: true };
}

async function removeStaleTemporaryFiles(rootDir: string, root: OwnedStateRoot): Promise<void> {
  for (const entry of await readdir(rootDir)) {
    if (!/^\.omp-direct-state-[0-9a-f-]+\.tmp$/i.test(entry)) continue;
    await unlinkPrivateTemporaryFile(path.join(rootDir, entry), root);
  }
}

async function unlinkPrivateTemporaryFile(
  temporaryPath: string,
  root: OwnedStateRoot,
): Promise<void> {
  let identity: Stats;
  try {
    identity = await lstat(temporaryPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  assertPrivateOwnedFile(identity, root.uid);
  await assertOwnedStateRoot(root);
  const current = await lstat(temporaryPath);
  assertPrivateOwnedFile(current, root.uid);
  if (!sameStateIdentity(identity, current)) {
    throw new Error("Aperture worker temporary state changed before cleanup");
  }
  await unlink(temporaryPath);
}

async function existingPrivateFile(filePath: string, uid: number): Promise<Stats | undefined> {
  try {
    const metadata = await lstat(filePath);
    assertPrivateOwnedFile(metadata, uid);
    return metadata;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function assertTargetUnchanged(
  targetPath: string,
  previous: Stats | undefined,
  uid: number,
): Promise<void> {
  const current = await existingPrivateFile(targetPath, uid);
  if (previous === undefined && current === undefined) return;
  if (previous && current && sameStateIdentity(previous, current)) return;
  throw new Error("Aperture worker state file changed before replacement");
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
