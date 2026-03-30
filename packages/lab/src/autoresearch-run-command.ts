import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type AutoresearchRunStatusSnapshot,
  calculateAutoresearchWindowPercent,
  calculateAutoresearchWindowPercentIncludingInflight,
  writeAutoresearchRunStatusSnapshot,
} from "./autoresearch-campaign.js";
import { type AutoresearchProposalRun } from "./autoresearch-proposal.js";
import { runAutoresearchProposalCommand } from "./autoresearch-propose-command.js";
import {
  AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION,
  defaultAutoresearchRunnerRunPath,
  renderAutoresearchRunnerRunMarkdown,
  writeAutoresearchRunnerRun,
  type AutoresearchRunnerFeedback,
  type AutoresearchRunnerFeedbackAttempt,
  type AutoresearchRunnerRun,
} from "./autoresearch-runner.js";
import { readJsonFile } from "./json-utils.js";
import { type PublicTrajectoryDataset, type PublicTrajectorySplit } from "./public-trajectories.js";
import {
  captureGitHeadSnapshot,
  ensureCleanWorktree,
  listWorkingTreeFiles,
  restoreGitHeadSnapshot,
} from "./autoresearch-workspace.js";

export type AutoresearchRunnerProvider = "hermes" | "openclaw" | "generic";

export type AutoresearchRunCommandOptions = {
  provider: AutoresearchRunnerProvider;
  inputFile?: string;
  batchReportPath?: string;
  bundlePaths: string[];
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  offset: number;
  limit: number;
  maxSlices: number;
  reviewerProvider: AutoresearchRunnerProvider;
  optimizerProvider: AutoresearchRunnerProvider;
  reviewConcurrency: number;
  minSessionCount: number;
  maxReports: number;
  outputPath?: string;
  statusOutputPath?: string;
};

export type AutoresearchRunCommandResult = {
  status: string;
  provider: AutoresearchRunnerProvider;
  runnerCommand: string;
  runPath: string;
  runMarkdownPath: string;
  selectedProposalPath?: string;
  selectedBatchReportPath?: string;
  selectedOptimizerRunPath?: string;
  selectedPatchPath?: string;
};

type Slice = {
  offset: number;
  limit: number;
};

type SelectedProposalSnapshot = NonNullable<AutoresearchRunnerRun["selectedProposal"]>;

const DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY = 2;
const DETERMINISTIC_RUNNER_COMMAND = "deterministic sequential batch loop";

