import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

import type { AttentionResponse } from "@tomismeta/aperture-core";

import type {
  ApertureRuntimeWorkResponseHealthSnapshot,
  RuntimeWorkResponseRecord,
  WorkResponseState,
} from "./runtime-contract.js";

type WorkResponseStoreOptions = {
  stateDir: string;
  maxEntries: number;
  pendingTtlMs: number;
  retentionMs: number;
  timeSource?: () => number;
};

const WORK_RESPONSE_STORE_SCHEMA_VERSION = 1 as const;

type PersistedWorkResponseStore = {
  schemaVersion: typeof WORK_RESPONSE_STORE_SCHEMA_VERSION;
  records: RuntimeWorkResponseRecord[];
};

export class WorkResponseStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly pendingTtlMs: number;
  private readonly retentionMs: number;
  private readonly timeSource: () => number;
  private readonly records = new Map<string, RuntimeWorkResponseRecord>();
  private persistChain: Promise<void> = Promise.resolve();
  private persistError: Error | null = null;
  private lastPersistedAt: string | null = null;
  private lastPersistenceErrorAt: string | null = null;

  private constructor(options: WorkResponseStoreOptions) {
    this.filePath = resolve(options.stateDir, "work-responses.json");
    this.maxEntries = options.maxEntries;
    this.pendingTtlMs = options.pendingTtlMs;
    this.retentionMs = options.retentionMs;
    this.timeSource = options.timeSource ?? Date.now;
  }

  static async open(options: WorkResponseStoreOptions): Promise<WorkResponseStore> {
    const store = new WorkResponseStore(options);
    await mkdir(options.stateDir, { recursive: true });
    await store.load();
    store.prune();
    await store.flush();
    return store;
  }

  get capacity(): number {
    return this.maxEntries;
  }

  get pendingTtl(): number {
    return this.pendingTtlMs;
  }

  get retention(): number {
    return this.retentionMs;
  }

  registerPending(
    taskId: string,
    interactionId: string,
    nowIso = this.nowIso(),
  ): RuntimeWorkResponseRecord {
    const current = this.records.get(interactionId);
    const record: RuntimeWorkResponseRecord = {
      taskId,
      interactionId,
      state: "pending",
      createdAt: current?.createdAt ?? nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(Date.parse(nowIso) + this.pendingTtlMs).toISOString(),
      ...(current?.retentionExpiresAt !== undefined
        ? { retentionExpiresAt: current.retentionExpiresAt }
        : {}),
    };
    this.records.set(interactionId, record);
    this.prune();
    this.persist();
    return record;
  }

  recordAnswered(
    response: AttentionResponse,
    nowIso = this.nowIso(),
  ): RuntimeWorkResponseRecord | null {
    const current = this.records.get(response.interactionId);
    if (!current) {
      return null;
    }
    const record: RuntimeWorkResponseRecord = {
      taskId: response.taskId,
      interactionId: response.interactionId,
      state: "answered",
      createdAt: current.createdAt,
      updatedAt: nowIso,
      response: response.response,
      answeredAt: nowIso,
      retentionExpiresAt: new Date(Date.parse(nowIso) + this.retentionMs).toISOString(),
    };
    this.records.set(response.interactionId, record);
    this.prune();
    this.persist();
    return record;
  }

  cancel(interactionId: string, nowIso = this.nowIso()): RuntimeWorkResponseRecord | null {
    const current = this.records.get(interactionId);
    if (!current) {
      return null;
    }
    if (current.state === "answered") {
      return current;
    }
    const record: RuntimeWorkResponseRecord = {
      ...current,
      state: "cancelled",
      updatedAt: nowIso,
      cancelledAt: nowIso,
      retentionExpiresAt: new Date(Date.parse(nowIso) + this.retentionMs).toISOString(),
    };
    delete record.expiresAt;
    this.records.set(interactionId, record);
    this.prune();
    this.persist();
    return record;
  }

  get(interactionId: string): RuntimeWorkResponseRecord | null {
    this.prune();
    return this.records.get(interactionId) ?? null;
  }

  list(): RuntimeWorkResponseRecord[] {
    this.prune();
    return [...this.records.values()].sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    );
  }

  stats(): ApertureRuntimeWorkResponseHealthSnapshot {
    this.prune();
    const counts: Record<WorkResponseState, number> = {
      pending: 0,
      answered: 0,
      expired: 0,
      cancelled: 0,
    };

    for (const record of this.records.values()) {
      counts[record.state] += 1;
    }

    return {
      total: this.records.size,
      counts,
      capacity: this.maxEntries,
      pendingTtlMs: this.pendingTtlMs,
      retentionMs: this.retentionMs,
      persistenceOk: this.persistError === null,
      lastPersistedAt: this.lastPersistedAt,
      lastPersistenceError: this.persistError?.message ?? null,
      lastPersistenceErrorAt: this.lastPersistenceErrorAt,
    };
  }

  prune(nowIso = this.nowIso()): void {
    const nowMs = Date.parse(nowIso);

    for (const [interactionId, record] of this.records.entries()) {
      if (record.state === "pending" && record.expiresAt) {
        const expiresAtMs = Date.parse(record.expiresAt);
        if (!Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs) {
          this.records.set(interactionId, {
            ...record,
            state: "expired",
            updatedAt: nowIso,
            retentionExpiresAt: new Date(nowMs + this.retentionMs).toISOString(),
          });
        }
      }
    }

    for (const [interactionId, record] of this.records.entries()) {
      if (!record.retentionExpiresAt) {
        continue;
      }
      const retentionMs = Date.parse(record.retentionExpiresAt);
      if (!Number.isNaN(retentionMs) && retentionMs <= nowMs) {
        this.records.delete(interactionId);
      }
    }

    if (this.records.size <= this.maxEntries) {
      return;
    }

    const overflow = this.records.size - this.maxEntries;
    const oldest = [...this.records.values()]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, overflow);

    for (const record of oldest) {
      this.records.delete(record.interactionId);
    }
  }

  async flush(): Promise<void> {
    await this.persistChain;
    if (this.persistError) {
      throw this.persistError;
    }
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return;
      }
      throw error;
    }

    let parsed: PersistedWorkResponseStore;
    try {
      parsed = JSON.parse(raw) as PersistedWorkResponseStore;
    } catch (error) {
      throw new Error(
        `Unable to read persisted work-response state in ${this.filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      parsed.schemaVersion !== WORK_RESPONSE_STORE_SCHEMA_VERSION ||
      !Array.isArray(parsed.records)
    ) {
      throw new Error(
        `Unsupported persisted work-response state in ${this.filePath}. Expected schemaVersion ${WORK_RESPONSE_STORE_SCHEMA_VERSION}.`,
      );
    }
    const loadedRecords = new Map<string, RuntimeWorkResponseRecord>();
    for (const record of parsed.records) {
      if (!isPersistedWorkResponseRecord(record) || loadedRecords.has(record.interactionId)) {
        throw new Error(`Invalid persisted work-response record in ${this.filePath}.`);
      }
      loadedRecords.set(record.interactionId, record);
    }
    this.records.clear();
    for (const record of loadedRecords.values()) {
      this.records.set(record.interactionId, record);
    }
  }

  private persist(): void {
    const payload: PersistedWorkResponseStore = {
      schemaVersion: WORK_RESPONSE_STORE_SCHEMA_VERSION,
      records: this.list(),
    };
    this.persistChain = this.persistChain.then(async () => {
      try {
        await writeJsonFileAtomically(this.filePath, payload);
        this.persistError = null;
        this.lastPersistedAt = this.nowIso();
        this.lastPersistenceErrorAt = null;
      } catch (error) {
        this.persistError = toError(error);
        this.lastPersistenceErrorAt = this.nowIso();
        warnStorePersistenceIssue(
          this.filePath,
          "Failed to persist work-response state.",
          this.persistError,
        );
      }
    });
  }

  private nowIso(): string {
    return new Date(this.timeSource()).toISOString();
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isWorkResponseState(value: unknown): value is WorkResponseState {
  return (
    value === "pending" || value === "answered" || value === "expired" || value === "cancelled"
  );
}

function isPersistedWorkResponseRecord(value: unknown): value is RuntimeWorkResponseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    !isWorkResponseState(record.state) ||
    !isNonEmptyString(record.interactionId) ||
    !isNonEmptyString(record.taskId) ||
    !isIsoDate(record.createdAt) ||
    !isIsoDate(record.updatedAt)
  ) {
    return false;
  }

  for (const key of ["answeredAt", "expiresAt", "cancelledAt", "retentionExpiresAt"] as const) {
    if (record[key] !== undefined && !isIsoDate(record[key])) return false;
  }

  if (record.state === "pending" && !isIsoDate(record.expiresAt)) return false;
  if (
    (record.state === "answered" || record.state === "expired" || record.state === "cancelled") &&
    !isIsoDate(record.retentionExpiresAt)
  ) {
    return false;
  }
  if (record.state === "answered" && !isIsoDate(record.answeredAt)) return false;
  if (record.state === "cancelled" && !isIsoDate(record.cancelledAt)) return false;
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

async function writeJsonFileAtomically(
  path: string,
  payload: PersistedWorkResponseStore,
): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function warnStorePersistenceIssue(path: string, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[aperture] ${message} (${path}) ${detail}`);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
