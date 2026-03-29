import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createOfflineReviewBatchReport,
  defaultOfflineReviewBatchPath,
  renderOfflineReviewBatchMarkdown,
  summarizeRecommendationItems,
  writeOfflineReviewBatchReport,
  type OfflineReviewBatchEntry,
} from "./offline-review-batch.js";
import {
  defaultOfflineReviewArtifactPath,
  loadOfflineReviewArtifact,
  prepareOfflineReviewArtifact,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendationItem,
  type OfflineReviewRecommendationReport,
  writeOfflineReviewArtifact,
} from "./offline-review.js";
import { runOfflineReviewArtifactReview } from "./offline-review-run.js";
import type { FStopProvider } from "./fstop-role.js";
import {
  defaultPublicTrajectorySplit,
  importPublicTrajectoryBundles,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./public-trajectories.js";
import { loadSessionBundle } from "./session-bundle.js";

export type OfflineReviewBatchCommandOptions = {
  bundlePaths: string[];
  dataset?: PublicTrajectoryDataset;
  split?: PublicTrajectorySplit;
  offset?: number;
  limit?: number;
  concurrency: number;
  reviewerProvider?: FStopProvider;
  reviewerCommand?: string;
  outputPath?: string;
  markdownOutputPath?: string;
};

export type OfflineReviewBatchCommandResult = {
  status: "ok" | "partial";
  outputPath: string;
  markdownOutputPath: string;
  bundleCount: number;
  errorCount: number;
  disagreementCount: number;
  actionableCount: number;
  focusAreaCounts: Record<OfflineReviewFocusArea, number>;
  recommendationCounts: Record<"promote" | "inspect" | "ignore", number>;
  entries: Array<{
    sessionId: string;
    status: "clean" | "disagreement" | "error";
    disagreementCount: number;
    actionableCount: number;
    reviewer?: string;
    model?: string;
  }>;
};

export async function runOfflineReviewBatchCommand(
  options: OfflineReviewBatchCommandOptions,
): Promise<OfflineReviewBatchCommandResult> {
  const {
    bundlePaths,
    imported,
  } = await resolveBundlePaths(options);

  if (bundlePaths.length === 0) {
    throw new Error("No bundles available to review.");
  }

  const reviewerLabel = options.reviewerCommand ?? `provider:${options.reviewerProvider ?? "generic"}`;
  const entries = await runBatchReviews(bundlePaths, options);

  const report = createOfflineReviewBatchReport(entries, {
    reviewerCommand: reviewerLabel,
    ...(options.reviewerProvider ? { reviewerProvider: options.reviewerProvider } : {}),
    ...(options.dataset ? { dataset: options.dataset } : {}),
    ...(options.split ? { split: options.split } : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    imported,
    bundles: bundlePaths,
  });
  const outputPath = options.outputPath ?? defaultOfflineReviewBatchPath(report);
  const markdownOutputPath = options.markdownOutputPath ?? outputPath.replace(/\.json$/i, ".md");

  await writeOfflineReviewBatchReport(outputPath, report);
  await writeText(markdownOutputPath, renderOfflineReviewBatchMarkdown(report));

  return {
    status: report.summary.statusCounts.error > 0 ? "partial" : "ok",
    outputPath,
    markdownOutputPath,
    bundleCount: report.summary.bundleCount,
    errorCount: report.summary.statusCounts.error,
    disagreementCount: report.summary.disagreementCount,
    actionableCount: report.summary.actionableCount,
    focusAreaCounts: report.summary.focusAreaCounts,
    recommendationCounts: report.summary.recommendationCounts,
    entries: report.entries.map((entry) => ({
      sessionId: entry.sessionId,
      status: entry.status,
      disagreementCount: entry.disagreementCount,
      actionableCount: entry.actionableCount,
      ...(entry.reviewer ? { reviewer: entry.reviewer } : {}),
      ...(entry.model ? { model: entry.model } : {}),
    })),
  };
}

async function resolveBundlePaths(
  options: OfflineReviewBatchCommandOptions,
): Promise<{ bundlePaths: string[]; imported: boolean }> {
  if (options.bundlePaths.length > 0) {
    for (const bundlePath of options.bundlePaths) {
      await stat(bundlePath);
    }
    return {
      bundlePaths: options.bundlePaths,
      imported: false,
    };
  }

  const imported = await importPublicTrajectoryBundles({
    dataset: options.dataset ?? "swe-smith",
    split: options.split ?? defaultPublicTrajectorySplit(options.dataset ?? "swe-smith"),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  return {
    bundlePaths: imported.map((entry) => entry.filePath),
    imported: true,
  };
}

async function prepareArtifact(bundlePath: string): Promise<string> {
  const bundle = await loadSessionBundle(bundlePath);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath,
  });
  const artifactPath = defaultOfflineReviewArtifactPath(artifact);
  await writeOfflineReviewArtifact(artifactPath, artifact);
  return artifactPath;
}

async function runBatchReviews(
  bundlePaths: string[],
  options: OfflineReviewBatchCommandOptions,
): Promise<OfflineReviewBatchEntry[]> {
  const entries = new Array<OfflineReviewBatchEntry>(bundlePaths.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(options.concurrency, 1), bundlePaths.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= bundlePaths.length) {
        return;
      }

      const bundlePath = bundlePaths[index]!;
      try {
        const artifactPath = await prepareArtifact(bundlePath);
        const runResult = await runOfflineReviewArtifactReview({
          artifactPath,
          ...(options.reviewerProvider ? { reviewerProvider: options.reviewerProvider } : {}),
          ...(options.reviewerCommand ? { reviewerCommand: options.reviewerCommand } : {}),
        });
        entries[index] = await buildBatchEntry(runResult);
      } catch (error) {
        entries[index] = buildBatchErrorEntry(bundlePath, error);
      }
    }
  });

  await Promise.all(workers);
  return entries;
}