export async function runAutoresearchRunnerCommand(
  options: AutoresearchRunCommandOptions & {
    resolvedInput?: {
      batchReportPath?: string;
      bundlePaths?: string[];
      ingest?: {
        sourcePath: string;
        sourceKind: "raw-export" | "fstop-session";
        bundleCount: number;
        datasets?: PublicTrajectoryDataset[];
        outputDirectory: string;
        sessionFilePaths?: string[];
      };
    };
  },
): Promise<AutoresearchRunCommandResult> {
  await ensureCleanWorktree();

  const directBatchReportPath = options.batchReportPath ?? options.resolvedInput?.batchReportPath;
  const directBundlePaths = [
    ...options.bundlePaths,
    ...(options.resolvedInput?.bundlePaths ?? []),
  ];
  const generatedAt = new Date().toISOString();
  const runPath = options.outputPath ?? defaultAutoresearchRunnerRunPath(generatedAt);
  const runMarkdownPath = runPath.replace(/\.json$/i, ".md");
  const remainingSlices = createSlicePlan(options.offset, options.limit, options.maxSlices);
  const attempts: AutoresearchRunnerFeedbackAttempt[] = [];
  const commandsRun: string[] = [];
  const notes: string[] = [];
  let lastProgressAt = generatedAt;
  let currentSlice:
    | {
      index: number;
      offset: number;
      limit: number;
    }
    | undefined;
  let currentSliceStartedAt: string | undefined;

  logProgress(
    `starting dataset=${options.dataset} split=${options.split} offset=${options.offset} limit=${options.limit} maxSlices=${options.maxSlices}`,
  );
  await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
    generatedAt,
    options,
    attempts,
    remainingSlices,
    currentSlice,
    lastProgressAt,
    currentSliceStartedAt,
    phase: "running",
  }));

  if (directBatchReportPath || directBundlePaths.length > 0) {
    if (options.resolvedInput?.ingest) {
      const sourceLabel = options.resolvedInput.ingest.sourceKind === "fstop-session"
        ? "canonical F-Stop session"
        : "raw export";
      notes.push(
        `Prepared ${options.resolvedInput.ingest.bundleCount} session file(s) from ${sourceLabel} ${options.resolvedInput.ingest.sourcePath} into ${options.resolvedInput.ingest.outputDirectory}.`,
      );
    }

    const attempt = await executeProposalAttempt(options, {
      ...(directBatchReportPath ? { batchReportPath: directBatchReportPath } : {}),
      ...(directBundlePaths.length > 0 ? { bundlePaths: directBundlePaths } : {}),
    });
    attempts.push(attempt);
    commandsRun.push(buildProposalCommand(options, {
      ...(directBatchReportPath ? { batchReportPath: directBatchReportPath } : {}),
      ...(directBundlePaths.length > 0 ? { bundlePaths: directBundlePaths } : {}),
    }));
    logAttempt("direct_attempt", attempt);
    notes.push("Direct file or session-file mode executed a single unattended proposal attempt.");
  } else {
    let sliceIndex = 0;
    while (remainingSlices.length > 0) {
      const slice = remainingSlices.shift();
      if (!slice) {
        break;
      }

      commandsRun.push(buildProposalCommand(options, { offset: slice.offset, limit: slice.limit }));
      currentSlice = {
        index: sliceIndex,
        offset: slice.offset,
        limit: slice.limit,
      };
      currentSliceStartedAt = new Date().toISOString();
      lastProgressAt = currentSliceStartedAt;
      logProgress(`batch=${sliceIndex} offset=${slice.offset} size=${slice.limit} starting`);
      await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
        generatedAt,
        options,
        attempts,
        remainingSlices,
        currentSlice,
        lastProgressAt,
        currentSliceStartedAt,
        phase: "running",
      }));

      try {
        const attempt = await executeProposalAttempt(options, slice);
        attempts.push(attempt);
        logAttempt(`batch=${sliceIndex} offset=${slice.offset}`, attempt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          offset: slice.offset,
          limit: slice.limit,
          status: "error",
        });
        notes.push(`Batch offset ${slice.offset} failed: ${message}`);
        logProgress(`batch=${sliceIndex} offset=${slice.offset} status=error error=${compactLogText(message)}`);
      } finally {
        currentSlice = undefined;
        currentSliceStartedAt = undefined;
        lastProgressAt = new Date().toISOString();
        await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
          generatedAt,
          options,
          attempts,
          remainingSlices,
          currentSlice,
          lastProgressAt,
          currentSliceStartedAt,
          phase: "running",
        }));
      }

      sliceIndex += 1;
    }
  }

  const feedback = findBestProposalAttempt(attempts)
    ? buildProposalReadyFeedback(attempts, commandsRun)
    : buildExhaustedFeedback(attempts, commandsRun);
  const changedFiles = await listWorkingTreeFilesInRepo(process.cwd());
  if (changedFiles.length > 0) {
    notes.push(`Worktree changed during the run: ${changedFiles.join(", ")}`);
  }

  const selectedProposal = feedback.selectedProposalPath
    ? await buildSelectedProposalSnapshot(feedback.selectedProposalPath)
    : undefined;
  const run: AutoresearchRunnerRun = {
    schemaVersion: AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION,
    generatedAt,
    provider: options.provider,
    runnerCommand: DETERMINISTIC_RUNNER_COMMAND,
    status: determineStatus(feedback),
    artifacts: {
      ...(feedback.selectedProposalPath ? { selectedProposalPath: feedback.selectedProposalPath } : {}),
      ...(feedback.selectedBatchReportPath ? { selectedBatchReportPath: feedback.selectedBatchReportPath } : {}),
      ...(feedback.selectedOptimizerRunPath ? { selectedOptimizerRunPath: feedback.selectedOptimizerRunPath } : {}),
      ...(feedback.selectedPatchPath ? { selectedPatchPath: feedback.selectedPatchPath } : {}),
    },
    ...(selectedProposal ? { selectedProposal } : {}),
    feedback,
    notes,
  };

  await writeAutoresearchRunnerRun(runPath, run);
  await mkdir(path.dirname(runMarkdownPath), { recursive: true });
  await writeFile(runMarkdownPath, renderAutoresearchRunnerRunMarkdown(run), "utf8");
  await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
    generatedAt,
    options,
    attempts,
    remainingSlices,
    currentSlice: undefined,
    lastProgressAt: new Date().toISOString(),
    currentSliceStartedAt: undefined,
    phase: "completed",
    finalStatus: run.status,
    runPath,
    runMarkdownPath,
    ...(run.artifacts.selectedProposalPath ? { selectedProposalPath: run.artifacts.selectedProposalPath } : {}),
    ...(run.artifacts.selectedPatchPath ? { selectedPatchPath: run.artifacts.selectedPatchPath } : {}),
    note: feedback.summary,
  }));
  logProgress(`completed status=${run.status} attempts=${attempts.length}`);

  return {
    status: run.status,
    provider: options.provider,
    runnerCommand: DETERMINISTIC_RUNNER_COMMAND,
    runPath,
    runMarkdownPath,
    ...(run.artifacts.selectedProposalPath ? { selectedProposalPath: run.artifacts.selectedProposalPath } : {}),
    ...(run.artifacts.selectedBatchReportPath ? { selectedBatchReportPath: run.artifacts.selectedBatchReportPath } : {}),
    ...(run.artifacts.selectedOptimizerRunPath ? { selectedOptimizerRunPath: run.artifacts.selectedOptimizerRunPath } : {}),
    ...(run.artifacts.selectedPatchPath ? { selectedPatchPath: run.artifacts.selectedPatchPath } : {}),
  };
}

