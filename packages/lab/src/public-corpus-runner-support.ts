import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type PublicTrajectoryDataset,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { defaultLabRuntimeRoot } from "./runtime-paths.js";
import {
  DEFAULT_PUBLIC_CORPUS_MAX_RETRIES,
  DEFAULT_PUBLIC_CORPUS_MAX_ROWS,
  DEFAULT_PUBLIC_CORPUS_PAGE_SIZE,
  DEFAULT_PUBLIC_CORPUS_TIMEOUT_SECONDS,
  createInitialPublicCorpusManifest,
  defaultPublicCorpusBundleRoot,
  defaultPublicCorpusRunId,
  defaultPublicCorpusRunRoot,
  digestJsonValue,
  safeRunId,
  writeJsonAtomic,
  writePublicCorpusRunManifestAtomic,
  writePublicCorpusRunMarkdownAtomic,
  type PublicCorpusExistingPolicy,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";
import {
  readPublicCorpusRecordBundleDigests,
  updatePublicCorpusLedgerIntegrity,
} from "./public-corpus-ledger.js";
import {
  isPublicCorpusRunManifest,
  readPublicCorpusRunManifest,
} from "./public-corpus-manifest-validation.js";
import {
  createPublicCorpusRunPlan,
  defaultTraceCommonsCorpusSplit,
  readSupportedCorpusDataset,
  readTraceCommonsCorpusSplit,
} from "./public-corpus-runner-plan.js";
import type { ReplaySessionBundle } from "./session-bundle.js";

export type PublicCorpusRunOptions = {
  dataset?: PublicTrajectoryDataset;
  split?: TraceCommonsSplit;
  offset?: number;
  maxRows?: number;
  pageSize?: number;
  runtimeRoot?: string;
  outputRoot?: string;
  bundleRoot?: string;
  runId?: string;
  exportedAt?: string;
  dryRun?: boolean;
  plan?: boolean;
  existing?: PublicCorpusExistingPolicy;
  requestTimeoutSeconds?: number;
  maxRetries?: number;
  resumeManifestPath?: string;
};

export type ResolvedPublicCorpusRun = {
  manifest: PublicCorpusRunManifest;
  ledgerIntegrityMode: "strict" | "recover-running-append";
};

export async function resolvePublicCorpusRun(
  options: PublicCorpusRunOptions,
): Promise<ResolvedPublicCorpusRun> {
  if (options.resumeManifestPath) {
    assertResumeHasNoPlanOverrides(options);
    const manifest = await readPublicCorpusRunManifest(options.resumeManifestPath);
    if (manifest.status === "completed") {
      throw new Error(`Public corpus run is already completed: ${options.resumeManifestPath}`);
    }
    const ledgerIntegrityMode = manifest.status === "running" ? "recover-running-append" : "strict";
    const { termination: _termination, ...rest } = manifest;
    return {
      manifest: {
        ...rest,
        status: manifest.plan.planOnly ? "planned" : "running",
        updatedAt: new Date().toISOString(),
      },
      ledgerIntegrityMode,
    };
  }

  const dataset = readSupportedCorpusDataset(options.dataset ?? "trace-commons");
  const split = readTraceCommonsCorpusSplit(
    options.split ?? defaultTraceCommonsCorpusSplit(dataset),
  );
  const runtimeRoot = path.resolve(options.runtimeRoot ?? defaultLabRuntimeRoot());
  const outputRoot = path.resolve(options.outputRoot ?? defaultPublicCorpusRunRoot(runtimeRoot));
  const bundleRoot = path.resolve(options.bundleRoot ?? defaultPublicCorpusBundleRoot(runtimeRoot));
  const createdAt = options.exportedAt ?? new Date().toISOString();
  const plan = createPublicCorpusRunPlan({
    dataset,
    split,
    offset: options.offset ?? 0,
    maxRows: options.maxRows ?? DEFAULT_PUBLIC_CORPUS_MAX_ROWS,
    pageSize: options.pageSize ?? DEFAULT_PUBLIC_CORPUS_PAGE_SIZE,
    requestTimeoutSeconds: options.requestTimeoutSeconds ?? DEFAULT_PUBLIC_CORPUS_TIMEOUT_SECONDS,
    maxRetries: options.maxRetries ?? DEFAULT_PUBLIC_CORPUS_MAX_RETRIES,
    existing: options.existing ?? "verify",
    dryRun: options.dryRun ?? false,
    planOnly: options.plan ?? false,
  });
  const runId = safeRunId(
    options.runId ??
      defaultPublicCorpusRunId({
        createdAt,
        startOffset: plan.startOffset,
        maxRows: plan.maxRows,
        pageSize: plan.pageSize,
      }),
  );

  return {
    manifest: createInitialPublicCorpusManifest({
      runId,
      createdAt,
      runtimeRoot,
      runRoot: path.join(outputRoot, runId),
      bundleRoot,
      plan,
    }),
    ledgerIntegrityMode: "strict",
  };
}

export async function persistPublicCorpusBundleRecord(input: {
  manifest: PublicCorpusRunManifest;
  bundle: ReplaySessionBundle;
  bundlePath: string;
  record: PublicCorpusRecordLedgerEntry;
}): Promise<PublicCorpusRecordLedgerEntry> {
  if (input.manifest.plan.dryRun) {
    return input.record;
  }

  const existingDigest = await readExistingBundleDigest(input.bundlePath);
  if (existingDigest) {
    if (input.manifest.plan.existing === "skip") {
      return { ...input.record, status: "skipped_existing" };
    }
    if (input.manifest.plan.existing === "error") {
      input.manifest.progress.rowsDuplicated += 1;
      throw new Error(`Bundle already exists: ${input.bundlePath}`);
    }
    if (existingDigest !== input.record.bundleDigest) {
      input.manifest.progress.rowsDuplicated += 1;
      throw new Error(`Existing bundle digest mismatch: ${input.bundlePath}`);
    }
    return { ...input.record, status: "verified_existing" };
  }

  await writeJsonAtomic(input.bundlePath, input.bundle);
  return input.record;
}

export async function checkpointPublicCorpusManifest(
  manifest: PublicCorpusRunManifest,
  options: { includeMarkdown?: boolean } = {},
): Promise<void> {
  if (manifest.plan.dryRun) {
    return;
  }
  await updatePublicCorpusLedgerIntegrity(manifest);
  if (!isPublicCorpusRunManifest(manifest)) {
    throw new Error("Refusing to write invalid public corpus run manifest.");
  }
  await writePublicCorpusRunManifestAtomic(manifest);
  if (options.includeMarkdown) {
    await writePublicCorpusRunMarkdownAtomic(manifest);
  }
}

export async function finalizePublicCorpusIntegrity(
  manifest: PublicCorpusRunManifest,
  bundleDigests: `sha256:${string}`[],
): Promise<PublicCorpusRunManifest["integrity"]> {
  const ledgerBundleDigests = manifest.plan.dryRun
    ? []
    : await readPublicCorpusRecordBundleDigests(manifest.artifacts.recordsPath);
  const integrity: PublicCorpusRunManifest["integrity"] = {
    bundleSetDigest: digestJsonValue(
      [...(ledgerBundleDigests.length > 0 ? ledgerBundleDigests : bundleDigests)].sort(),
    ),
  };

  if (!manifest.plan.dryRun) {
    await updatePublicCorpusLedgerIntegrity(manifest);
    Object.assign(integrity, {
      recordsDigest: manifest.integrity.recordsDigest,
      errorsDigest: manifest.integrity.errorsDigest,
    });
  }

  return integrity;
}

function assertResumeHasNoPlanOverrides(options: PublicCorpusRunOptions): void {
  const disallowed = Object.entries(options)
    .filter(([key, value]) => key !== "resumeManifestPath" && value !== undefined)
    .map(([key]) => key);
  if (disallowed.length > 0) {
    throw new Error(
      `--resume cannot be combined with plan-changing options: ${disallowed.join(", ")}`,
    );
  }
}

export function isFatalPublicCorpusRecordError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Existing bundle digest mismatch") ||
      error.message.includes("Bundle already exists"))
  );
}

async function readExistingBundleDigest(filePath: string): Promise<`sha256:${string}` | undefined> {
  try {
    return digestJsonValue(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
