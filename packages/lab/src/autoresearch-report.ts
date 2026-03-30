import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OfflineReviewBatchReport } from "./offline-review-batch.js";
import type { AutoresearchOptimizerRun } from "./autoresearch-optimizer.js";
import type {
  AutoresearchProposalCodeRecommendation,
  AutoresearchProposalIntentStatement,
  AutoresearchProposalRun,
  AutoresearchProposalSignal,
} from "./autoresearch-proposal.js";
import type { AutoresearchRunnerFeedbackAttempt, AutoresearchRunnerRun } from "./autoresearch-runner.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import { loadSessionBundle } from "./session-bundle.js";

export const AUTORESEARCH_FINAL_REPORT_SCHEMA_VERSION = 1 as const;

export const DEFAULT_AUTORESEARCH_REPORTS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
  "reports",
);

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
    ? await loadJsonFile<AutoresearchProposalRun>(path.resolve(repoRoot, proposalPath))
    : undefined;
  const attemptProposals = runnerRun
    ? await loadAttemptProposals(runnerRun, repoRoot, proposalPath)
    : [];
  const batchReport = proposal?.artifacts.batchReportPath
    ? await loadJsonFile<OfflineReviewBatchReport>(path.resolve(repoRoot, proposal.artifacts.batchReportPath))
    : undefined;
  const optimizerRun = proposal?.artifacts.optimizerRunPath
    ? await loadJsonFile<AutoresearchOptimizerRun>(path.resolve(repoRoot, proposal.artifacts.optimizerRunPath))
    : undefined;

  const coverage = attemptProposals.length > 0
    ? await summarizeProposalCoverage(attemptProposals, repoRoot)
    : await summarizeBatchCoverage(batchReport, repoRoot);
  const aggregateSummary = attemptProposals.length > 0
    ? summarizeProposalRuns(attemptProposals)
    : proposal?.summary;
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
    }),
    source,
    runSummary: {
      bundleCount: coverage.bundleCount ?? aggregateSummary?.bundleCount ?? 0,
      sessionCount: coverage.sessionCount,
      replayStepCount: coverage.replayStepCount,
      sourceEventStepCount: coverage.sourceEventStepCount,
      submitStepCount: coverage.submitStepCount,
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
    majorDisagreements: (proposal?.signals ?? [])
      .slice(0, 5)
      .map((signal) => summarizeSignal(signal)),
    attempts: (runnerRun?.feedback?.attempts ?? []).map((attempt) => ({
      offset: attempt.offset,
      limit: attempt.limit,
      status: attempt.status,
      ...(attempt.actionableCount !== undefined ? { actionableCount: attempt.actionableCount } : {}),
      ...(attempt.selectedSignalCount !== undefined ? { selectedSignalCount: attempt.selectedSignalCount } : {}),
      ...(attempt.promotedCaseCount !== undefined ? { promotedCaseCount: attempt.promotedCaseCount } : {}),
      ...(attempt.optimizerStatus ? { optimizerStatus: attempt.optimizerStatus } : {}),
    })),
    intentStatements: proposal?.intentStatements ?? [],
    codeRecommendations: proposal?.codeRecommendations ?? [],
    ...(optimizerRun
      ? {
          optimizer: {
            status: optimizerRun.status,
            beforeMismatchCount: optimizerRun.summary.beforeMismatchCount,
            afterMismatchCount: optimizerRun.summary.afterMismatchCount,
            beforeInvariantMismatchCount: optimizerRun.summary.beforeInvariantMismatchCount,
            afterInvariantMismatchCount: optimizerRun.summary.afterInvariantMismatchCount,
            autoresearchEvaluate: optimizerRun.gates.autoresearchEvaluate,
            ...(optimizerRun.gates.judgmentBattle !== undefined
              ? { judgmentBattle: optimizerRun.gates.judgmentBattle }
              : {}),
            ...(optimizerRun.gates.releaseCheck !== undefined
              ? { releaseCheck: optimizerRun.gates.releaseCheck }
              : {}),
            changedFiles: optimizerRun.changes.changedFiles,
            disallowedFiles: optimizerRun.changes.disallowedFiles,
          },
        }
      : {}),
    notes,
  };
}

export function defaultAutoresearchFinalReportPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_REPORTS_DIR,
): string {
  return path.join(directory, `autoresearch-report-${safeTimestamp(generatedAt)}.json`);
}

export function defaultAutoresearchFinalReportMarkdownPath(reportPath: string): string {
  return reportPath.replace(/\.json$/i, ".md");
}

export async function writeAutoresearchFinalReport(
  filePath: string,
  report: AutoresearchFinalReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderAutoresearchFinalReportMarkdown(
  report: AutoresearchFinalReport,
): string {
  const lines: string[] = [
    "# Aperture Lab F-Stop Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    "",
    "## Recommendation",
    "",
    report.recommendation,
    "",
    "## Run Summary",
    "",
    `- session files: ${report.runSummary.bundleCount}`,
    `- sessions: ${report.runSummary.sessionCount}`,
    `- replay steps: ${report.runSummary.replayStepCount}`,
    `- source-event steps: ${report.runSummary.sourceEventStepCount}`,
    `- submit steps: ${report.runSummary.submitStepCount}`,
  ];

  if (report.runSummary.cleanCount !== undefined) {
    lines.push(`- clean sessions: ${report.runSummary.cleanCount}`);
  }
  if (report.runSummary.disagreementBundleCount !== undefined) {
    lines.push(`- sessions with disagreements: ${report.runSummary.disagreementBundleCount}`);
  }
  if (report.runSummary.errorCount !== undefined) {
    lines.push(`- session review errors: ${report.runSummary.errorCount}`);
  }
  if (report.runSummary.actionableCount !== undefined) {
    lines.push(`- actionable disagreements: ${report.runSummary.actionableCount}`);
  }
  if (report.runSummary.selectedSignalCount !== undefined) {
    lines.push(`- selected signals: ${report.runSummary.selectedSignalCount}`);
  }
  if (report.runSummary.promotedCaseCount !== undefined) {
    lines.push(`- promoted cases: ${report.runSummary.promotedCaseCount}`);
  }

  lines.push("", "## Major Disagreements", "");
  if (report.majorDisagreements.length === 0) {
    lines.push("- (none)");
  } else {
    for (const disagreement of report.majorDisagreements) {
      lines.push(
        `- ${disagreement.focusArea} (${disagreement.owner}): ${disagreement.apertureValue} -> ${disagreement.expectedValue} across ${disagreement.sessionCount} session(s)`,
      );
      if (disagreement.targets.length > 0) {
        lines.push(`  targets: ${disagreement.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Intent Statements", "");
  if (report.intentStatements.length === 0) {
    lines.push("- (none)");
  } else {
    for (const intent of report.intentStatements) {
      lines.push(`- ${intent.statement}`);
      if (intent.targets.length > 0) {
        lines.push(`  targets: ${intent.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Code Recommendations", "");
  if (report.codeRecommendations.length === 0) {
    lines.push("- (none)");
  } else {
    for (const recommendation of report.codeRecommendations) {
      lines.push(`- ${recommendation.summary}`);
      if (recommendation.recommendedFiles.length > 0) {
        lines.push(`  files: ${recommendation.recommendedFiles.join(", ")}`);
      }
      if (recommendation.patchPath) {
        lines.push(`  patch: ${recommendation.patchPath}`);
      }
    }
  }

  lines.push("", "## Batches", "");
  if (report.attempts.length === 0) {
    lines.push("- (none)");
  } else {
    for (const attempt of report.attempts) {
      lines.push(
        `- batch offset=${attempt.offset}, size=${attempt.limit}, status=${attempt.status}${attempt.actionableCount !== undefined ? `, actionable=${attempt.actionableCount}` : ""}${attempt.selectedSignalCount !== undefined ? `, signals=${attempt.selectedSignalCount}` : ""}${attempt.promotedCaseCount !== undefined ? `, promoted=${attempt.promotedCaseCount}` : ""}${attempt.optimizerStatus ? `, optimizer=${attempt.optimizerStatus}` : ""}`,
      );
    }
  }

  if (report.optimizer) {
    lines.push("", "## Optimizer", "");
    lines.push(`- status: ${report.optimizer.status}`);
    lines.push(`- mismatches: ${report.optimizer.beforeMismatchCount} -> ${report.optimizer.afterMismatchCount}`);
    lines.push(`- invariant mismatches: ${report.optimizer.beforeInvariantMismatchCount} -> ${report.optimizer.afterInvariantMismatchCount}`);
    lines.push(`- autoresearch evaluate: ${formatBoolean(report.optimizer.autoresearchEvaluate)}`);
    if (report.optimizer.judgmentBattle !== undefined) {
      lines.push(`- judgment battle: ${formatBoolean(report.optimizer.judgmentBattle)}`);
    }
    if (report.optimizer.releaseCheck !== undefined) {
      lines.push(`- release check: ${formatBoolean(report.optimizer.releaseCheck)}`);
    }
    if (report.optimizer.changedFiles.length > 0) {
      lines.push(`- changed files: ${report.optimizer.changedFiles.join(", ")}`);
    }
    if (report.optimizer.disallowedFiles.length > 0) {
      lines.push(`- disallowed files: ${report.optimizer.disallowedFiles.join(", ")}`);
    }
  }

  lines.push("", "## Artifacts", "");
  if (report.source.runnerRunPath) {
    lines.push(`- runner run: ${report.source.runnerRunPath}`);
  }
  if (report.source.proposalPath) {
    lines.push(`- proposal: ${report.source.proposalPath}`);
  }
  if (report.source.batchReportPath) {
    lines.push(`- batch report: ${report.source.batchReportPath}`);
  }
  if (report.source.optimizerRunPath) {
    lines.push(`- optimizer run: ${report.source.optimizerRunPath}`);
  }
  if (report.source.patchPath) {
    lines.push(`- patch: ${report.source.patchPath}`);
  }

  if (report.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...report.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
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
      disagreementBundleCount: summary.disagreementBundleCount + proposal.run.summary.disagreementBundleCount,
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

function summarizeSignal(signal: AutoresearchProposalSignal): AutoresearchFinalReport["majorDisagreements"][number] {
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

function buildRecommendation(input: {
  runnerRun?: AutoresearchRunnerRun;
  proposal?: AutoresearchProposalRun;
  optimizerRun?: AutoresearchOptimizerRun;
}): string {
  if (input.proposal?.artifacts.optimizerPatchPath || input.runnerRun?.artifacts.selectedPatchPath) {
    return "Review the proposed patch and intent statements. F-Stop found repeated signal and produced a bounded code recommendation with a surviving diff.";
  }
  if (input.proposal?.status === "no_change") {
    return "Review the major disagreements and intent statements. F-Stop found repeated signal strong enough to promote, but no durable patch survived the optimizer and gate loop.";
  }
  if (input.proposal?.status === "no_signal") {
    return "Discovery completed without enough repeated high-confidence signal to justify promotion or optimization. No code change is recommended from this run.";
  }
  if (input.runnerRun?.status === "blocked") {
    return "The run was blocked before a trustworthy proposal could be produced. Review the notes and runner attempts before rerunning.";
  }
  if (input.optimizerRun && !input.optimizerRun.summary.improved) {
    return "The optimizer ran, but the bounded patch surface did not improve the calibration score cleanly. Review the disagreement patterns before widening the search.";
  }
  return "Review the run summary and notes. This run did not produce a stronger recommendation than the existing calibration surface.";
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null) {
    return "null";
  }
  return value;
}

function formatBoolean(value: boolean): string {
  return value ? "pass" : "fail";
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
