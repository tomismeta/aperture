import {
  type AutoresearchGateName,
  type AutoresearchRunStatusSnapshot,
  calculateAutoresearchWindowPercent,
  calculateAutoresearchWindowPercentIncludingInflight,
} from "./autoresearch-campaign.js";
import { type AutoresearchProposalRun } from "./autoresearch-proposal.js";
import {
  type AutoresearchRunnerFeedback,
  type AutoresearchRunnerFeedbackAttempt,
  type AutoresearchRunnerProposalSnapshot,
  type AutoresearchRunnerRetainedAttempt,
  type AutoresearchRunnerRetainedOutcome,
  type AutoresearchRunnerRun,
} from "./autoresearch-runner.js";
import type { AutoresearchRunCommandOptions } from "./autoresearch-run-command.js";

export type Slice = {
  offset: number;
  limit: number;
};

type SelectedProposalSnapshot = AutoresearchRunnerProposalSnapshot;

export const DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY = 2;
export const DETERMINISTIC_RUNNER_COMMAND = "deterministic sequential slice loop";

export function buildProposalReadyFeedback(
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

export function buildExhaustedFeedback(
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
  const allExhausted = attempts.length > 0 && attempts.every((attempt) => attempt.status === "exhausted");
  const retainedAttempt = findBestRetainedAttempt(attempts);
  if (retainedAttempt) {
    reasons.push(
      `Highest-signal retained slice offset ${retainedAttempt.offset} ended status=${retainedAttempt.status} with ${retainedAttempt.selectedSignalCount ?? 0} signal(s) and ${retainedAttempt.promotedCaseCount ?? 0} promoted case(s).`,
    );
  }
  return {
    action: allErrors ? "blocked" : (allExhausted ? "exhausted" : "no_proposal"),
    summary: allErrors
      ? "Every attempted slice failed before a proposal could be produced."
      : allExhausted
        ? "The run exhausted the available bundles before a proposal could be produced."
        : "Exhausted the slice budget without finding a proposal patch artifact.",
    reasons,
    commandsRun: [...commandsRun],
    attempts: [...attempts],
    recommendedNextStep: allErrors
      ? "Inspect the failed slice logs before re-running F-Stop."
      : allExhausted
        ? "Treat this as corpus exhaustion or empty-input handling rather than a semantic regression."
        : "Inspect the highest-signal no_change slices before expanding the slice budget.",
  };
}

export function createSlicePlan(offset: number, limit: number, maxSlices: number): Slice[] {
  return Array.from({ length: Math.max(0, maxSlices) }, (_, index) => ({
    offset: offset + index * limit,
    limit,
  }));
}

export function buildProposalCommand(
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

export function buildProposalArgs(
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
    ...(options.gateTimeoutSeconds ? ["--gate-timeout-seconds", String(options.gateTimeoutSeconds)] : []),
    ...(options.skipJudgmentBattle ? ["--skip-judgment-battle"] : []),
    ...(options.skipReleaseCheck ? ["--skip-release-check"] : []),
  ];
}

export function findBestProposalAttempt(
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

export function shouldRetainProposalSnapshot(
  proposalRun: AutoresearchProposalRun,
): boolean {
  return proposalRun.summary.selectedSignalCount > 0
    || proposalRun.intentStatements.length > 0
    || proposalRun.codeRecommendations.length > 0;
}

export function findSelectedProposalSnapshot(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
  selectedProposalPath: string | undefined,
): SelectedProposalSnapshot | undefined {
  if (selectedProposalPath) {
    const selectedAttempt = attempts.find((attempt) => attempt.proposalPath === selectedProposalPath);
    if (selectedAttempt?.proposal) {
      return selectedAttempt.proposal;
    }
  }

  return findBestRetainedAttempt(attempts)?.proposal;
}

export function buildRetainedAttempts(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
  maxAttempts = 3,
): readonly AutoresearchRunnerRetainedAttempt[] {
  return attempts
    .filter((attempt): attempt is AutoresearchRunnerFeedbackAttempt & { proposal: SelectedProposalSnapshot } => Boolean(attempt.proposal))
    .sort((left, right) => compareAttempts(right, left))
    .slice(0, maxAttempts)
    .map((attempt) => ({
      offset: attempt.offset,
      limit: attempt.limit,
      status: attempt.status,
      ...(attempt.actionableCount !== undefined ? { actionableCount: attempt.actionableCount } : {}),
      ...(attempt.selectedSignalCount !== undefined ? { selectedSignalCount: attempt.selectedSignalCount } : {}),
      ...(attempt.promotedCaseCount !== undefined ? { promotedCaseCount: attempt.promotedCaseCount } : {}),
      ...(attempt.optimizerStatus ? { optimizerStatus: attempt.optimizerStatus } : {}),
      retainedOutcome: attempt.retainedOutcome ?? "signal_only",
      ...(attempt.proposalPath ? { proposal: attempt.proposalPath } : {}),
      ...(attempt.batchReportPath ? { batch: attempt.batchReportPath } : {}),
      ...(attempt.optimizerRunPath ? { optimizer: attempt.optimizerRunPath } : {}),
      ...(attempt.optimizerPatchPath ? { patch: attempt.optimizerPatchPath } : {}),
      snapshot: attempt.proposal,
    }));
}

export function determineRetainedOutcome(
  proposalRun: AutoresearchProposalRun,
): AutoresearchRunnerRetainedOutcome | undefined {
  if (!shouldRetainProposalSnapshot(proposalRun)) {
    return undefined;
  }
  if (proposalRun.status === "proposed") {
    return "patch_ready";
  }
  if (proposalRun.status === "optimizer_clean") {
    return "optimizer_clean";
  }
  if (proposalRun.optimizer?.status === "gate_blocked") {
    return "gate_blocked";
  }
  if (proposalRun.status === "no_change") {
    return proposalRun.artifacts.optimizerPatchPath ? "no_change_patch_attempted" : "no_change_no_edits";
  }
  return "signal_only";
}

export function determineStatus(
  feedback: AutoresearchRunnerFeedback,
): AutoresearchRunnerRun["status"] {
  switch (feedback.action) {
    case "proposal_ready":
      return "proposal_ready";
    case "no_proposal":
      return "no_proposal";
    case "blocked":
      return "blocked";
    case "exhausted":
      return "exhausted";
    default:
      return "invalid";
  }
}

export function buildStatusSnapshot(options: {
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
  currentGate: AutoresearchGateName | undefined;
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
    ...(options.currentGate ? { currentGate: options.currentGate } : {}),
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

export function logAttempt(prefix: string, attempt: AutoresearchRunnerFeedbackAttempt): void {
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

export function logProgress(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
}

export function compactLogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function findBestRetainedAttempt(
  attempts: readonly AutoresearchRunnerFeedbackAttempt[],
): AutoresearchRunnerFeedbackAttempt | undefined {
  let best: AutoresearchRunnerFeedbackAttempt | undefined;
  for (const attempt of attempts) {
    if (!attempt.proposal) {
      continue;
    }
    if (!best || compareAttempts(attempt, best) > 0) {
      best = attempt;
    }
  }
  return best;
}
