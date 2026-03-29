import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FStopProvider } from "./fstop-role.js";
import { readJsonFile } from "./json-utils.js";
import {
  buildAutoresearchProposalCodeRecommendations,
  buildAutoresearchProposalIntentStatements,
  collectAutoresearchProposalSignals,
  defaultAutoresearchProposalCalibrationDir,
  defaultAutoresearchProposalMarkdownPath,
  defaultAutoresearchProposalRunPath,
  promoteAutoresearchProposalCandidates,
  renderAutoresearchProposalMarkdown,
  selectAutoresearchProposalPromotions,
  writeAutoresearchProposalRun,
  type AutoresearchProposalRun,
} from "./autoresearch-proposal.js";
import type { AutoresearchOptimizerRun } from "./autoresearch-optimizer.js";
import {
  defaultPublicTrajectorySplit,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./public-trajectories.js";
import { resolveAutoresearchInputFile } from "./autoresearch-input.js";
import { ensureCleanWorktree } from "./autoresearch-workspace.js";
import { runOfflineReviewBatchCommand } from "./offline-review-batch-command.js";
import { runAutoresearchOptimizeCommand } from "./autoresearch-optimize-command.js";

export type AutoresearchProposalCommandOptions = {
  inputFile?: string;
  bundlePaths: string[];
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  offset?: number;
  limit?: number;
  batchReportPath?: string;
  reviewerProvider: FStopProvider;
  reviewerCommand?: string;
  optimizerProvider: FStopProvider;
  optimizerCommand?: string;
  reviewConcurrency: number;
  minSessionCount: number;
  maxReports: number;
  outputPath?: string;
};

export type AutoresearchProposalCommandResult = {
  status: AutoresearchProposalRun["status"];
  proposalPath: string;
  proposalMarkdownPath: string;
  batchReportPath: string;
  candidateCalibrationDir: string;
  signalCount: number;
  promotedCaseCount: number;
  optimizerRunPath?: string;
  optimizerPatchPath?: string;
  run: AutoresearchProposalRun;
};

type BatchSummary = {
  summary: {
    bundleCount: number;
    statusCounts: {
      clean: number;
      disagreement: number;
      error: number;
    };
    disagreementCount: number;
    actionableCount: number;
  };
};

export async function runAutoresearchProposalCommand(
  options: AutoresearchProposalCommandOptions,
): Promise<AutoresearchProposalCommandResult> {
  await ensureCleanWorktree();

  const resolvedInput = options.inputFile
    ? await resolveAutoresearchInputFile(options.inputFile, {
      dataset: options.dataset,
      split: options.split,
    })
    : undefined;
  const effectiveBatchReportPath = options.batchReportPath ?? resolvedInput?.batchReportPath;
  const effectiveBundlePaths = [
    ...options.bundlePaths,
    ...(resolvedInput?.bundlePaths ?? []),
  ];

  const generatedAt = new Date().toISOString();
  const proposalPath = options.outputPath ?? defaultAutoresearchProposalRunPath(generatedAt);
  const proposalMarkdownPath = defaultAutoresearchProposalMarkdownPath(proposalPath);
  const notes: string[] = [];

  const batchArtifacts = effectiveBatchReportPath
    ? await resolvePrecomputedBatchArtifacts(effectiveBatchReportPath)
    : await runDiscoveryBatch({
      ...options,
      bundlePaths: effectiveBundlePaths,
    });
  const batchReportPath = batchArtifacts.batchReportPath;
  const batchMarkdownPath = batchArtifacts.batchMarkdownPath;
  if (effectiveBatchReportPath) {
    notes.push(`Using precomputed discovery batch: ${batchReportPath}`);
  } else if (resolvedInput?.ingest) {
    const sourceLabel = resolvedInput.ingest.sourceKind === "fstop-session" ? "canonical F-Stop session" : "raw export";
    notes.push(
      `Prepared ${resolvedInput.ingest.bundleCount} bundle(s) from ${sourceLabel} ${resolvedInput.ingest.sourcePath} into ${resolvedInput.ingest.outputDirectory}.`,
    );
  } else if (effectiveBundlePaths.length > 0) {
    notes.push(`Using explicit bundle input: ${effectiveBundlePaths.join(", ")}`);
  }

  const batchReport = await readJsonFile<BatchSummary>(batchReportPath);
  const bundleCount = batchReport.summary.bundleCount;
  const cleanCount = batchReport.summary.statusCounts.clean;
  const disagreementBundleCount = batchReport.summary.statusCounts.disagreement;
  const disagreementCount = batchReport.summary.disagreementCount;
  const errorCount = batchReport.summary.statusCounts.error;
  const actionableCount = batchReport.summary.actionableCount;
  if (errorCount > 0) {
    notes.push(`Discovery batch completed with ${errorCount} reviewer error(s).`);
  }

  const signals = await collectAutoresearchProposalSignals(batchReportPath, {
    minSessionCount: options.minSessionCount,
  });
  const promotionCandidates = selectAutoresearchProposalPromotions(signals, {
    maxReports: options.maxReports,
  });
  const candidateCalibrationDir = defaultAutoresearchProposalCalibrationDir(generatedAt);
  const promotions = await promoteAutoresearchProposalCandidates(promotionCandidates, {
    candidateCalibrationDir,
  });
  const intentStatements = buildAutoresearchProposalIntentStatements(signals);

  let optimizer: AutoresearchProposalRun["optimizer"];
  let optimizerRunPath: string | undefined;
  let optimizerRunMarkdownPath: string | undefined;
  let optimizerPatchPath: string | undefined;
  let status: AutoresearchProposalRun["status"];
  let optimizerRun: Awaited<ReturnType<typeof runAutoresearchOptimizeCommand>>["run"] | undefined;
  const discoveryStatus = determineAutoresearchProposalDiscoveryStatus({
    bundleCount,
    disagreementCount,
    errorCount,
    signalCount: signals.length,
  });

  if (discoveryStatus === "error") {
    status = "error";
    if (bundleCount === 0) {
      notes.push("Discovery batch did not produce any bundles.");
    } else {
      notes.push(`Discovery batch failed for all ${errorCount} bundle(s).`);
    }
  } else if (discoveryStatus === "no_signal") {
    status = "no_signal";
    notes.push(
      `No repeated high-confidence signals met the promotion threshold of ${options.minSessionCount} session(s).`,
    );
  } else if (discoveryStatus === "clean") {
    status = "clean";
    notes.push("Discovery batch was clean; no proposal was generated.");
  } else if (bundleCount === 0) {
    status = "error";
    notes.push("Discovery batch did not produce any bundles.");
  } else {
    const optimizeResult = await runAutoresearchOptimizeCommand({
      provider: options.optimizerProvider,
      ...(options.optimizerCommand ? { optimizerCommand: options.optimizerCommand } : {}),
      extraCalibrationDirs: [candidateCalibrationDir],
      skipJudgmentBattle: false,
      skipReleaseCheck: false,
    });

    optimizerRun = optimizeResult.run;
    optimizerRunPath = optimizeResult.runPath;
    optimizerRunMarkdownPath = optimizeResult.runMarkdownPath;
    optimizerPatchPath = optimizeResult.run.artifacts.patchPath;
    optimizer = {
      status: optimizeResult.status,
      beforeMismatchCount: optimizeResult.beforeMismatchCount,
      afterMismatchCount: optimizeResult.afterMismatchCount,
      beforeInvariantMismatchCount: optimizeResult.beforeInvariantMismatchCount,
      afterInvariantMismatchCount: optimizeResult.afterInvariantMismatchCount,
      changedFiles: optimizeResult.changedFiles,
      disallowedFiles: optimizeResult.disallowedFiles,
    };
    status = mapOptimizerStatus(optimizeResult.status, optimizeResult.run.artifacts.patchPath);
    notes.push(...optimizeResult.notes);
  }

  const run: AutoresearchProposalRun = {
    schemaVersion: 1,
    generatedAt,
    status,
    summary: {
      bundleCount,
      cleanCount,
      disagreementBundleCount,
      errorCount,
      actionableCount,
      selectedSignalCount: signals.length,
      promotedCaseCount: promotions.length,
    },
    artifacts: {
      batchReportPath,
      ...(batchMarkdownPath ? { batchMarkdownPath } : {}),
      ...(promotions.length > 0 ? { candidateCalibrationDir } : {}),
      ...(optimizerRunPath ? { optimizerRunPath } : {}),
      ...(optimizerRunMarkdownPath ? { optimizerRunMarkdownPath } : {}),
      ...(optimizerPatchPath ? { optimizerPatchPath } : {}),
    },
    signals,
    intentStatements,
    codeRecommendations: buildAutoresearchProposalCodeRecommendations({
      signals,
      ...(optimizerRun ? { optimizerRun } : {}),
      ...(optimizerPatchPath ? { optimizerPatchPath } : {}),
    }),
    promotions,
    ...(optimizer ? { optimizer } : {}),
    notes,
  };

  await writeAutoresearchProposalRun(proposalPath, run);
  await mkdir(path.dirname(proposalMarkdownPath), { recursive: true });
  await writeFile(proposalMarkdownPath, renderAutoresearchProposalMarkdown(run), "utf8");

  return {
    status: run.status,
    proposalPath,
    proposalMarkdownPath,
    batchReportPath,
    candidateCalibrationDir,
    signalCount: run.summary.selectedSignalCount,
    promotedCaseCount: run.summary.promotedCaseCount,
    ...(optimizerRunPath ? { optimizerRunPath } : {}),
    ...(optimizerPatchPath ? { optimizerPatchPath } : {}),
    run,
  };
}

export function determineAutoresearchProposalDiscoveryStatus(input: {
  bundleCount: number;
  disagreementCount: number;
  errorCount: number;
  signalCount: number;
}): "error" | "clean" | "no_signal" | undefined {
  if (input.bundleCount === 0) {
    return "error";
  }
  if (input.signalCount > 0) {
    return undefined;
  }
  if (input.errorCount >= input.bundleCount) {
    return "error";
  }
  return input.disagreementCount > 0 ? "no_signal" : "clean";
}

export function defaultAutoresearchProposalSplit(
  dataset: PublicTrajectoryDataset,
): PublicTrajectorySplit {
  return defaultPublicTrajectorySplit(dataset);
}

async function runDiscoveryBatch(options: AutoresearchProposalCommandOptions): Promise<{
  batchReportPath: string;
  batchMarkdownPath?: string;
}> {
  const batchResult = await runOfflineReviewBatchCommand({
    bundlePaths: options.bundlePaths,
    ...(options.dataset ? { dataset: options.dataset } : {}),
    ...(options.split ? { split: options.split } : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    concurrency: options.reviewConcurrency,
    reviewerProvider: options.reviewerProvider,
    ...(options.reviewerCommand ? { reviewerCommand: options.reviewerCommand } : {}),
  });

  return {
    batchReportPath: batchResult.outputPath,
    ...(batchResult.markdownOutputPath ? { batchMarkdownPath: batchResult.markdownOutputPath } : {}),
  };
}

async function resolvePrecomputedBatchArtifacts(batchReportPath: string): Promise<{
  batchReportPath: string;
  batchMarkdownPath?: string;
}> {
  await assertFileExists(batchReportPath, "--batch-report");
  const batchMarkdownCandidate = batchReportPath.replace(/\.json$/i, ".md");

  return {
    batchReportPath,
    ...(await fileExists(batchMarkdownCandidate) ? { batchMarkdownPath: batchMarkdownCandidate } : {}),
  };
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  if (await fileExists(filePath)) {
    return;
  }

  throw new Error(`${label} does not exist: ${filePath}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function mapOptimizerStatus(
  status: AutoresearchOptimizerRun["status"],
  patchPath: string | undefined,
): AutoresearchProposalRun["status"] {
  if (status === "improved" && patchPath) {
    return "proposed";
  }
  if (status === "clean") {
    return "optimizer_clean";
  }
  if (status === "invalid") {
    return "error";
  }
  return "no_change";
}
