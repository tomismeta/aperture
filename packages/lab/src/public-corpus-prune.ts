import { lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { PUBLIC_CORPUS_PRUNE_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import {
  digestJsonValue,
  type PublicCorpusRecordLedgerEntry,
} from "./public-corpus-manifest.js";
import { readPublicCorpusRunManifest } from "./public-corpus-manifest-validation.js";
import {
  isVerifiedPublicCorpusBundleRecord,
  readVerifiedPublicCorpusManifestRecords,
  type VerifiedPublicCorpusBundleRecord,
} from "./public-corpus-verified-records.js";
import { findSessionBundleFiles } from "./session-bundle.js";

export type PublicCorpusPruneOptions = {
  manifestPaths: readonly string[];
  previousManifestPaths?: readonly string[];
  bundleRoot?: string;
  apply?: boolean;
};

export type PublicCorpusPruneReport = {
  schemaVersion: typeof PUBLIC_CORPUS_PRUNE_REPORT_SCHEMA_VERSION;
  mode: "dry_run" | "apply";
  manifestPaths: string[];
  manifestDigests: `sha256:${string}`[];
  previousManifestPaths: string[];
  previousManifestDigests: `sha256:${string}`[];
  bundleRoot: string;
  scopeRoot: string;
  dataset: "trace-commons";
  split: "train";
  manifestRecordCount: number;
  manifestBundleCount: number;
  desiredBundleCount: number;
  previousBundleCount: number;
  missingDesiredBundlePaths: string[];
  driftedDesiredBundlePaths: string[];
  invalidDesiredBundlePaths: string[];
  symlinkDesiredBundlePaths: string[];
  scannedBundleCount: number;
  staleBundleCount: number;
  deletableBundleCount: number;
  retainedUnmanagedBundleCount: number;
  retainedDriftedPreviousBundleCount: number;
  deletedBundleCount: number;
  staleBundlePaths: string[];
  deletableBundlePaths: string[];
  retainedUnmanagedBundlePaths: string[];
  retainedDriftedPreviousBundlePaths: string[];
  deletedBundlePaths: string[];
};

export async function prunePublicCorpusBundles(
  options: PublicCorpusPruneOptions,
): Promise<PublicCorpusPruneReport> {
  if (options.manifestPaths.length === 0) {
    throw new Error("At least one --manifest is required for corpus prune.");
  }

  const manifests = [];
  for (const manifestPath of options.manifestPaths) {
    const resolvedManifestPath = path.resolve(manifestPath);
    const manifest = await readPublicCorpusRunManifest(resolvedManifestPath);
    manifests.push({
      manifestPath: resolvedManifestPath,
      manifest,
      manifestDigest: digestJsonValue(manifest),
    });
  }
  const previousManifests = [];
  for (const manifestPath of options.previousManifestPaths ?? []) {
    const resolvedManifestPath = path.resolve(manifestPath);
    const manifest = await readPublicCorpusRunManifest(resolvedManifestPath);
    previousManifests.push({
      manifestPath: resolvedManifestPath,
      manifest,
      manifestDigest: digestJsonValue(manifest),
    });
  }

  const bundleRoot = options.bundleRoot
    ? path.resolve(options.bundleRoot)
    : inferSingleBundleRoot([
        ...manifests.map((entry) => entry.manifest.artifacts.bundleRoot),
        ...previousManifests.map((entry) => entry.manifest.artifacts.bundleRoot),
      ]);
  const scope = inferSingleScope([...manifests, ...previousManifests], bundleRoot);
  const scopeRoot = path.join(bundleRoot, scope.dataset, scope.split);
  const desiredByPath = new Map<string, VerifiedPublicCorpusBundleRecord>();
  const previousByPath = new Map<string, VerifiedPublicCorpusBundleRecord>();
  let manifestRecordCount = 0;
  let manifestBundleCount = 0;

  for (const { manifest } of manifests) {
    assertPruneAuthorityManifest(manifest);
    const records = await readVerifiedPublicCorpusManifestRecords(manifest);
    assertPruneAuthorityRecords(manifest, records);
    manifestRecordCount += records.length;
    for (const record of records) {
      if (!isVerifiedPublicCorpusBundleRecord(record)) {
        continue;
      }
      manifestBundleCount += 1;
      setUniqueBundleRecord(desiredByPath, readScopedBundlePath(record, scopeRoot), record);
    }
  }
  if (desiredByPath.size === 0) {
    throw new Error("Refusing to prune with an empty desired public corpus bundle set.");
  }

  for (const { manifest } of previousManifests) {
    assertPruneAuthorityManifest(manifest);
    const records = await readVerifiedPublicCorpusManifestRecords(manifest);
    assertPruneAuthorityRecords(manifest, records);
    for (const record of records) {
      if (!isVerifiedPublicCorpusBundleRecord(record)) {
        continue;
      }
      setUniqueBundleRecord(previousByPath, readScopedBundlePath(record, scopeRoot), record);
    }
  }

  const [scannedBundlePaths, allowedAudit] = await Promise.all([
    findSessionBundleFiles(scopeRoot),
    auditAllowedBundles(desiredByPath),
  ]);

  const staleBundlePaths = scannedBundlePaths
    .map((bundlePath) => path.resolve(bundlePath))
    .filter((bundlePath) => !desiredByPath.has(bundlePath))
    .sort((left, right) => left.localeCompare(right));
  const deletePlan = await planVerifiedDeletes(staleBundlePaths, previousByPath);
  const deletedBundlePaths: string[] = [];

  if (options.apply) {
    assertApplySafe(allowedAudit);
    for (const bundlePath of deletePlan.deletable) {
      await assertCurrentDigestMatchesRecord(bundlePath, previousByPath.get(bundlePath)!);
      await unlink(bundlePath);
      deletedBundlePaths.push(bundlePath);
    }
  }

  return {
    schemaVersion: PUBLIC_CORPUS_PRUNE_REPORT_SCHEMA_VERSION,
    mode: options.apply ? "apply" : "dry_run",
    manifestPaths: manifests.map((entry) => entry.manifestPath),
    manifestDigests: manifests.map((entry) => entry.manifestDigest),
    previousManifestPaths: previousManifests.map((entry) => entry.manifestPath),
    previousManifestDigests: previousManifests.map((entry) => entry.manifestDigest),
    bundleRoot,
    scopeRoot,
    dataset: scope.dataset,
    split: scope.split,
    manifestRecordCount,
    manifestBundleCount,
    desiredBundleCount: desiredByPath.size,
    previousBundleCount: previousByPath.size,
    missingDesiredBundlePaths: allowedAudit.missing,
    driftedDesiredBundlePaths: allowedAudit.drifted,
    invalidDesiredBundlePaths: allowedAudit.invalid,
    symlinkDesiredBundlePaths: allowedAudit.symlink,
    scannedBundleCount: scannedBundlePaths.length,
    staleBundleCount: staleBundlePaths.length,
    deletableBundleCount: deletePlan.deletable.length,
    retainedUnmanagedBundleCount: deletePlan.unmanaged.length,
    retainedDriftedPreviousBundleCount: deletePlan.driftedPrevious.length,
    deletedBundleCount: deletedBundlePaths.length,
    staleBundlePaths,
    deletableBundlePaths: deletePlan.deletable,
    retainedUnmanagedBundlePaths: deletePlan.unmanaged,
    retainedDriftedPreviousBundlePaths: deletePlan.driftedPrevious,
    deletedBundlePaths,
  };
}

function inferSingleBundleRoot(bundleRoots: string[]): string {
  const uniqueRoots = [...new Set(bundleRoots.map((bundleRoot) => path.resolve(bundleRoot)))];
  if (uniqueRoots.length !== 1) {
    throw new Error("Multiple manifest bundle roots found; pass --bundle-root explicitly.");
  }
  return uniqueRoots[0]!;
}

function inferSingleScope(
  entries: { manifest: { plan: { dataset: "trace-commons"; split: "train" }; artifacts: { bundleRoot: string } } }[],
  bundleRoot: string,
): { dataset: "trace-commons"; split: "train" } {
  const keys = new Set<string>();
  for (const { manifest } of entries) {
    if (path.resolve(manifest.artifacts.bundleRoot) !== bundleRoot) {
      throw new Error("Manifest bundle root does not match the prune bundle root.");
    }
    keys.add(`${manifest.plan.dataset}/${manifest.plan.split}`);
  }
  if (keys.size !== 1) {
    throw new Error("Mixed manifest dataset/split scopes are not supported for corpus prune.");
  }
  return { dataset: "trace-commons", split: "train" };
}

function assertPruneAuthorityManifest(manifest: {
  plan: { startOffset: number; maxRows: number };
  progress: {
    nextOffset: number;
    rowsFetched: number;
    rowsFailed: number;
    rowsSkipped: number;
  };
}): void {
  const expectedNextOffset = manifest.plan.startOffset + manifest.plan.maxRows;
  if (
    manifest.progress.nextOffset !== expectedNextOffset ||
    manifest.progress.rowsFetched !== manifest.plan.maxRows ||
    manifest.progress.rowsFailed !== 0 ||
    manifest.progress.rowsSkipped !== 0
  ) {
    throw new Error(
      "Public corpus prune requires full completed manifest coverage with zero failed or skipped rows.",
    );
  }
}

function assertPruneAuthorityRecords(
  manifest: { plan: { maxRows: number } },
  records: readonly PublicCorpusRecordLedgerEntry[],
): void {
  const bundleRecords = records.filter(isVerifiedPublicCorpusBundleRecord);
  if (
    bundleRecords.length !== manifest.plan.maxRows ||
    records.some((record) => record.status === "skipped_existing")
  ) {
    throw new Error(
      "Public corpus prune requires one verified bundle record per planned row and no skipped-existing records.",
    );
  }
}

function readScopedBundlePath(
  record: VerifiedPublicCorpusBundleRecord,
  scopeRoot: string,
): string {
  const bundlePath = path.resolve(record.bundlePath);
  if (!isPathWithin(scopeRoot, bundlePath)) {
    throw new Error(`Public corpus bundle path escapes manifest scope: ${record.bundlePath}`);
  }
  return bundlePath;
}

function setUniqueBundleRecord(
  recordsByPath: Map<string, VerifiedPublicCorpusBundleRecord>,
  bundlePath: string,
  record: VerifiedPublicCorpusBundleRecord,
): void {
  const existing = recordsByPath.get(bundlePath);
  if (existing && existing.bundleDigest !== record.bundleDigest) {
    throw new Error(`Public corpus manifest has conflicting bundle digests for ${bundlePath}`);
  }
  recordsByPath.set(bundlePath, record);
}

async function auditAllowedBundles(
  desiredByPath: Map<string, VerifiedPublicCorpusBundleRecord>,
): Promise<{
  missing: string[];
  drifted: string[];
  invalid: string[];
  symlink: string[];
}> {
  const missing: string[] = [];
  const drifted: string[] = [];
  const invalid: string[] = [];
  const symlink: string[] = [];
  for (const [bundlePath, record] of desiredByPath) {
    const result = await readBundleDigestIfPresent(bundlePath);
    if (result.status === "missing") {
      missing.push(bundlePath);
      continue;
    }
    if (result.status === "invalid") {
      invalid.push(bundlePath);
      continue;
    }
    if (result.status === "symlink") {
      symlink.push(bundlePath);
      continue;
    }
    if (result.digest !== record.bundleDigest) {
      drifted.push(bundlePath);
    }
  }
  return {
    missing: missing.sort((left, right) => left.localeCompare(right)),
    drifted: drifted.sort((left, right) => left.localeCompare(right)),
    invalid: invalid.sort((left, right) => left.localeCompare(right)),
    symlink: symlink.sort((left, right) => left.localeCompare(right)),
  };
}

async function planVerifiedDeletes(
  staleBundlePaths: string[],
  previousByPath: Map<string, VerifiedPublicCorpusBundleRecord>,
): Promise<{
  deletable: string[];
  unmanaged: string[];
  driftedPrevious: string[];
}> {
  const deletable: string[] = [];
  const unmanaged: string[] = [];
  const driftedPrevious: string[] = [];

  for (const bundlePath of staleBundlePaths) {
    const previousRecord = previousByPath.get(bundlePath);
    if (!previousRecord) {
      unmanaged.push(bundlePath);
      continue;
    }
    const result = await readBundleDigestIfPresent(bundlePath);
    if (result.status !== "present" || result.digest !== previousRecord.bundleDigest) {
      driftedPrevious.push(bundlePath);
      continue;
    }
    deletable.push(bundlePath);
  }

  return {
    deletable: deletable.sort((left, right) => left.localeCompare(right)),
    unmanaged: unmanaged.sort((left, right) => left.localeCompare(right)),
    driftedPrevious: driftedPrevious.sort((left, right) => left.localeCompare(right)),
  };
}

function assertApplySafe(allowedAudit: {
  missing: string[];
  drifted: string[];
  invalid: string[];
  symlink: string[];
}): void {
  if (
    allowedAudit.missing.length > 0 ||
    allowedAudit.drifted.length > 0 ||
    allowedAudit.invalid.length > 0 ||
    allowedAudit.symlink.length > 0
  ) {
    throw new Error(
      "Refusing to apply public corpus prune while desired manifest bundles are missing, drifted, invalid, or symlinked.",
    );
  }
}

async function assertCurrentDigestMatchesRecord(
  bundlePath: string,
  record: VerifiedPublicCorpusBundleRecord,
): Promise<void> {
  const result = await readBundleDigestIfPresent(bundlePath);
  if (result.status !== "present" || result.digest !== record.bundleDigest) {
    throw new Error(`Public corpus bundle changed before prune apply: ${bundlePath}`);
  }
}

async function readBundleDigestIfPresent(filePath: string): Promise<
  | { status: "present"; digest: `sha256:${string}` }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "symlink" }
> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      return { status: "symlink" };
    }
    if (!stats.isFile()) {
      return { status: "invalid" };
    }
    return {
      status: "present",
      digest: digestJsonValue(JSON.parse(await readFile(filePath, "utf8")) as unknown),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: "missing" };
    }
    if (error instanceof SyntaxError) {
      return { status: "invalid" };
    }
    throw error;
  }
}

function isPathWithin(parent: string, child: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
