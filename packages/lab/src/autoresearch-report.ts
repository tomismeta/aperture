import path from "node:path";

import { AUTORESEARCH_FINAL_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import type { OfflineReviewBatchReport } from "./offline-review-batch.js";
import type { AutoresearchOptimizerRun } from "./autoresearch-optimizer.js";
import type {
  AutoresearchProposalCodeRecommendation,
  AutoresearchProposalIntentStatement,
  AutoresearchProposalRun,
  AutoresearchProposalSignal,
} from "./autoresearch-proposal.js";
import { projectAutoresearchProposalSnapshot } from "./autoresearch-proposal-snapshot.js";
import type {
  AutoresearchRunnerProposalSnapshot,
  AutoresearchRunnerRetainedAttempt,
  AutoresearchRunnerRun,
} from "./autoresearch-runner.js";
import { loadJsonFile, tryLoadJsonFile } from "./autoresearch-report-files.js";
import { renderValue } from "./autoresearch-report-render.js";
import { loadSessionBundle } from "./session-bundle.js";
import type { WorkflowTargetMetadataRollup } from "./workflow-metadata.js";
export { AUTORESEARCH_FINAL_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";

export type AutoresearchFinalReport = {
  schemaVersion: typeof AUTORESEARCH_FINAL_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  status: string;
  recommendation: string;
  source: {
    runnerRunPath?: string;
    proposalPath?: string;
    batchReportPath?: string;
    optimizerRunPath?: string;
    patchPath?: string;
  };
  runSummary: {
    bundleCount: number;
    sessionCount: number;
    replayStepCount: number;
    sourceEventStepCount: number;
    submitStepCount: number;
    workflow?: WorkflowTargetMetadataRollup;
    cleanCount?: number;
    disagreementBundleCount?: number;
    errorCount?: number;
    actionableCount?: number;
    selectedSignalCount?: number;
    promotedCaseCount?: number;
  };
  majorDisagreements: Array<{
    focusArea: string;
    owner: string;
    apertureValue: string;
    expectedValue: string;
    sessionCount: number;
    disagreementCount: number;
    targets: string[];
  }>;
  attempts: Array<{
    offset: number;
    limit: number;
    status: string;
    actionableCount?: number;
    selectedSignalCount?: number;
    promotedCaseCount?: number;
    optimizerStatus?: string;
  }>;
  retainedAttempts: Array<{
    offset: number;
    limit: number;
    status: string;
    retainedOutcome: string;
    actionableCount?: number;
    selectedSignalCount?: number;
    promotedCaseCount?: number;
    optimizerStatus?: string;
    proposal?: string;
    batch?: string;
    optimizer?: string;
    patch?: string;
    strongestSignals: Array<{
      focusArea: string;
      owner: string;
      apertureValue: string;
      expectedValue: string;
      sessionCount: number;
      disagreementCount: number;
      targets: string[];
    }>;
    intentStatements: readonly AutoresearchProposalIntentStatement[];
    codeRecommendations: readonly AutoresearchProposalCodeRecommendation[];
    optimizerSummary?: {
      status: string;
      beforeMismatchCount: number;
      afterMismatchCount: number;
      beforeInvariantMismatchCount: number;
      afterInvariantMismatchCount: number;
      changedFiles: readonly string[];
      disallowedFiles: readonly string[];
      judgmentBattle?: boolean;
      releaseCheck?: boolean;
      patchPath?: string;
    };
  }>;
  intentStatements: readonly AutoresearchProposalIntentStatement[];
  codeRecommendations: readonly AutoresearchProposalCodeRecommendation[];
  optimizer?: {
    status: string;
    beforeMismatchCount: number;
    afterMismatchCount: number;
    beforeInvariantMismatchCount: number;
    afterInvariantMismatchCount: number;
    autoresearchEvaluate: boolean;
    judgmentBattle?: boolean;
    releaseCheck?: boolean;
    changedFiles: string[];
    disallowedFiles: string[];
  };
  notes: string[];
};

export async function synthesizeAutoresearchFinalReport(options: {
  generatedAt?: string;
  runnerRunPath?: string;
  proposalPath?: string;
  repoRoot?: string;
}): Promise<AutoresearchFinalReport> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const runnerRun = options.runnerRunPath
    ? await loadJsonFile<AutoresearchRunnerRun>(path.resolve(repoRoot, options.runnerRunPath))
    : undefined;
  const proposalPath = options.proposalPath ?? runnerRun?.artifacts.selectedProposalPath;
  const proposal = proposalPath
    ? await tryLoadJsonFile<AutoresearchProposalRun>(path.resolve(repoRoot, proposalPath))
    : undefined;
  const selectedProposal = resolveSelectedProposalSnapshot({
    ...(runnerRun ? { runnerRun } : {}),
    ...(proposal ? { proposal } : {}),
  });
  const attemptProposals = runnerRun
    ? await loadAttemptProposals(runnerRun, repoRoot, proposalPath)
    : [];
  const batchReport = proposal?.artifacts.batchReportPath
    ? await loadJsonFile<OfflineReviewBatchReport>(
        path.resolve(repoRoot, proposal.artifacts.batchReportPath),
      )
    : undefined;
  const optimizerRun = proposal?.artifacts.optimizerRunPath
    ? await loadJsonFile<AutoresearchOptimizerRun>(
        path.resolve(repoRoot, proposal.artifacts.optimizerRunPath),
      )
    : undefined;
  const retainedAttempts = summarizeRetainedAttempts(runnerRun?.retainedAttempts ?? []);

  const coverage =
    attemptProposals.length > 0
      ? await summarizeProposalCoverage(attemptProposals, repoRoot)
      : await summarizeBatchCoverage(batchReport, repoRoot);
  const aggregateSummary =
    attemptProposals.length > 0 ? summarizeProposalRuns(attemptProposals) : proposal?.summary;
  const notes = [
    ...(runnerRun?.notes ?? []),
    ...(proposal?.notes ?? []),
    ...(optimizerRun?.notes ?? []),
  ];
  const source: AutoresearchFinalReport["source"] = {};

  if (options.runnerRunPath) {
    source.runnerRunPath = options.runnerRunPath;
  }
  if (proposalPath) {
    source.proposalPath = proposalPath;
  }
  if (proposal?.artifacts.batchReportPath) {
    source.batchReportPath = proposal.artifacts.batchReportPath;
  }
  if (proposal?.artifacts.optimizerRunPath) {
    source.optimizerRunPath = proposal.artifacts.optimizerRunPath;
  }
  const selectedPatchPath =
    proposal?.artifacts.optimizerPatchPath ?? runnerRun?.artifacts.selectedPatchPath;
  if (selectedPatchPath) {
    source.patchPath = selectedPatchPath;
  }

  return {
    schemaVersion: AUTORESEARCH_FINAL_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: proposal?.status ?? runnerRun?.status ?? "unknown",
    recommendation: buildRecommendation({
      ...(runnerRun ? { runnerRun } : {}),
      ...(proposal ? { proposal } : {}),
      ...(optimizerRun ? { optimizerRun } : {}),
      ...(selectedProposal ? { selectedProposal } : {}),
    }),
    source,
    runSummary: {
      bundleCount: coverage.bundleCount ?? aggregateSummary?.bundleCount ?? 0,
      sessionCount: coverage.sessionCount,
      replayStepCount: coverage.replayStepCount,
      sourceEventStepCount: coverage.sourceEventStepCount,
      submitStepCount: coverage.submitStepCount,
      ...(batchReport?.summary.workflow ? { workflow: batchReport.summary.workflow } : {}),
      ...(aggregateSummary
        ? {
            cleanCount: aggregateSummary.cleanCount,
            disagreementBundleCount: aggregateSummary.disagreementBundleCount,
            errorCount: aggregateSummary.errorCount,
            actionableCount: aggregateSummary.actionableCount,
            selectedSignalCount: aggregateSummary.selectedSignalCount,
            promotedCaseCount: aggregateSummary.promotedCaseCount,
          }
        : {}),
    },
    majorDisagreements: (proposal?.signals ?? selectedProposal?.signals ?? [])
      .slice(0, 5)
      .map((signal) => summarizeSignal(signal)),
    attempts: (runnerRun?.feedback?.attempts ?? []).map((attempt) => ({
      offset: attempt.offset,
      limit: attempt.limit,
      status: attempt.status,
      ...(attempt.actionableCount !== undefined
        ? { actionableCount: attempt.actionableCount }
        : {}),
      ...(attempt.selectedSignalCount !== undefined
        ? { selectedSignalCount: attempt.selectedSignalCount }
        : {}),
      ...(attempt.promotedCaseCount !== undefined
        ? { promotedCaseCount: attempt.promotedCaseCount }
        : {}),
      ...(attempt.optimizerStatus ? { optimizerStatus: attempt.optimizerStatus } : {}),
    })),
    retainedAttempts,
    intentStatements: selectedProposal?.intentStatements ?? [],
    codeRecommendations: selectedProposal?.codeRecommendations ?? [],
    ...(optimizerRun || selectedProposal?.optimizer
      ? {
          optimizer: {
            status: optimizerRun?.status ?? selectedProposal?.optimizer?.status ?? "unknown",
            beforeMismatchCount:
              optimizerRun?.summary.beforeMismatchCount ??
              selectedProposal?.optimizer?.beforeMismatchCount ??
              0,
            afterMismatchCount:
              optimizerRun?.summary.afterMismatchCount ??
              selectedProposal?.optimizer?.afterMismatchCount ??
              0,
            beforeInvariantMismatchCount:
              optimizerRun?.summary.beforeInvariantMismatchCount ??
              selectedProposal?.optimizer?.beforeInvariantMismatchCount ??
              0,
            afterInvariantMismatchCount:
              optimizerRun?.summary.afterInvariantMismatchCount ??
              selectedProposal?.optimizer?.afterInvariantMismatchCount ??
              0,
            autoresearchEvaluate: optimizerRun?.gates.autoresearchEvaluate ?? true,
            ...(optimizerRun?.gates.judgmentBattle !== undefined
              ? { judgmentBattle: optimizerRun.gates.judgmentBattle }
              : selectedProposal?.optimizer?.judgmentBattle !== undefined
                ? { judgmentBattle: selectedProposal.optimizer.judgmentBattle }
                : {}),
            ...(optimizerRun?.gates.releaseCheck !== undefined
              ? { releaseCheck: optimizerRun.gates.releaseCheck }
              : selectedProposal?.optimizer?.releaseCheck !== undefined
                ? { releaseCheck: selectedProposal.optimizer.releaseCheck }
                : {}),
            changedFiles: [
              ...(optimizerRun?.changes.changedFiles ??
                selectedProposal?.optimizer?.changedFiles ??
                []),
            ],
            disallowedFiles: [
              ...(optimizerRun?.changes.disallowedFiles ??
                selectedProposal?.optimizer?.disallowedFiles ??
                []),
            ],
          },
        }
      : {}),
    notes,
  };
}

async function summarizeBatchCoverage(
  batchReport: OfflineReviewBatchReport | undefined,
  repoRoot: string,
): Promise<{
  bundleCount?: number;
  sessionCount: number;
  replayStepCount: number;
  sourceEventStepCount: number;
  submitStepCount: number;
}> {
  if (!batchReport) {
    return {
      sessionCount: 0,
      replayStepCount: 0,
      sourceEventStepCount: 0,
      submitStepCount: 0,
    };
  }

  let replayStepCount = 0;
  let sourceEventStepCount = 0;
  let submitStepCount = 0;
  const sessionIds = new Set<string>();

  for (const bundlePath of batchReport.input.bundles) {
    try {
      const bundle = await loadSessionBundle(path.resolve(repoRoot, bundlePath));
      sessionIds.add(bundle.sessionId);
      replayStepCount += bundle.outcomes.totalSteps;
      for (const step of bundle.steps) {
        if (step.kind === "publishSource") {
          sourceEventStepCount += 1;
        }
        if (step.kind === "submit") {
          submitStepCount += 1;
        }
      }
    } catch {
      continue;
    }
  }

  return {
    bundleCount: batchReport.summary.bundleCount,
    sessionCount: sessionIds.size || batchReport.summary.bundleCount,
    replayStepCount,
    sourceEventStepCount,
    submitStepCount,
  };
}

async function loadAttemptProposals(
  runnerRun: AutoresearchRunnerRun,
  repoRoot: string,
  selectedProposalPath?: string,
): Promise<Array<{ path: string; run: AutoresearchProposalRun }>> {
  const uniquePaths = new Set<string>();
  if (selectedProposalPath) {
    uniquePaths.add(path.resolve(repoRoot, selectedProposalPath));
  }
  for (const attempt of runnerRun.feedback?.attempts ?? []) {
    if (attempt.proposalPath) {
      uniquePaths.add(path.resolve(repoRoot, attempt.proposalPath));
    }
  }

  const loaded: Array<{ path: string; run: AutoresearchProposalRun }> = [];
  for (const proposalPath of uniquePaths) {
    try {
      loaded.push({
        path: proposalPath,
        run: await loadJsonFile<AutoresearchProposalRun>(proposalPath),
      });
    } catch {
      continue;
    }
  }
  return loaded;
}

async function summarizeProposalCoverage(
  proposals: readonly { path: string; run: AutoresearchProposalRun }[],
  repoRoot: string,
): Promise<{
  bundleCount?: number;
  sessionCount: number;
  replayStepCount: number;
  sourceEventStepCount: number;
  submitStepCount: number;
}> {
  let bundleCount = 0;
  let replayStepCount = 0;
  let sourceEventStepCount = 0;
  let submitStepCount = 0;
  const sessionIds = new Set<string>();
  const seenBundlePaths = new Set<string>();

  for (const proposal of proposals) {
    if (!proposal.run.artifacts.batchReportPath) {
      continue;
    }

    let batchReport: OfflineReviewBatchReport;
    try {
      batchReport = await loadJsonFile<OfflineReviewBatchReport>(
        path.resolve(repoRoot, proposal.run.artifacts.batchReportPath),
      );
    } catch {
      continue;
    }

    for (const bundlePath of batchReport.input.bundles) {
      const absoluteBundlePath = path.resolve(repoRoot, bundlePath);
      if (seenBundlePaths.has(absoluteBundlePath)) {
        continue;
      }
      seenBundlePaths.add(absoluteBundlePath);
      try {
        const bundle = await loadSessionBundle(absoluteBundlePath);
        bundleCount += 1;
        sessionIds.add(bundle.sessionId);
        replayStepCount += bundle.outcomes.totalSteps;
        for (const step of bundle.steps) {
          if (step.kind === "publishSource") {
            sourceEventStepCount += 1;
          }
          if (step.kind === "submit") {
            submitStepCount += 1;
          }
        }
      } catch {
        continue;
      }
    }
  }

  return {
    bundleCount,
    sessionCount: sessionIds.size,
    replayStepCount,
    sourceEventStepCount,
    submitStepCount,
  };
}

function summarizeProposalRuns(
  proposals: readonly { path: string; run: AutoresearchProposalRun }[],
): AutoresearchProposalRun["summary"] | undefined {
  if (proposals.length === 0) {
    return undefined;
  }

  return proposals.reduce<AutoresearchProposalRun["summary"]>(
    (summary, proposal) => ({
      bundleCount: summary.bundleCount + proposal.run.summary.bundleCount,
      cleanCount: summary.cleanCount + proposal.run.summary.cleanCount,
      disagreementBundleCount:
        summary.disagreementBundleCount + proposal.run.summary.disagreementBundleCount,
      errorCount: summary.errorCount + proposal.run.summary.errorCount,
      actionableCount: summary.actionableCount + proposal.run.summary.actionableCount,
      selectedSignalCount: summary.selectedSignalCount + proposal.run.summary.selectedSignalCount,
      promotedCaseCount: summary.promotedCaseCount + proposal.run.summary.promotedCaseCount,
    }),
    {
      bundleCount: 0,
      cleanCount: 0,
      disagreementBundleCount: 0,
      errorCount: 0,
      actionableCount: 0,
      selectedSignalCount: 0,
      promotedCaseCount: 0,
    },
  );
}

function summarizeSignal(
  signal: Pick<
    AutoresearchProposalSignal,
    | "focusArea"
    | "owner"
    | "apertureValue"
    | "expectedValue"
    | "sessionCount"
    | "disagreementCount"
    | "targets"
  >,
): AutoresearchFinalReport["majorDisagreements"][number] {
  return {
    focusArea: signal.focusArea,
    owner: signal.owner,
    apertureValue: renderValue(signal.apertureValue),
    expectedValue: renderValue(signal.expectedValue),
    sessionCount: signal.sessionCount,
    disagreementCount: signal.disagreementCount,
    targets: [...signal.targets],
  };
}

function summarizeRetainedAttempts(
  attempts: readonly AutoresearchRunnerRetainedAttempt[],
): AutoresearchFinalReport["retainedAttempts"] {
  return attempts.map((attempt) => ({
    offset: attempt.offset,
    limit: attempt.limit,
    status: attempt.status,
    retainedOutcome: attempt.retainedOutcome,
    ...(attempt.actionableCount !== undefined ? { actionableCount: attempt.actionableCount } : {}),
    ...(attempt.selectedSignalCount !== undefined
      ? { selectedSignalCount: attempt.selectedSignalCount }
      : {}),
    ...(attempt.promotedCaseCount !== undefined
      ? { promotedCaseCount: attempt.promotedCaseCount }
      : {}),
    ...(attempt.optimizerStatus ? { optimizerStatus: attempt.optimizerStatus } : {}),
    ...(attempt.proposal ? { proposal: attempt.proposal } : {}),
    ...(attempt.batch ? { batch: attempt.batch } : {}),
    ...(attempt.optimizer ? { optimizer: attempt.optimizer } : {}),
    ...(attempt.patch ? { patch: attempt.patch } : {}),
    strongestSignals: attempt.snapshot.signals.slice(0, 3).map((signal) => ({
      focusArea: signal.focusArea,
      owner: signal.owner,
      apertureValue: renderValue(signal.apertureValue),
      expectedValue: renderValue(signal.expectedValue),
      sessionCount: signal.sessionCount,
      disagreementCount: signal.disagreementCount,
      targets: [...signal.targets],
    })),
    intentStatements: attempt.snapshot.intentStatements,
    codeRecommendations: attempt.snapshot.codeRecommendations,
    ...(attempt.snapshot.optimizer
      ? {
          optimizerSummary: {
            status: attempt.snapshot.optimizer.status,
            beforeMismatchCount: attempt.snapshot.optimizer.beforeMismatchCount,
            afterMismatchCount: attempt.snapshot.optimizer.afterMismatchCount,
            beforeInvariantMismatchCount: attempt.snapshot.optimizer.beforeInvariantMismatchCount,
            afterInvariantMismatchCount: attempt.snapshot.optimizer.afterInvariantMismatchCount,
            changedFiles: [...attempt.snapshot.optimizer.changedFiles],
            disallowedFiles: [...attempt.snapshot.optimizer.disallowedFiles],
            ...(attempt.snapshot.optimizer.judgmentBattle !== undefined
              ? { judgmentBattle: attempt.snapshot.optimizer.judgmentBattle }
              : {}),
            ...(attempt.snapshot.optimizer.releaseCheck !== undefined
              ? { releaseCheck: attempt.snapshot.optimizer.releaseCheck }
              : {}),
            ...(attempt.snapshot.optimizer.patchPath
              ? { patchPath: attempt.snapshot.optimizer.patchPath }
              : {}),
          },
        }
      : {}),
  }));
}

function buildRecommendation(input: {
  runnerRun?: AutoresearchRunnerRun;
  proposal?: AutoresearchProposalRun;
  optimizerRun?: AutoresearchOptimizerRun;
  selectedProposal?: AutoresearchRunnerProposalSnapshot;
}): string {
  if (
    input.proposal?.artifacts.optimizerPatchPath ||
    input.runnerRun?.artifacts.selectedPatchPath
  ) {
    return "Review the proposed patch and intent statements. F-Stop found repeated signal and produced a bounded code recommendation with a surviving diff.";
  }
  if ((input.proposal?.status ?? input.selectedProposal?.status) === "no_change") {
    return "Review the major disagreements and intent statements. F-Stop found repeated signal strong enough to promote, but no durable patch survived the optimizer and gate loop.";
  }
  if ((input.proposal?.status ?? input.selectedProposal?.status) === "no_signal") {
    return "Discovery completed without enough repeated high-confidence signal to justify promotion or optimization. No code change is recommended from this run.";
  }
  if (input.proposal?.status === "exhausted" || input.runnerRun?.status === "exhausted") {
    return "The run exhausted the available reviewable bundles before a trustworthy proposal could be produced. Treat this as end-of-data or empty-input handling, not a semantic regression.";
  }
  if (input.runnerRun?.status === "blocked") {
    return "The run was blocked before a trustworthy proposal could be produced. Review the notes and runner attempts before rerunning.";
  }
  if (input.optimizerRun && !input.optimizerRun.summary.improved) {
    return "The optimizer ran, but the bounded patch surface did not improve the calibration score cleanly. Review the disagreement patterns before widening the search.";
  }
  return "Review the run summary and notes. This run did not produce a stronger recommendation than the existing calibration surface.";
}

function resolveSelectedProposalSnapshot(input: {
  runnerRun?: AutoresearchRunnerRun;
  proposal?: AutoresearchProposalRun;
}): AutoresearchRunnerProposalSnapshot | undefined {
  if (input.proposal) {
    return projectAutoresearchProposalSnapshot(input.proposal);
  }
  return input.runnerRun?.selectedProposal;
}

export {
  DEFAULT_AUTORESEARCH_REPORTS_DIR,
  defaultAutoresearchFinalReportMarkdownPath,
  defaultAutoresearchFinalReportPath,
  writeAutoresearchFinalReport,
} from "./autoresearch-report-files.js";
export { renderAutoresearchFinalReportMarkdown } from "./autoresearch-report-render.js";