async function buildBatchEntry(
  runResult: Awaited<ReturnType<typeof runOfflineReviewArtifactReview>>,
): Promise<OfflineReviewBatchEntry> {
  const recommendation = JSON.parse(
    await readFile(runResult.recommendationPath, "utf8"),
  ) as OfflineReviewRecommendationReport;
  const artifact = await loadOfflineReviewArtifact(runResult.responseArtifactPath);

  return {
    sessionId: runResult.bundleSessionId,
    status: runResult.status,
    disagreementCount: runResult.disagreementCount,
    actionableCount: runResult.actionableCount,
    ...(artifact.review.reviewer ? { reviewer: artifact.review.reviewer } : {}),
    ...(artifact.review.model ? { model: artifact.review.model } : {}),
    requestPath: runResult.requestPath,
    promptPath: runResult.promptPath,
    rawResponsePath: runResult.rawResponsePath,
    responseArtifactPath: runResult.responseArtifactPath,
    reportPath: runResult.reportPath,
    recommendationPath: runResult.recommendationPath,
    runPath: runResult.runPath,
    focusAreaCounts: summarizeFocusAreaCounts(recommendation.items),
    recommendationCounts: recommendation.summary.recommendationCounts,
    topRecommendations: summarizeRecommendationItems(recommendation.items),
  };
}

function buildBatchErrorEntry(bundlePath: string, error: unknown): OfflineReviewBatchEntry {
  return {
    sessionId: path.basename(bundlePath, path.extname(bundlePath)),
    status: "error",
    disagreementCount: 0,
    actionableCount: 0,
    error: error instanceof Error ? error.message : String(error),
    focusAreaCounts: emptyFocusAreaCounts(),
    recommendationCounts: {
      promote: 0,
      inspect: 0,
      ignore: 0,
    },
    topRecommendations: [],
  };
}

function summarizeFocusAreaCounts(
  items: OfflineReviewRecommendationItem[],
): Record<OfflineReviewFocusArea, number> {
  const counts = emptyFocusAreaCounts();
  for (const item of items) {
    counts[item.focusArea] += item.disagreementCount;
  }
  return counts;
}

function emptyFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return {
    title: 0,
    summary: 0,
    status: 0,
    intentFrame: 0,
    toolFamily: 0,
    consequence: 0,
  };
}

async function writeText(outputPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${contents}\n`, "utf8");
}
