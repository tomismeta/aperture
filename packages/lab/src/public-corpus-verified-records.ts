import { readFile } from "node:fs/promises";

import { digestPublicCorpusLedgerEntries } from "./public-corpus-ledger-format.js";
import {
  digestJsonValue,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";

export type VerifiedPublicCorpusBundleRecord = PublicCorpusRecordLedgerEntry & {
  bundlePath: string;
  bundleDigest: `sha256:${string}`;
};

export async function readVerifiedPublicCorpusManifestRecords(
  manifest: PublicCorpusRunManifest,
): Promise<PublicCorpusRecordLedgerEntry[]> {
  assertCompletedManifestIntegrity(manifest);

  const [records, errors] = await Promise.all([
    readPublicCorpusRecordLedgerReadOnly(manifest.artifacts.recordsPath),
    readPublicCorpusRecordLedgerReadOnly(manifest.artifacts.errorsPath),
  ]);
  const recordsDigest = digestPublicCorpusLedgerEntries(records);
  const errorsDigest = digestPublicCorpusLedgerEntries(errors);

  if (manifest.integrity.recordsDigest !== recordsDigest) {
    throw new Error(`Public corpus records digest mismatch: ${manifest.artifacts.recordsPath}`);
  }
  if (manifest.integrity.errorsDigest !== errorsDigest) {
    throw new Error(`Public corpus errors digest mismatch: ${manifest.artifacts.errorsPath}`);
  }

  verifyManifestBundleSetDigest(manifest, records);
  assertManifestRecordsAreLoadVerifiable(records);
  return records;
}

export function isVerifiedPublicCorpusBundleRecord(
  record: PublicCorpusRecordLedgerEntry,
): record is VerifiedPublicCorpusBundleRecord {
  return (
    (record.status === "written" || record.status === "verified_existing") &&
    typeof record.bundlePath === "string" &&
    typeof record.bundleDigest === "string"
  );
}

async function readPublicCorpusRecordLedgerReadOnly(
  filePath: string,
): Promise<PublicCorpusRecordLedgerEntry[]> {
  const text = await readTextIfPresent(filePath);
  if (!text) {
    return [];
  }
  const entries: PublicCorpusRecordLedgerEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    const parsed = JSON.parse(line) as unknown;
    if (!isPublicCorpusRecordLedgerEntry(parsed)) {
      throw new Error(`Invalid public corpus ledger entry in ${filePath}:${index + 1}`);
    }
    entries.push(parsed);
  }
  return entries;
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

function assertCompletedManifestIntegrity(manifest: PublicCorpusRunManifest): void {
  if (manifest.status !== "completed") {
    throw new Error(`Public corpus manifest is not completed: ${manifest.artifacts.manifestPath}`);
  }
  if (!manifest.integrity.recordsDigest) {
    throw new Error(`Public corpus manifest lacks recordsDigest: ${manifest.artifacts.manifestPath}`);
  }
  if (!manifest.integrity.errorsDigest) {
    throw new Error(`Public corpus manifest lacks errorsDigest: ${manifest.artifacts.manifestPath}`);
  }
  if (!manifest.integrity.bundleSetDigest) {
    throw new Error(
      `Public corpus manifest lacks bundleSetDigest: ${manifest.artifacts.manifestPath}`,
    );
  }
}

function verifyManifestBundleSetDigest(
  manifest: PublicCorpusRunManifest,
  records: PublicCorpusRecordLedgerEntry[],
): void {
  const bundleSetDigest = digestJsonValue(
    records.flatMap((record) => (record.bundleDigest ? [record.bundleDigest] : [])).sort(),
  );
  if (manifest.integrity.bundleSetDigest !== bundleSetDigest) {
    throw new Error(`Public corpus bundle set digest mismatch: ${manifest.artifacts.recordsPath}`);
  }
}

function assertManifestRecordsAreLoadVerifiable(
  records: PublicCorpusRecordLedgerEntry[],
): void {
  for (const record of records) {
    if (!isManifestLoadStatus(record.status) || !record.bundlePath) {
      continue;
    }
    if (!record.bundleDigest) {
      throw new Error(`Public corpus record lacks bundleDigest: ${record.recordId}`);
    }
  }
}

function isManifestLoadStatus(status: string): boolean {
  return status === "written" || status === "verified_existing";
}

function isPublicCorpusRecordLedgerEntry(value: unknown): value is PublicCorpusRecordLedgerEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as PublicCorpusRecordLedgerEntry;
  return (
    Number.isSafeInteger(record.offset) &&
    record.offset >= 0 &&
    Number.isSafeInteger(record.rowIndex) &&
    record.rowIndex >= 0 &&
    typeof record.recordId === "string" &&
    typeof record.sourceIdentity === "string" &&
    typeof record.rowDigest === "string" &&
    record.rowDigest.startsWith("sha256:") &&
    typeof record.status === "string"
  );
}
