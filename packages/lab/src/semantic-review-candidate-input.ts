import { readFile } from "node:fs/promises";
import path from "node:path";

import { digestPublicCorpusLedgerEntries } from "./public-corpus-ledger-format.js";
import {
  digestJsonValue,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";
import { readPublicCorpusRunManifest } from "./public-corpus-manifest-validation.js";
import {
  findSessionBundleFiles,
  loadSessionBundleIfValid,
  type ReplaySessionBundle,
} from "./session-bundle.js";
import type { CandidateBundleInput } from "./semantic-review-candidate-types.js";

export type ResolvedCandidateBundleInputs = {
  bundleInputs: CandidateBundleInput[];
  fileCount: number;
  manifestRecordCount: number;
  manifestBundleCount: number;
};

export async function resolveCandidateBundleInputs(options: {
  manifestPaths: readonly string[];
  bundlePaths: readonly string[];
  bundleDirectories: readonly string[];
}): Promise<ResolvedCandidateBundleInputs> {
  const bundleInputsByPath = new Map<string, CandidateBundleInput>();
  let manifestRecordCount = 0;
  let manifestBundleCount = 0;

  for (const manifestPath of options.manifestPaths) {
    const resolvedManifestPath = path.resolve(manifestPath);
    const manifest = await readPublicCorpusRunManifest(resolvedManifestPath);
    const records = await readVerifiedManifestRecords(manifest);
    manifestRecordCount += records.length;

    for (const record of records) {
      if (!isVerifiedBundleManifestRecord(record)) {
        continue;
      }
      manifestBundleCount += 1;
      const resolvedBundlePath = path.resolve(record.bundlePath);
      bundleInputsByPath.set(resolvedBundlePath, {
        bundlePath: resolvedBundlePath,
        record,
        manifestPath: resolvedManifestPath,
      });
    }
  }

  for (const bundlePath of options.bundlePaths) {
    const resolvedBundlePath = path.resolve(bundlePath);
    if (!bundleInputsByPath.has(resolvedBundlePath)) {
      bundleInputsByPath.set(resolvedBundlePath, { bundlePath: resolvedBundlePath });
    }
  }

  for (const directory of options.bundleDirectories) {
    for (const bundlePath of await findSessionBundleFiles(path.resolve(directory))) {
      const resolvedBundlePath = path.resolve(bundlePath);
      if (!bundleInputsByPath.has(resolvedBundlePath)) {
        bundleInputsByPath.set(resolvedBundlePath, { bundlePath: resolvedBundlePath });
      }
    }
  }

  return {
    bundleInputs: [...bundleInputsByPath.values()].sort((left, right) =>
      left.bundlePath.localeCompare(right.bundlePath),
    ),
    fileCount: bundleInputsByPath.size,
    manifestRecordCount,
    manifestBundleCount,
  };
}

export async function loadCandidateBundleIfValid(
  input: CandidateBundleInput,
): Promise<ReplaySessionBundle | null> {
  const bundle = await loadSessionBundleIfValid(input.bundlePath);
  if (!bundle) {
    return null;
  }
  verifyBundleDigest(input, bundle);
  return bundle;
}

async function readVerifiedManifestRecords(
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

async function readPublicCorpusRecordLedgerReadOnly(
  filePath: string,
): Promise<PublicCorpusRecordLedgerEntry[]> {
  const text = await readFile(filePath, "utf8");
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

function verifyBundleDigest(input: CandidateBundleInput, bundle: ReplaySessionBundle): void {
  if (!input.record?.bundleDigest) {
    return;
  }

  const bundleDigest = digestJsonValue(bundle);
  if (bundleDigest !== input.record.bundleDigest) {
    throw new Error(`Public corpus bundle digest mismatch: ${input.bundlePath}`);
  }
}

function isVerifiedBundleManifestRecord(
  record: PublicCorpusRecordLedgerEntry,
): record is PublicCorpusRecordLedgerEntry & {
  bundlePath: string;
  bundleDigest: `sha256:${string}`;
} {
  return (
    (record.status === "written" || record.status === "verified_existing") &&
    typeof record.bundlePath === "string" &&
    typeof record.bundleDigest === "string"
  );
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
