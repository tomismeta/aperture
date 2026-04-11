import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type AutoresearchRunStatusSnapshot,
  type AutoresearchGateName,
  writeAutoresearchRunStatusSnapshot,
} from "./autoresearch-campaign.js";
import { runAutoresearchProposalCommand } from "./autoresearch-propose-command.js";
import {
  updateAutoresearchRetainedBacklog,
} from "./autoresearch-backlog.js";
import {
  AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION,
  defaultAutoresearchRunnerRunPath,
  renderAutoresearchRunnerRunMarkdown,
  writeAutoresearchRunnerRun,
  type AutoresearchRunnerFeedbackAttempt,
  type AutoresearchRunnerRun,
} from "./autoresearch-runner.js";
import { projectAutoresearchProposalSnapshot } from "./autoresearch-proposal-snapshot.js";
import { type PublicTrajectoryDataset, type PublicTrajectorySplit } from "./public-trajectories.js";
import {
  captureGitHeadSnapshot,
  ensureCleanWorktree,
  listWorkingTreeFiles,
  restoreGitHeadSnapshot,
} from "./autoresearch-workspace.js";
import {
  buildExhaustedFeedback,
  buildProposalCommand,
  buildProposalReadyFeedback,
  buildRetainedAttempts,
  buildStatusSnapshot,
  compactLogText,
  createSlicePlan,
  DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY,
  DETERMINISTIC_RUNNER_COMMAND,
  determineRetainedOutcome,
  determineStatus,
  findBestProposalAttempt,
  findSelectedProposalSnapshot,
  logAttempt,
  logProgress,
  shouldRetainProposalSnapshot,
  type Slice,
} from "./autoresearch-run-command-support.js";

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
  gateTimeoutSeconds?: number;
  skipJudgmentBattle?: boolean;
  skipReleaseCheck?: boolean;
};

