import type { Stats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { AttentionSignal, SourceEvent } from "@tomismeta/aperture-core";

import { NOTIFICATION_CORE_TITLE, notificationCoreSummary } from "./adapter.js";

export const NOTIFICATION_WORKER_STATE_LIMITS = {
  maximumAgeMs: 24 * 60 * 60 * 1000,
  maximumRecords: 1_024,
  maximumBytes: 4 * 1024 * 1024,
} as const;

export type PersistedNotificationRevision = {
  occurredAt: string;
  displayTitle: string;
  sourceEvent: SourceEvent;
};

export type PersistedActiveNotification = {
  key: string;
  taskId: string;
  interactionId: string;
  revisions: PersistedNotificationRevision[];
};

export type NotificationWorkerPersistedState = {
  schemaVersion: 1;
  active: PersistedActiveNotification[];
  signals: AttentionSignal[];
};

export type NotificationWorkerStateLoad = {
  state: NotificationWorkerPersistedState;
  recoveredCorruptState: boolean;
};

const STATE_FILE_NAME = "state.json";

export function emptyNotificationWorkerState(): NotificationWorkerPersistedState {
  return { schemaVersion: 1, active: [], signals: [] };
}

export async function loadNotificationWorkerState(
  rootDir: string,
  now = Date.now(),
): Promise<NotificationWorkerStateLoad> {
  await ensurePrivateDirectory(rootDir);
  await removeStaleTemporaryFiles(rootDir);
  const statePath = path.join(rootDir, STATE_FILE_NAME);
  let stateFile: Stats;
  try {
    stateFile = await lstat(statePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { state: emptyNotificationWorkerState(), recoveredCorruptState: false };
    }
    throw error;
  }
  if (!stateFile.isFile() || stateFile.size > NOTIFICATION_WORKER_STATE_LIMITS.maximumBytes) {
    return recoverInvalidState(statePath);
  }
  await chmod(statePath, 0o600);
  let validated: NotificationWorkerPersistedState;
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath, "utf8"));
    validated = assertPersistedState(parsed);
  } catch {
    return recoverInvalidState(statePath);
  }
  const state = pruneNotificationWorkerState(validated, now);
  const wasPruned =
    notificationWorkerRecordCount(state) !== notificationWorkerRecordCount(validated);
  return {
    state: wasPruned ? await saveNotificationWorkerState(rootDir, state, now) : state,
    recoveredCorruptState: false,
  };
}

async function recoverInvalidState(statePath: string): Promise<NotificationWorkerStateLoad> {
  await rm(statePath, { force: true });
  return { state: emptyNotificationWorkerState(), recoveredCorruptState: true };
}

export async function saveNotificationWorkerState(
  rootDir: string,
  state: NotificationWorkerPersistedState,
  now = Date.now(),
): Promise<NotificationWorkerPersistedState> {
  await ensurePrivateDirectory(rootDir);
  const bounded = fitStateToBounds(pruneNotificationWorkerState(assertPersistedState(state), now));
  const targetPath = path.join(rootDir, STATE_FILE_NAME);
  const temporaryPath = path.join(rootDir, `.state-${randomUUID()}.tmp`);
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

export function pruneNotificationWorkerState(
  state: NotificationWorkerPersistedState,
  now = Date.now(),
): NotificationWorkerPersistedState {
  const cutoff = now - NOTIFICATION_WORKER_STATE_LIMITS.maximumAgeMs;
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
  const signals = state.signals
    .filter((signal) => Date.parse(signal.timestamp) >= cutoff)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  while (
    notificationWorkerRecordCount({ schemaVersion: 1, active, signals }) >
    NOTIFICATION_WORKER_STATE_LIMITS.maximumRecords
  ) {
    if (!removeOldest(active, signals)) break;
  }
  return { schemaVersion: 1, active, signals };
}

export function notificationWorkerRecordCount(state: NotificationWorkerPersistedState): number {
  return (
    state.active.reduce((total, entry) => total + entry.revisions.length, 0) + state.signals.length
  );
}

async function ensurePrivateDirectory(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  await chmod(rootDir, 0o700);
}

async function removeStaleTemporaryFiles(rootDir: string): Promise<void> {
  const entries = await readdir(rootDir);
  await Promise.all(
    entries
      .filter((entry) => /^\.state-[0-9a-f-]+\.tmp$/i.test(entry))
      .map((entry) => rm(path.join(rootDir, entry), { force: true })),
  );
}

function fitStateToBounds(
  state: NotificationWorkerPersistedState,
): NotificationWorkerPersistedState {
  const active = state.active.map((entry) => ({ ...entry, revisions: [...entry.revisions] }));
  const signals = [...state.signals];
  while (
    Buffer.byteLength(`${JSON.stringify({ schemaVersion: 1, active, signals })}\n`, "utf8") >
    NOTIFICATION_WORKER_STATE_LIMITS.maximumBytes
  ) {
    if (!removeOldest(active, signals)) {
      throw new Error("notification worker state cannot fit within the byte limit");
    }
  }
  return { schemaVersion: 1, active, signals };
}

function removeOldest(active: PersistedActiveNotification[], signals: AttentionSignal[]): boolean {
  let activeIndex = -1;
  let activeTimestamp: string | undefined;
  for (let index = 0; index < active.length; index += 1) {
    const timestamp = active[index]?.revisions[0]?.occurredAt;
    if (timestamp !== undefined && (activeTimestamp === undefined || timestamp < activeTimestamp)) {
      activeTimestamp = timestamp;
      activeIndex = index;
    }
  }
  const signalTimestamp = signals[0]?.timestamp;
  if (activeTimestamp === undefined && signalTimestamp === undefined) return false;
  if (
    signalTimestamp === undefined ||
    (activeTimestamp !== undefined && activeTimestamp <= signalTimestamp)
  ) {
    const revisions = active[activeIndex]?.revisions;
    revisions?.shift();
    if (revisions?.length === 0) active.splice(activeIndex, 1);
  } else {
    signals.shift();
  }
  return true;
}

function assertPersistedState(value: unknown): NotificationWorkerPersistedState {
  const record = asRecord(value, "notification worker state");
  assertExactKeys(record, ["schemaVersion", "active", "signals"], "notification worker state");
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.active) ||
    !Array.isArray(record.signals)
  ) {
    throw new Error("notification worker state schema is unsupported");
  }
  for (const entry of record.active) assertActiveNotification(entry);
  for (const signal of record.signals) assertFeedbackSignal(signal);
  return value as NotificationWorkerPersistedState;
}

