import path from "node:path";

import { type PublicCorpusRunManifest } from "./public-corpus-manifest.js";
import {
  reconcilePublicCorpusLedger,
  type PublicCorpusLedgerSnapshot,
} from "./public-corpus-ledger.js";
import {
  checkpointPublicCorpusManifest,
  finalizePublicCorpusIntegrity,
  resolvePublicCorpusRun,
  type PublicCorpusRunOptions,
} from "./public-corpus-runner-support.js";
import { importPublicCorpusRows } from "./public-corpus-runner-records.js";
import {
  fetchPublicCorpusPage,
  type PublicCorpusPageFetcher,
} from "./public-corpus-runner-source.js";
import type { PublicCorpusFetchLike, PublicCorpusSleep } from "./public-corpus-fetch-policy.js";

export type { PublicCorpusRunOptions } from "./public-corpus-runner-support.js";

export type PublicCorpusRunResult = {
  manifest: PublicCorpusRunManifest;
  manifestPath?: string;
  markdownPath?: string;
  recordsPath?: string;
  errorsPath?: string;
  bundlePaths: string[];
};

export type PublicCorpusRunDependencies = {
  fetchPage?: PublicCorpusPageFetcher;
  fetch?: PublicCorpusFetchLike;
  sleep?: PublicCorpusSleep;
};

export async function runPublicCorpusImport(
  options: PublicCorpusRunOptions = {},
  dependencies: PublicCorpusRunDependencies = {},
): Promise<PublicCorpusRunResult> {
  const resolved = await resolvePublicCorpusRun(options);
  const { manifest } = resolved;
  const fetchPage = dependencies.fetchPage ?? fetchPublicCorpusPage;
  const bundlePaths: string[] = [];
  const bundleDigests: `sha256:${string}`[] = [];
  const ledger =
    manifest.plan.dryRun || manifest.plan.planOnly
      ? createEmptyLedgerSnapshot()
      : await reconcilePublicCorpusLedger(manifest, {
          integrityMode: resolved.ledgerIntegrityMode,
        });

  if (manifest.plan.planOnly) {
    return { manifest, bundlePaths };
  }

  await checkpointPublicCorpusManifest(manifest);

  try {
    const finalOffset = manifest.plan.startOffset + manifest.plan.maxRows;
    while (manifest.progress.nextOffset < finalOffset) {
      const remaining = finalOffset - manifest.progress.nextOffset;
      const pageLimit = Math.min(manifest.plan.pageSize, remaining);
      const pageOffset = manifest.progress.nextOffset;
      manifest.progress.pagesAttempted += 1;
      manifest.updatedAt = new Date().toISOString();
      await checkpointPublicCorpusManifest(manifest);

      const rows = await fetchPage({
        dataset: manifest.plan.dataset,
        split: manifest.plan.split,
        offset: pageOffset,
        limit: pageLimit,
        timeoutMs: manifest.plan.requestTimeoutSeconds * 1000,
        maxBytes: manifest.plan.maxResponseBytes,
        maxRetries: manifest.plan.maxRetries,
        ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
        ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
      });

      manifest.progress.rowsFetched += rows.length;
      await importPublicCorpusRows({
        rows,
        offset: pageOffset,
        manifest,
        ledger,
        bundlePaths,
        bundleDigests,
      });
      manifest.progress.pagesCompleted += 1;
      manifest.progress.nextOffset = pageOffset + rows.length;
      manifest.updatedAt = new Date().toISOString();
      await checkpointPublicCorpusManifest(manifest);

      if (rows.length === 0 || rows.length < pageLimit) {
        break;
      }
    }

    manifest.status = "completed";
    manifest.completedAt = new Date().toISOString();
    manifest.updatedAt = manifest.completedAt;
    manifest.integrity = await finalizePublicCorpusIntegrity(manifest, bundleDigests);
    await checkpointPublicCorpusManifest(manifest, { includeMarkdown: true });
  } catch (error) {
    manifest.status = "failed";
    manifest.updatedAt = new Date().toISOString();
    manifest.termination = {
      code: "corpus_run_failed",
      message: error instanceof Error ? error.message : String(error),
    };
    manifest.integrity = await finalizePublicCorpusIntegrity(manifest, bundleDigests);
    await checkpointPublicCorpusManifest(manifest, { includeMarkdown: true });
    throw error;
  }

  return {
    manifest,
    ...(manifest.plan.dryRun
      ? {}
      : {
          manifestPath: manifest.artifacts.manifestPath,
          markdownPath: path.join(manifest.artifacts.runRoot, "report.md"),
          recordsPath: manifest.artifacts.recordsPath,
          errorsPath: manifest.artifacts.errorsPath,
        }),
    bundlePaths,
  };
}

function createEmptyLedgerSnapshot(): PublicCorpusLedgerSnapshot {
  return {
    records: [],
    errors: [],
    successByKey: new Map(),
    digestByOffset: new Map(),
  };
}