export type AutoresearchRunCommandResult = {
  status: string;
  provider: AutoresearchRunnerProvider;
  runnerCommand: string;
  runPath: string;
  runMarkdownPath: string;
  backlogPath: string;
  backlogMarkdownPath: string;
  selectedProposalPath?: string;
  selectedBatchReportPath?: string;
  selectedOptimizerRunPath?: string;
  selectedPatchPath?: string;
};

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
  let currentGate: AutoresearchGateName | undefined;
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
    currentGate,
    phase: "running",
  }));

  if (directBatchReportPath || directBundlePaths.length > 0) {
    if (options.resolvedInput?.ingest) {
      const sourceLabel = options.resolvedInput.ingest.sourceKind === "fstop-session"
        ? "canonical F-Stop session"
        : "raw export";
      notes.push(
        `Prepared ${options.resolvedInput.ingest.bundleCount} bundle(s) from ${sourceLabel} ${options.resolvedInput.ingest.sourcePath} into ${options.resolvedInput.ingest.outputDirectory}.`,
      );
    }

    const attempt = await executeProposalAttempt(
      options,
      {
        ...(directBatchReportPath ? { batchReportPath: directBatchReportPath } : {}),
        ...(directBundlePaths.length > 0 ? { bundlePaths: directBundlePaths } : {}),
      },
      async (gate) => {
        currentGate = gate;
        lastProgressAt = new Date().toISOString();
        logProgress(gate ? `direct_attempt gate=${gate}` : "direct_attempt gate=completed");
        await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
          generatedAt,
          options,
          attempts,
          remainingSlices,
          currentSlice,
          lastProgressAt,
          currentSliceStartedAt,
          currentGate,
          phase: gate ? "gating" : "running",
          ...(gate ? { note: `Gate in progress: ${gate}.` } : {}),
        }));
      },
    );
    attempts.push(attempt);
    commandsRun.push(buildProposalCommand(options, {
      ...(directBatchReportPath ? { batchReportPath: directBatchReportPath } : {}),
      ...(directBundlePaths.length > 0 ? { bundlePaths: directBundlePaths } : {}),
    }));
    logAttempt("direct_attempt", attempt);
    notes.push("Direct file or bundle mode executed a single unattended proposal attempt.");
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
      logProgress(`slice=${sliceIndex} offset=${slice.offset} limit=${slice.limit} starting`);
      await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
        generatedAt,
        options,
        attempts,
        remainingSlices,
        currentSlice,
        lastProgressAt,
        currentSliceStartedAt,
        currentGate,
        phase: "running",
      }));

      try {
        const attempt = await executeProposalAttempt(options, slice, async (gate) => {
          currentGate = gate;
          lastProgressAt = new Date().toISOString();
          logProgress([
            `slice=${sliceIndex}`,
            `offset=${slice.offset}`,
            gate ? `gate=${gate}` : "gate=completed",
          ].join(" "));
          await writeStatusSnapshot(options.statusOutputPath, buildStatusSnapshot({
            generatedAt,
            options,
            attempts,
            remainingSlices,
            currentSlice,
            lastProgressAt,
            currentSliceStartedAt,
            currentGate,
            phase: gate ? "gating" : "running",
            ...(gate ? { note: `Gate in progress: ${gate}.` } : {}),
          }));
        });
        attempts.push(attempt);
        logAttempt(`slice=${sliceIndex} offset=${slice.offset}`, attempt);
        if (attempt.status === "exhausted") {
          notes.push(`Slice offset ${slice.offset} reported no remaining bundles to review; stopping the remaining slice budget early.`);
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          offset: slice.offset,
          limit: slice.limit,
          status: "error",
        });
        notes.push(`Slice offset ${slice.offset} failed: ${message}`);
        logProgress(`slice=${sliceIndex} offset=${slice.offset} status=error error=${compactLogText(message)}`);
      } finally {
        currentGate = undefined;
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
          currentGate,
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

  const selectedProposal = findSelectedProposalSnapshot(attempts, feedback.selectedProposalPath);
  const retainedAttempts = buildRetainedAttempts(attempts);
  if (selectedProposal && !feedback.selectedProposalPath) {
    notes.push("Retained the highest-signal non-winning slice intent for later review.");
  }
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
    ...(retainedAttempts.length > 0 ? { retainedAttempts } : {}),
    feedback,
    notes,
  };

  const retainedBacklog = await updateAutoresearchRetainedBacklog({
    run,
    runPath,
    runMarkdownPath,
  });
  run.artifacts.backlogPath = retainedBacklog.backlogPath;
  run.artifacts.backlogMarkdownPath = retainedBacklog.backlogMarkdownPath;

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
    currentGate: undefined,
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
    backlogPath: retainedBacklog.backlogPath,
    backlogMarkdownPath: retainedBacklog.backlogMarkdownPath,
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
  onGateChange?: (gate: AutoresearchGateName | undefined) => Promise<void>,
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
      ...(options.gateTimeoutSeconds ? { gateTimeoutSeconds: options.gateTimeoutSeconds } : {}),
      ...(options.skipJudgmentBattle !== undefined ? { skipJudgmentBattle: options.skipJudgmentBattle } : {}),
      ...(options.skipReleaseCheck !== undefined ? { skipReleaseCheck: options.skipReleaseCheck } : {}),
      ...(onGateChange ? { onGateChange } : {}),
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
    const retainedOutcome = determineRetainedOutcome(proposalRun);

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
      ...(retainedOutcome ? { retainedOutcome } : {}),
      ...(shouldRetainProposalSnapshot(proposalRun)
        ? { proposal: projectAutoresearchProposalSnapshot(proposalRun) }
        : {}),
    };
  } finally {
    await restoreGitHeadSnapshot(snapshot, process.cwd());
  }
}
async function listWorkingTreeFilesInRepo(repoRoot: string): Promise<string[]> {
  return await listWorkingTreeFiles(repoRoot);
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

export const DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY = DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY;