async function executeProposalAttempt(
  options: AutoresearchRunCommandOptions,
  input: Slice | {
    batchReportPath?: string;
    bundlePaths?: string[];
  },
): Promise<AutoresearchRunnerFeedbackAttempt> {
  const snapshot = await captureGitHeadSnapshot(process.cwd());
  try {
    const proposalResult = await runAutoresearchProposalCommand({
      bundlePaths: "bundlePaths" in input ? (input.bundlePaths ?? []) : [],
      dataset: options.dataset,
      split: options.split,
      reviewerProvider: options.reviewerProvider,
      optimizerProvider: options.optimizerProvider,
      reviewConcurrency: options.reviewConcurrency,
      minSessionCount: options.minSessionCount,
      maxReports: options.maxReports,
      ...("offset" in input && "limit" in input
        ? {
          offset: input.offset,
          limit: input.limit,
        }
        : {
          ...(input.batchReportPath ? { batchReportPath: input.batchReportPath } : {}),
        }),
    });
    const proposalPath = proposalResult.proposalPath;
    const proposalRun = proposalResult.run;

    return {
      offset: "offset" in input ? input.offset : options.offset,
      limit: "limit" in input ? input.limit : options.limit,
      status: proposalRun.status,
      actionableCount: proposalRun.summary.actionableCount,
      selectedSignalCount: proposalRun.summary.selectedSignalCount,
      promotedCaseCount: proposalRun.summary.promotedCaseCount,
      ...(proposalRun.optimizer?.status ? { optimizerStatus: proposalRun.optimizer.status } : {}),
      proposalPath,
      batchReportPath: proposalRun.artifacts.batchReportPath,
      ...(proposalRun.artifacts.optimizerRunPath ? { optimizerRunPath: proposalRun.artifacts.optimizerRunPath } : {}),
      ...(proposalRun.artifacts.optimizerPatchPath
        ? { optimizerPatchPath: proposalRun.artifacts.optimizerPatchPath }
        : {}),
    };
  } finally {
    await restoreGitHeadSnapshot(snapshot, process.cwd());
  }
}

function buildProposalReadyFeedback(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
  commandsRun: readonly string[],
): AutoresearchRunnerFeedback {
  const selectedAttempt = findBestProposalAttempt(attempts);
  if (!selectedAttempt) {
    return buildExhaustedFeedback(attempts, commandsRun);
  }

  return {
    action: "proposal_ready",
    summary: `Observed a proposal patch artifact after ${attempts.length} attempt(s).`,
    reasons: [
      `Slice offset ${selectedAttempt.offset} returned status=${selectedAttempt.status}.`,
      `Selected patch artifact: ${selectedAttempt.optimizerPatchPath}.`,
    ],
    commandsRun: [...commandsRun],
    attempts: [...attempts],
    ...(selectedAttempt.proposalPath ? { selectedProposalPath: selectedAttempt.proposalPath } : {}),
    ...(selectedAttempt.batchReportPath ? { selectedBatchReportPath: selectedAttempt.batchReportPath } : {}),
    ...(selectedAttempt.optimizerRunPath ? { selectedOptimizerRunPath: selectedAttempt.optimizerRunPath } : {}),
    ...(selectedAttempt.optimizerPatchPath ? { selectedPatchPath: selectedAttempt.optimizerPatchPath } : {}),
    recommendedNextStep: "Review the selected patch artifact before bringing it back to the main branch.",
  };
}

