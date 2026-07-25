import { readFile } from "node:fs/promises";

import {
  writeTextAtomic,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";
import { serializePublicCorpusLedgerEntries } from "./public-corpus-ledger-format.js";
import {
  computePublicCorpusLedgerIntegrity,
  verifyPublicCorpusLedgerIntegrity,
  type PublicCorpusLedgerIntegrityMode,
} from "./public-corpus-ledger-integrity.js";

export type PublicCorpusLedgerSnapshot = {
  records: PublicCorpusRecordLedgerEntry[];
  errors: PublicCorpusRecordLedgerEntry[];
  successByKey: Map<string, PublicCorpusRecordLedgerEntry>;
  digestByOffset: Map<number, `sha256:${string}`>;
};

export async function reconcilePublicCorpusLedger(
  manifest: PublicCorpusRunManifest,
  options: { integrityMode?: PublicCorpusLedgerIntegrityMode } = {},
): Promise<PublicCorpusLedgerSnapshot> {
  const records = await readPublicCorpusRecordLedger(manifest.artifacts.recordsPath, {
    repairPartialTail: true,
  });
  const errors = await readPublicCorpusRecordLedger(manifest.artifacts.errorsPath, {
    repairPartialTail: true,
  });
  const snapshot = createPublicCorpusLedgerSnapshot(records.entries, errors.entries);

  if (records.repaired || records.deduped || errors.repaired || errors.deduped) {
    await writeLedger(manifest.artifacts.recordsPath, snapshot.records);
    await writeLedger(manifest.artifacts.errorsPath, snapshot.errors);
  }

  const integrityMode = options.integrityMode ?? "strict";
  verifyPublicCorpusLedgerIntegrity({
    snapshot,
    integrityMode,
    manifest,
  });

  applyLedgerProgress(manifest, snapshot);
  return snapshot;
}

export async function updatePublicCorpusLedgerIntegrity(
  manifest: PublicCorpusRunManifest,
): Promise<void> {
  const records = await readPublicCorpusRecordLedger(manifest.artifacts.recordsPath);
  const errors = await readPublicCorpusRecordLedger(manifest.artifacts.errorsPath);
  manifest.integrity = {
    ...manifest.integrity,
    ...computePublicCorpusLedgerIntegrity({
      records: records.entries,
      errors: errors.entries,
    }),
  };
}

export function publicCorpusRecordKey(offset: number, rowDigest: `sha256:${string}`): string {
  return `${offset}:${rowDigest}`;
}

export function isPublicCorpusRecordAlreadyRecorded(
  snapshot: PublicCorpusLedgerSnapshot,
  offset: number,
  rowDigest: `sha256:${string}`,
): boolean {
  return snapshot.successByKey.has(publicCorpusRecordKey(offset, rowDigest));
}

export function assertPublicCorpusOffsetDigest(
  snapshot: PublicCorpusLedgerSnapshot,
  offset: number,
  rowDigest: `sha256:${string}`,
): void {
  const recordedDigest = snapshot.digestByOffset.get(offset);
  if (recordedDigest && recordedDigest !== rowDigest) {
    throw new Error(`Public corpus row digest drift at offset ${offset}.`);
  }
}

export function recordPublicCorpusLedgerSuccess(
  snapshot: PublicCorpusLedgerSnapshot,
  record: PublicCorpusRecordLedgerEntry,
): void {
  snapshot.records.push(record);
  snapshot.successByKey.set(publicCorpusRecordKey(record.offset, record.rowDigest), record);
  recordDigestByOffset(snapshot, record);
}

export function recordPublicCorpusLedgerError(
  snapshot: PublicCorpusLedgerSnapshot,
  record: PublicCorpusRecordLedgerEntry,
): void {
  snapshot.errors.push(record);
  recordDigestByOffset(snapshot, record);
}

export async function readPublicCorpusRecordLedger(
  filePath: string,
  options: {
    repairPartialTail?: boolean;
  } = {},
): Promise<{
  entries: PublicCorpusRecordLedgerEntry[];
  repaired: boolean;
  deduped: boolean;
}> {
  const text = await readTextIfPresent(filePath);
  if (!text) {
    return { entries: [], repaired: false, deduped: false };
  }

  const rawLines = text.split("\n");
  const lastNonEmptyIndex = findLastNonEmptyLineIndex(rawLines);
  const entries: PublicCorpusRecordLedgerEntry[] = [];
  let repaired = false;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isPublicCorpusRecordLedgerEntry(parsed)) {
        throw new Error("invalid ledger entry shape");
      }
      entries.push(parsed);
    } catch (error) {
      if (options.repairPartialTail && index === lastNonEmptyIndex) {
        repaired = true;
        break;
      }
      throw new Error(
        `Invalid public corpus ledger entry in ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const dedupedEntries = dedupeLedgerEntries(entries);
  const deduped = dedupedEntries.length !== entries.length;
  if (repaired || deduped) {
    await writeLedger(filePath, dedupedEntries);
  }
  return { entries: dedupedEntries, repaired, deduped };
}

export async function readPublicCorpusRecordBundleDigests(
  filePath: string,
): Promise<`sha256:${string}`[]> {
  const { entries } = await readPublicCorpusRecordLedger(filePath);
  return entries.flatMap((record) => (record.bundleDigest ? [record.bundleDigest] : []));
}

function createPublicCorpusLedgerSnapshot(
  records: PublicCorpusRecordLedgerEntry[],
  errors: PublicCorpusRecordLedgerEntry[],
): PublicCorpusLedgerSnapshot {
  const snapshot: PublicCorpusLedgerSnapshot = {
    records: [],
    errors: [],
    successByKey: new Map(),
    digestByOffset: new Map(),
  };
  for (const record of records) {
    recordPublicCorpusLedgerSuccess(snapshot, record);
  }
  for (const record of errors) {
    recordPublicCorpusLedgerError(snapshot, record);
  }
  return snapshot;
}

function applyLedgerProgress(
  manifest: PublicCorpusRunManifest,
  snapshot: PublicCorpusLedgerSnapshot,
): void {
  const consumedOffsets = new Set(
    [...snapshot.records, ...snapshot.errors].map((record) => record.offset),
  );
  const upperBound = manifest.plan.startOffset + manifest.plan.maxRows;
  let nextOffset = manifest.plan.startOffset;
  while (nextOffset < upperBound && consumedOffsets.has(nextOffset)) {
    nextOffset += 1;
  }

  manifest.progress.nextOffset = nextOffset;
  manifest.progress.rowsFetched = consumedOffsets.size;
  manifest.progress.rowsImported = snapshot.records.filter(
    (record) => record.status === "written" || record.status === "verified_existing",
  ).length;
  manifest.progress.rowsSkipped = snapshot.records.filter(
    (record) => record.status === "skipped_existing",
  ).length;
  manifest.progress.rowsFailed = snapshot.errors.length;
}

function dedupeLedgerEntries(
  entries: PublicCorpusRecordLedgerEntry[],
): PublicCorpusRecordLedgerEntry[] {
  const seen = new Set<string>();
  const deduped: PublicCorpusRecordLedgerEntry[] = [];
  for (const entry of entries) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

async function writeLedger(
  filePath: string,
  entries: PublicCorpusRecordLedgerEntry[],
): Promise<void> {
  await writeTextAtomic(filePath, serializePublicCorpusLedgerEntries(entries));
}

async function readTextIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function findLastNonEmptyLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim()) {
      return index;
    }
  }
  return -1;
}

function isPublicCorpusRecordLedgerEntry(value: unknown): value is PublicCorpusRecordLedgerEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as PublicCorpusRecordLedgerEntry;
  return (
    Number.isInteger(record.offset) &&
    record.offset >= 0 &&
    Number.isSafeInteger(record.offset) &&
    Number.isInteger(record.rowIndex) &&
    record.rowIndex >= 0 &&
    Number.isSafeInteger(record.rowIndex) &&
    typeof record.recordId === "string" &&
    typeof record.sourceIdentity === "string" &&
    typeof record.rowDigest === "string" &&
    record.rowDigest.startsWith("sha256:") &&
    isRecordStatus(record.status)
  );
}

function isRecordStatus(value: unknown): boolean {
  return (
    value === "prepared" ||
    value === "written" ||
    value === "verified_existing" ||
    value === "skipped_existing" ||
    value === "failed"
  );
}

function recordDigestByOffset(
  snapshot: PublicCorpusLedgerSnapshot,
  record: PublicCorpusRecordLedgerEntry,
): void {
  const recordedDigest = snapshot.digestByOffset.get(record.offset);
  if (recordedDigest && recordedDigest !== record.rowDigest) {
    throw new Error(`Public corpus row digest drift at offset ${record.offset}.`);
  }
  snapshot.digestByOffset.set(record.offset, record.rowDigest);
}