function assertActiveNotification(value: unknown): void {
  const active = asRecord(value, "notification worker active entry");
  assertExactKeys(
    active,
    ["key", "taskId", "interactionId", "revisions"],
    "notification worker active entry",
  );
  const key = storedText(active.key, 160, "notification worker key");
  const taskId = storedText(active.taskId, 300, "notification worker task identity");
  const interactionId = storedText(
    active.interactionId,
    340,
    "notification worker interaction identity",
  );
  if (!Array.isArray(active.revisions) || active.revisions.length === 0) {
    throw new Error("notification worker revisions are invalid");
  }
  let previousTimestamp = "";
  for (const revision of active.revisions) {
    const timestamp = assertNotificationRevision(revision, key, taskId, interactionId);
    if (previousTimestamp && timestamp < previousTimestamp) {
      throw new Error("notification worker revisions are out of order");
    }
    previousTimestamp = timestamp;
  }
}

function assertNotificationRevision(
  value: unknown,
  key: string,
  taskId: string,
  interactionId: string,
): string {
  const revision = asRecord(value, "notification worker revision");
  assertExactKeys(
    revision,
    ["occurredAt", "displayTitle", "sourceEvent"],
    "notification worker revision",
  );
  const occurredAt = storedTimestamp(revision.occurredAt, "notification worker occurrence");
  storedText(revision.displayTitle, 200, "notification worker display title");
  const sourceEvent = asRecord(revision.sourceEvent, "notification worker source event");
  assertExactKeys(
    sourceEvent,
    [
      "id",
      "taskId",
      "timestamp",
      "type",
      "title",
      "summary",
      "status",
      "activityClass",
      "source",
      "metadata",
    ],
    "notification worker source event",
  );
  const source = asRecord(sourceEvent.source, "notification worker source");
  assertExactKeys(source, ["id", "kind", "label"], "notification worker source");
  const sourceId = storedText(source.id, 80, "notification worker source identity");
  storedText(source.kind, 80, "notification worker source kind");
  storedText(source.label, 120, "notification worker source label");
  const metadata = asRecord(sourceEvent.metadata, "notification worker source metadata");
  assertExactKeys(metadata, ["notificationUrgency"], "notification worker source metadata");
  if (
    metadata.notificationUrgency !== "low" &&
    metadata.notificationUrgency !== "normal" &&
    metadata.notificationUrgency !== "critical"
  ) {
    throw new Error("notification worker source urgency is invalid");
  }
  const keyHash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  const expectedTaskId = `desktop-notification:${sourceId}:${keyHash}`;
  if (
    taskId !== expectedTaskId ||
    interactionId !== `interaction:${expectedTaskId}:status` ||
    sourceEvent.taskId !== taskId ||
    sourceEvent.timestamp !== occurredAt ||
    sourceEvent.type !== "task.updated" ||
    sourceEvent.status !== "waiting" ||
    sourceEvent.activityClass !== "status_update" ||
    sourceEvent.title !== NOTIFICATION_CORE_TITLE ||
    sourceEvent.summary !== notificationCoreSummary(keyHash) ||
    typeof sourceEvent.id !== "string" ||
    !new RegExp(`^notification:${escapeRegularExpression(sourceId)}:${keyHash}:[a-f0-9]{16}$`).test(
      sourceEvent.id,
    )
  ) {
    throw new Error("notification worker source event is invalid");
  }
  storedText(sourceEvent.title, 200, "notification worker source title");
  return occurredAt;
}

function assertFeedbackSignal(value: unknown): void {
  const signal = asRecord(value, "notification worker signal");
  const isResponded = signal.kind === "responded";
  assertExactKeys(
    signal,
    isResponded
      ? ["kind", "taskId", "interactionId", "timestamp", "surface", "responseKind"]
      : ["kind", "taskId", "interactionId", "timestamp", "surface"],
    "notification worker signal",
  );
  if (signal.kind !== "timed_out" && signal.kind !== "dismissed" && !isResponded) {
    throw new Error("notification worker signal kind is invalid");
  }
  const taskId = storedText(signal.taskId, 300, "notification worker signal task identity");
  if (
    !/^desktop-notification:[^:]+:[a-f0-9]{24}$/.test(taskId) ||
    signal.interactionId !== `interaction:${taskId}:status` ||
    signal.surface !== "omarchy-notifications" ||
    (isResponded && signal.responseKind !== "acknowledged")
  ) {
    throw new Error("notification worker signal is invalid");
  }
  storedTimestamp(signal.timestamp, "notification worker signal timestamp");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} has invalid fields`);
  }
}

function storedText(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    Array.from(value).length > maximum
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function storedTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}