function buildExhaustedFeedback(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
  commandsRun: readonly string[],
): AutoresearchRunnerFeedback {
  const statusCounts = new Map<string, number>();
  for (const attempt of attempts) {
    statusCounts.set(attempt.status, (statusCounts.get(attempt.status) ?? 0) + 1);
  }
  const reasons = [...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${count} attempt(s) ended with status=${status}.`);

  const allErrors = attempts.length > 0 && attempts.every((attempt) => attempt.status === "error");
  return {
    action: allErrors ? "blocked" : "no_proposal",
    summary: allErrors
      ? "Every attempted batch failed before a proposal could be produced."
      : "Exhausted the batch budget without finding a proposal patch artifact.",
    reasons,
    commandsRun: [...commandsRun],
    attempts: [...attempts],
    recommendedNextStep: allErrors
      ? "Inspect the failed batch logs before re-running F-Stop."
      : "Inspect the highest-signal no_change batches before expanding the batch budget.",
  };
}

function createSlicePlan(offset: number, limit: number, maxSlices: number): Slice[] {
  return Array.from({ length: Math.max(0, maxSlices) }, (_, index) => ({
    offset: offset + index * limit,
    limit,
  }));
}

function buildProposalCommand(
  options: AutoresearchRunCommandOptions,
  input: Slice | {
    batchReportPath?: string;
    bundlePaths?: string[];
  },
): string {
  return [
    "pnpm lab:fstop:propose",
    ...buildProposalArgs(options, input),
    "--json",
  ].join(" ");
}

function buildProposalArgs(
  options: AutoresearchRunCommandOptions,
  input: Slice | {
    batchReportPath?: string;
    bundlePaths?: string[];
  },
): string[] {
  const sourceArgs = "offset" in input && "limit" in input
    ? [
      "--dataset",
      options.dataset,
      "--split",
      options.split,
      "--offset",
      String(input.offset),
      "--limit",
      String(input.limit),
    ]
    : [
      ...(input.batchReportPath ? ["--batch-report", input.batchReportPath] : []),
      ...(input.bundlePaths?.length
        ? input.bundlePaths.flatMap((bundlePath) => ["--bundle", bundlePath])
        : [
          "--dataset",
          options.dataset,
          "--split",
          options.split,
          "--offset",
          String(options.offset),
          "--limit",
          String(options.limit),
        ]),
    ];

  return [
    ...sourceArgs,
    "--reviewer-provider",
    options.reviewerProvider,
    "--optimizer-provider",
    options.optimizerProvider,
    "--review-concurrency",
    String(options.reviewConcurrency),
    "--min-session-count",
    String(options.minSessionCount),
    "--max-reports",
    String(options.maxReports),
  ];
}

async function buildSelectedProposalSnapshot(proposalPath: string): Promise<SelectedProposalSnapshot> {
  const proposal = await readJsonFile<AutoresearchProposalRun>(proposalPath);
  return {
    status: proposal.status,
    summary: {
      actionableCount: proposal.summary.actionableCount,
      selectedSignalCount: proposal.summary.selectedSignalCount,
      promotedCaseCount: proposal.summary.promotedCaseCount,
    },
    intentStatements: proposal.intentStatements,
    codeRecommendations: proposal.codeRecommendations,
  };
}

function findBestProposalAttempt(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
): AutoresearchRunnerFeedbackAttempt | undefined {
  let best: AutoresearchRunnerFeedbackAttempt | undefined;
  for (const attempt of attempts) {
    if (!isTrustedProposalAttempt(attempt)) {
      continue;
    }
    if (!best || compareAttempts(attempt, best) > 0) {
      best = attempt;
    }
  }
  return best;
}

function isTrustedProposalAttempt(
  attempt: AutoresearchRunnerFeedbackAttempt | undefined,
): attempt is AutoresearchRunnerFeedbackAttempt {
  return Boolean(
    attempt
      && attempt.status === "proposed"
      && attempt.optimizerPatchPath
      && attempt.proposalPath,
  );
}

function compareAttempts(
  left: AutoresearchRunnerFeedbackAttempt,
  right: AutoresearchRunnerFeedbackAttempt,
): number {
  const score = (attempt: AutoresearchRunnerFeedbackAttempt): [number, number, number, number] => [
    attempt.selectedSignalCount ?? 0,
    attempt.promotedCaseCount ?? 0,
    attempt.actionableCount ?? 0,
    attempt.offset,
  ];

  const leftScore = score(left);
  const rightScore = score(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    const difference = leftScore[index]! - rightScore[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

async function listWorkingTreeFilesInRepo(repoRoot: string): Promise<string[]> {
  return await listWorkingTreeFiles(repoRoot);
}

function determineStatus(
  feedback: AutoresearchRunnerFeedback,
): AutoresearchRunnerRun["status"] {
  switch (feedback.action) {
    case "proposal_ready":
      return "proposal_ready";
    case "no_proposal":
      return "no_proposal";
    case "blocked":
      return "blocked";
    default:
      return "invalid";
  }
}

function buildStatusSnapshot(options: {
  generatedAt: string;
  options: AutoresearchRunCommandOptions;
  attempts: readonly AutoresearchRunnerFeedbackAttempt[];
  remainingSlices: readonly Slice[];
  currentSlice:
    | {
      index: number;
      offset: number;
      limit: number;
    }
    | undefined;
  lastProgressAt: string;
  currentSliceStartedAt: string | undefined;
  phase: AutoresearchRunStatusSnapshot["phase"];
  finalStatus?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
  runPath?: string;
  runMarkdownPath?: string;
  note?: string;
}): AutoresearchRunStatusSnapshot {
  const completedSlices = options.attempts.length;
  const updatedAt = new Date().toISOString();
  const hasInflightSlice = Boolean(options.currentSlice);
  const activeSliceElapsedSeconds = options.currentSliceStartedAt
    ? Math.max(
      0,
      Math.round(
        (Date.parse(updatedAt) - Date.parse(options.currentSliceStartedAt)) / 1000,
      ),
    )
    : undefined;
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    updatedAt,
    lastProgressAt: options.lastProgressAt,
    phase: options.phase,
    dataset: options.options.dataset,
    split: options.options.split,
    provider: options.options.provider,
    reviewerProvider: options.options.reviewerProvider,
    optimizerProvider: options.options.optimizerProvider,
    reviewConcurrency: options.options.reviewConcurrency,
    offset: options.options.offset,
    limit: options.options.limit,
    maxSlices: options.options.maxSlices,
    attemptedSlices: completedSlices + (options.currentSlice ? 1 : 0),
    completedSlices,
    remainingSlices: options.remainingSlices.length,
    windowPercent: calculateAutoresearchWindowPercent(
      completedSlices,
      options.options.maxSlices,
    ),
    windowPercentIncludingInflight: calculateAutoresearchWindowPercentIncludingInflight(
      completedSlices,
      options.options.maxSlices,
      hasInflightSlice,
    ),
    ...(options.currentSlice ? { currentSlice: options.currentSlice } : {}),
    ...(options.currentSliceStartedAt ? { currentSliceStartedAt: options.currentSliceStartedAt } : {}),
    ...(activeSliceElapsedSeconds !== undefined ? { activeSliceElapsedSeconds } : {}),
    ...(options.finalStatus ? { finalStatus: options.finalStatus } : {}),
    ...(options.selectedProposalPath ? { selectedProposalPath: options.selectedProposalPath } : {}),
    ...(options.selectedPatchPath ? { selectedPatchPath: options.selectedPatchPath } : {}),
    ...(options.runPath ? { runPath: options.runPath } : {}),
    ...(options.runMarkdownPath ? { runMarkdownPath: options.runMarkdownPath } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
}

async function writeStatusSnapshot(
  filePath: string | undefined,
  snapshot: AutoresearchRunStatusSnapshot,
): Promise<void> {
  if (!filePath) {
    return;
  }

  await writeAutoresearchRunStatusSnapshot(filePath, snapshot);
}

function logAttempt(prefix: string, attempt: AutoresearchRunnerFeedbackAttempt): void {
  logProgress([
    prefix,
    `status=${attempt.status}`,
    ...(attempt.actionableCount !== undefined ? [`actionable=${attempt.actionableCount}`] : []),
    ...(attempt.selectedSignalCount !== undefined ? [`signals=${attempt.selectedSignalCount}`] : []),
    ...(attempt.promotedCaseCount !== undefined ? [`promoted=${attempt.promotedCaseCount}`] : []),
    ...(attempt.optimizerStatus ? [`optimizer=${attempt.optimizerStatus}`] : []),
    ...(attempt.proposalPath ? [`proposal=${attempt.proposalPath}`] : []),
    ...(attempt.optimizerPatchPath ? [`patch=${attempt.optimizerPatchPath}`] : []),
  ].join(" "));
}

function logProgress(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
}

function compactLogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export const DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY = DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY;
