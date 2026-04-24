import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AUTORESEARCH_PROPOSAL_RUN_SCHEMA_VERSION } from "./artifact-versions.js";
import {
  defaultAutoresearchCalibrationCasePath,
  promoteOfflineReviewReportToCalibrationCase,
  type AutoresearchCalibrationCase,
  type AutoresearchCalibrationSplit,
} from "./autoresearch-calibration.js";
import type { OfflineReviewBatchReport } from "./offline-review-batch.js";
import type {
  OfflineReviewConfidence,
  OfflineReviewDisagreement,
  OfflineReviewFocusArea,
  OfflineReviewRecommendationOwner,
  OfflineReviewRecommendationReport,
  OfflineReviewReport,
} from "./offline-review.js";
import type { AutoresearchOptimizerRun } from "./autoresearch-optimizer.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import type { WorkflowTargetMetadataRollup } from "./workflow-metadata.js";
export { AUTORESEARCH_PROPOSAL_RUN_SCHEMA_VERSION } from "./artifact-versions.js";

export const DEFAULT_AUTORESEARCH_PROPOSALS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
  "proposals",
);

export type AutoresearchProposalIntentStatement = {
  focusArea: OfflineReviewFocusArea;
  owner: OfflineReviewRecommendationOwner;
  statement: string;
  apertureValue: string | string[] | boolean | null;
  expectedValue: string | string[] | boolean | null;
  sessionCount: number;
  disagreementCount: number;
  targets: readonly string[];
};

export type AutoresearchProposalCodeRecommendation = {
  kind: "intent_only" | "patch";
  summary: string;
  recommendedFiles: readonly string[];
  reasons: readonly string[];
  targets: readonly string[];
  patchPath?: string;
  optimizerStatus?: AutoresearchOptimizerRun["status"];
  beforeMismatchCount?: number;
  afterMismatchCount?: number;
};

export type AutoresearchProposalSignal = {
  signature: string;
  focusArea: OfflineReviewFocusArea;
  owner: OfflineReviewRecommendationOwner;
  apertureValue: string | string[] | boolean | null;
  expectedValue: string | string[] | boolean | null;
  disagreementCount: number;
  sessionCount: number;
  sessions: readonly string[];
  reportPaths: readonly string[];
  targets: readonly string[];
  confidenceCounts: Record<OfflineReviewConfidence, number>;
  examples: ReadonlyArray<{
    sessionId: string;
    stepIndex: number;
    stepLabel?: string;
    confidence: OfflineReviewConfidence;
    recommendationPath?: string;
    rationale?: string;
  }>;
};

export type AutoresearchProposalPromotion = {
  sessionId: string;
  reportPath: string;
  split: AutoresearchCalibrationSplit;
  focusAreas: OfflineReviewFocusArea[];
  casePath: string;
  correctedCount: number;
  invariantCount: number;
  targets: string[];
};

export type AutoresearchProposalRunStatus =
  | "clean"
  | "exhausted"
  | "no_signal"
  | "proposed"
  | "no_change"
  | "optimizer_clean"
  | "error";

export type AutoresearchProposalRun = {
  schemaVersion: typeof AUTORESEARCH_PROPOSAL_RUN_SCHEMA_VERSION;
  generatedAt: string;
  status: AutoresearchProposalRunStatus;
  summary: {
    bundleCount: number;
    cleanCount: number;
    disagreementBundleCount: number;
    errorCount: number;
    actionableCount: number;
    selectedSignalCount: number;
    promotedCaseCount: number;
    workflow?: WorkflowTargetMetadataRollup;
  };
  artifacts: {
    batchReportPath: string;
    batchMarkdownPath?: string;
    candidateCalibrationDir?: string;
    optimizerRunPath?: string;
    optimizerRunMarkdownPath?: string;
    optimizerPatchPath?: string;
  };
  signals: AutoresearchProposalSignal[];
  intentStatements: AutoresearchProposalIntentStatement[];
  codeRecommendations: AutoresearchProposalCodeRecommendation[];
  promotions: AutoresearchProposalPromotion[];
  optimizer?: {
    status: AutoresearchOptimizerRun["status"];
    beforeMismatchCount: number;
    afterMismatchCount: number;
    beforeInvariantMismatchCount: number;
    afterInvariantMismatchCount: number;
    changedFiles: string[];
    disallowedFiles: string[];
    judgmentBattle?: boolean;
    releaseCheck?: boolean;
    patchPath?: string;
  };
  notes: string[];
};

type PromotionCandidate = {
  sessionId: string;
  reportPath: string;
  focusAreas: Set<OfflineReviewFocusArea>;
};

export async function collectAutoresearchProposalSignals(
  batchReportPath: string,
  options: {
    repoRoot?: string;
    minimumConfidence?: OfflineReviewConfidence;
    minSessionCount?: number;
  } = {},
): Promise<AutoresearchProposalSignal[]> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const minimumConfidence = confidenceRank(options.minimumConfidence ?? "high");
  const minSessionCount = options.minSessionCount ?? 2;
  const batchReport = await loadJsonFile<OfflineReviewBatchReport>(
    path.resolve(repoRoot, batchReportPath),
  );
  const grouped = new Map<
    string,
    {
      focusArea: OfflineReviewFocusArea;
      owner: OfflineReviewRecommendationOwner;
      apertureValue: string | string[] | boolean | null;
      expectedValue: string | string[] | boolean | null;
      disagreementCount: number;
      sessions: Set<string>;
      reportPaths: Set<string>;
      confidenceCounts: Record<OfflineReviewConfidence, number>;
      examples: Array<AutoresearchProposalSignal["examples"][number]>;
      targets: Set<string>;
    }
  >();

  for (const entry of batchReport.entries) {
    if (entry.status !== "disagreement" || !entry.reportPath || !entry.recommendationPath) {
      continue;
    }

    const [report, recommendation] = await Promise.all([
      loadJsonFile<OfflineReviewReport>(path.resolve(repoRoot, entry.reportPath)),
      loadJsonFile<OfflineReviewRecommendationReport>(
        path.resolve(repoRoot, entry.recommendationPath),
      ),
    ]);
    const ownerByFocusArea = new Map(
      recommendation.items.map((item) => [item.focusArea, item.owner] as const),
    );

    for (const disagreement of report.disagreements) {
      if (disagreement.recommendation !== "promote") {
        continue;
      }
      if (confidenceRank(disagreement.confidence) < minimumConfidence) {
        continue;
      }

      const owner = ownerByFocusArea.get(disagreement.focusArea) ?? "semantic";
      const recommendationItem = recommendation.items.find(
        (item) => item.focusArea === disagreement.focusArea,
      );
      const signature = createSignalSignature(disagreement, owner);
      const signal = grouped.get(signature) ?? {
        focusArea: disagreement.focusArea,
        owner,
        apertureValue: disagreement.apertureValue,
        expectedValue: disagreement.expectedValue,
        disagreementCount: 0,
        sessions: new Set<string>(),
        reportPaths: new Set<string>(),
        targets: new Set<string>(),
        confidenceCounts: {
          high: 0,
          medium: 0,
          low: 0,
        },
        examples: [],
      };
      signal.disagreementCount += 1;
      signal.sessions.add(report.bundle.sessionId);
      signal.reportPaths.add(path.resolve(repoRoot, entry.reportPath));
      for (const target of recommendationItem?.targets ?? []) {
        signal.targets.add(target);
      }
      signal.confidenceCounts[disagreement.confidence] += 1;
      signal.examples.push({
        sessionId: report.bundle.sessionId,
        stepIndex: disagreement.stepIndex,
        ...(disagreement.stepLabel ? { stepLabel: disagreement.stepLabel } : {}),
        confidence: disagreement.confidence,
        recommendationPath: path.resolve(repoRoot, entry.recommendationPath),
        ...(disagreement.rationale ? { rationale: disagreement.rationale } : {}),
      });
      grouped.set(signature, signal);
    }
  }

  return [...grouped.entries()]
    .map(([signature, signal]) => ({
      signature,
      focusArea: signal.focusArea,
      owner: signal.owner,
      apertureValue: signal.apertureValue,
      expectedValue: signal.expectedValue,
      disagreementCount: signal.disagreementCount,
      sessionCount: signal.sessions.size,
      sessions: [...signal.sessions].sort(),
      reportPaths: [...signal.reportPaths].sort(),
      targets: [...signal.targets].sort(),
      confidenceCounts: signal.confidenceCounts,
      examples: signal.examples
        .sort(
          (left, right) =>
            left.sessionId.localeCompare(right.sessionId) || left.stepIndex - right.stepIndex,
        )
        .slice(0, 6),
    }))
    .filter((signal) => signal.sessionCount >= minSessionCount)
    .sort(
      (left, right) =>
        right.sessionCount - left.sessionCount ||
        right.disagreementCount - left.disagreementCount ||
        left.focusArea.localeCompare(right.focusArea) ||
        left.signature.localeCompare(right.signature),
    );
}

export function selectAutoresearchProposalPromotions(
  signals: readonly AutoresearchProposalSignal[],
  options: {
    maxReports?: number;
  } = {},
): PromotionCandidate[] {
  const maxReports = options.maxReports ?? 4;
  const selected = new Map<string, PromotionCandidate>();

  for (const signal of signals) {
    for (const reportPath of signal.reportPaths) {
      const existing = selected.get(reportPath) ?? {
        sessionId:
          signal.sessions.find((sessionId) =>
            signal.examples.some((example) => example.sessionId === sessionId),
          ) ??
          signal.sessions[0] ??
          safeSegment(reportPath),
        reportPath,
        focusAreas: new Set<OfflineReviewFocusArea>(),
      };
      existing.focusAreas.add(signal.focusArea);
      selected.set(reportPath, existing);
      if (selected.size >= maxReports) {
        break;
      }
    }
    if (selected.size >= maxReports) {
      break;
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId),
  );
}

export async function promoteAutoresearchProposalCandidates(
  candidates: readonly PromotionCandidate[],
  options: {
    candidateCalibrationDir: string;
    repoRoot?: string;
  },
): Promise<AutoresearchProposalPromotion[]> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const splits = assignAutoresearchProposalSplits(candidates.length);
  const promotions: AutoresearchProposalPromotion[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    const split = splits[index] ?? "train";
    const calibrationCase = await promoteOfflineReviewReportToCalibrationCase(
      candidate.reportPath,
      {
        split,
        repoRoot,
        focusAreas: [...candidate.focusAreas].sort(),
        recommendationAllowlist: ["promote"],
        minimumConfidence: "high",
        includeStepInvariants: true,
      },
    );
    const outputPath = defaultAutoresearchCalibrationCasePath(
      calibrationCase,
      path.join(options.candidateCalibrationDir, split),
    );
    await writeAutoresearchProposalCalibrationCase(outputPath, calibrationCase);
    promotions.push({
      sessionId: calibrationCase.sessionId,
      reportPath: candidate.reportPath,
      split,
      focusAreas: [...candidate.focusAreas].sort(),
      casePath: outputPath,
      correctedCount: calibrationCase.summary.correctedCount,
      invariantCount: calibrationCase.summary.invariantCount,
      targets: calibrationCase.targets,
    });
  }

  return promotions;
}

export function assignAutoresearchProposalSplits(count: number): AutoresearchCalibrationSplit[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return ["train"];
  }
  if (count === 2) {
    return ["train", "heldout"];
  }
  if (count === 3) {
    return ["train", "validation", "heldout"];
  }

  return [...Array.from({ length: count - 2 }, () => "train" as const), "validation", "heldout"];
}

export function defaultAutoresearchProposalDirectory(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_PROPOSALS_DIR,
): string {
  return path.join(directory, safeTimestamp(generatedAt));
}

export function defaultAutoresearchProposalRunPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_PROPOSALS_DIR,
): string {
  return path.join(defaultAutoresearchProposalDirectory(generatedAt, directory), "proposal.json");
}

export function defaultAutoresearchProposalMarkdownPath(runPath: string): string {
  return runPath.replace(/\.json$/i, ".md");
}

export function defaultAutoresearchProposalCalibrationDir(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_PROPOSALS_DIR,
): string {
  return path.join(defaultAutoresearchProposalDirectory(generatedAt, directory), "calibration");
}

export async function writeAutoresearchProposalRun(
  filePath: string,
  run: AutoresearchProposalRun,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function renderAutoresearchProposalMarkdown(run: AutoresearchProposalRun): string {
  const lines = [
    "# Autoresearch Proposal",
    "",
    `Generated: ${run.generatedAt}`,
    `Status: ${run.status}`,
    "",
    "## Summary",
    "",
    `- bundles: ${run.summary.bundleCount}`,
    `- clean: ${run.summary.cleanCount}`,
    `- disagreement bundles: ${run.summary.disagreementBundleCount}`,
    `- errors: ${run.summary.errorCount}`,
    `- actionable disagreements: ${run.summary.actionableCount}`,
    `- selected signals: ${run.summary.selectedSignalCount}`,
    `- promoted cases: ${run.summary.promotedCaseCount}`,
    "",
  ];

  if (run.summary.workflow) {
    const workflow = run.summary.workflow;
    const contextParts = [
      formatWorkflowField("automation", workflow.automationModes),
      formatWorkflowField("surfaces", workflow.surfaces),
      formatWorkflowField("runners", workflow.runners),
      formatWorkflowField("placements", workflow.placements),
      formatWorkflowField("environments", workflow.environments),
      formatWorkflowField("approval states", workflow.approvalStates),
      formatWorkflowField("models", workflow.models),
    ].filter((part): part is string => part !== null);
    if (contextParts.length > 0) {
      lines.push(`- workflow: ${contextParts.join("; ")}`);
    }

    const usageParts = [
      workflow.usageTotals.inputTokens > 0 ? `input=${formatCount(workflow.usageTotals.inputTokens)}` : null,
      workflow.usageTotals.cachedInputTokens > 0 ? `cache=${formatCount(workflow.usageTotals.cachedInputTokens)}` : null,
      workflow.usageTotals.outputTokens > 0 ? `output=${formatCount(workflow.usageTotals.outputTokens)}` : null,
      workflow.usageTotals.costUsd > 0 ? `cost=${formatUsd(workflow.usageTotals.costUsd)}` : null,
    ].filter((part): part is string => part !== null);
    if (usageParts.length > 0) {
      lines.push(`- workflow usage: ${usageParts.join(", ")}`);
    }
  }

  lines.push("", "## Artifacts", "", `- batch report: ${run.artifacts.batchReportPath}`);

  if (run.artifacts.batchMarkdownPath) {
    lines.push(`- batch summary: ${run.artifacts.batchMarkdownPath}`);
  }
  if (run.artifacts.candidateCalibrationDir) {
    lines.push(`- candidate calibration dir: ${run.artifacts.candidateCalibrationDir}`);
  }
  if (run.artifacts.optimizerRunPath) {
    lines.push(`- optimizer run: ${run.artifacts.optimizerRunPath}`);
  }
  if (run.artifacts.optimizerRunMarkdownPath) {
    lines.push(`- optimizer summary: ${run.artifacts.optimizerRunMarkdownPath}`);
  }
  if (run.artifacts.optimizerPatchPath) {
    lines.push(`- patch: ${run.artifacts.optimizerPatchPath}`);
  }

  lines.push("", "## Signals", "");
  if (run.signals.length === 0) {
    lines.push("- (none)");
  } else {
    for (const signal of run.signals) {
      lines.push(
        `- ${signal.focusArea} (${signal.owner}): ${renderSignalValue(signal.apertureValue)} -> ${renderSignalValue(signal.expectedValue)} across ${signal.sessionCount} session(s)`,
      );
      if (signal.targets.length > 0) {
        lines.push(`  targets: ${signal.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Intent Statements", "");
  if (run.intentStatements.length === 0) {
    lines.push("- (none)");
  } else {
    for (const intent of run.intentStatements) {
      lines.push(`- ${intent.statement}`);
      if (intent.targets.length > 0) {
        lines.push(`  targets: ${intent.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Code Recommendations", "");
  if (run.codeRecommendations.length === 0) {
    lines.push("- (none)");
  } else {
    for (const recommendation of run.codeRecommendations) {
      lines.push(`- ${recommendation.summary}`);
      if (recommendation.recommendedFiles.length > 0) {
        lines.push(`  files: ${recommendation.recommendedFiles.join(", ")}`);
      }
      if (recommendation.patchPath) {
        lines.push(`  patch: ${recommendation.patchPath}`);
      }
    }
  }

  lines.push("", "## Promotions", "");
  if (run.promotions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const promotion of run.promotions) {
      lines.push(`- ${promotion.sessionId} -> ${promotion.split}`);
      lines.push(`  case: ${promotion.casePath}`);
      lines.push(`  focus areas: ${promotion.focusAreas.join(", ")}`);
    }
  }

  if (run.optimizer) {
    lines.push("", "## Optimizer", "");
    lines.push(`- status: ${run.optimizer.status}`);
    lines.push(
      `- mismatches: ${run.optimizer.beforeMismatchCount} -> ${run.optimizer.afterMismatchCount}`,
    );
    lines.push(
      `- invariant mismatches: ${run.optimizer.beforeInvariantMismatchCount} -> ${run.optimizer.afterInvariantMismatchCount}`,
    );
    lines.push(`- changed files: ${run.optimizer.changedFiles.length}`);
    if (run.optimizer.disallowedFiles.length > 0) {
      lines.push(`- disallowed files: ${run.optimizer.disallowedFiles.join(", ")}`);
    }
  }

  if (run.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...run.notes.map((note) => `- ${note}`));
  }

  return `${lines.join("\n")}\n`;
}

export function buildAutoresearchProposalIntentStatements(
  signals: readonly AutoresearchProposalSignal[],
): AutoresearchProposalIntentStatement[] {
  return signals.map((signal) => ({
    focusArea: signal.focusArea,
    owner: signal.owner,
    statement: [
      `Calibrate ${signal.owner} ${signal.focusArea} handling`,
      `so repeated ${renderSignalValue(signal.apertureValue)} -> ${renderSignalValue(signal.expectedValue)}`,
      `drift across ${signal.sessionCount} session(s) is corrected without changing unrelated invariants.`,
    ].join(" "),
    apertureValue: signal.apertureValue,
    expectedValue: signal.expectedValue,
    sessionCount: signal.sessionCount,
    disagreementCount: signal.disagreementCount,
    targets: signal.targets,
  }));
}

export function buildAutoresearchProposalCodeRecommendations(options: {
  signals: readonly AutoresearchProposalSignal[];
  optimizerRun?: AutoresearchOptimizerRun;
  optimizerPatchPath?: string;
}): AutoresearchProposalCodeRecommendation[] {
  const recommendations: AutoresearchProposalCodeRecommendation[] = [];
  const optimizerFeedback = options.optimizerRun?.feedback;
  const localBeforeMismatchCount = options.optimizerRun?.summary.beforeMismatchCount;
  const localAfterMismatchCount = options.optimizerRun?.summary.afterMismatchCount;

  if (optimizerFeedback) {
    const reasons = [...optimizerFeedback.reasons];
    if (
      localBeforeMismatchCount !== undefined &&
      localAfterMismatchCount !== undefined &&
      optimizerFeedback.beforeMismatchCount !== undefined &&
      optimizerFeedback.afterMismatchCount !== undefined &&
      (optimizerFeedback.beforeMismatchCount !== localBeforeMismatchCount ||
        optimizerFeedback.afterMismatchCount !== localAfterMismatchCount)
    ) {
      reasons.push(
        `Harness evaluation measured mismatches ${localBeforeMismatchCount} -> ${localAfterMismatchCount}; optimizer self-report claimed ${optimizerFeedback.beforeMismatchCount} -> ${optimizerFeedback.afterMismatchCount}.`,
      );
    }
    if (options.optimizerRun?.status === "gate_blocked") {
      reasons.push(
        "The patch improved the frozen calibration locally, but at least one downstream gate failed, so the candidate is blocked rather than accepted.",
      );
    }

    recommendations.push({
      kind: options.optimizerPatchPath ? "patch" : "intent_only",
      summary: optimizerFeedback.summary,
      recommendedFiles: optimizerFeedback.recommendedFiles,
      reasons,
      targets: dedupeStrings(options.signals.flatMap((signal) => signal.targets)),
      ...(options.optimizerPatchPath ? { patchPath: options.optimizerPatchPath } : {}),
      ...(options.optimizerRun?.status ? { optimizerStatus: options.optimizerRun.status } : {}),
      ...(localBeforeMismatchCount !== undefined
        ? { beforeMismatchCount: localBeforeMismatchCount }
        : {}),
      ...(localAfterMismatchCount !== undefined
        ? { afterMismatchCount: localAfterMismatchCount }
        : {}),
    });
  }

  if (recommendations.length === 0 && options.signals.length > 0) {
    recommendations.push({
      kind: "intent_only",
      summary:
        "No surviving patch artifact was produced; review the intent statements and target files for a manual generalization.",
      recommendedFiles: dedupeStrings(options.signals.flatMap((signal) => signal.targets)),
      reasons: [
        "Repeated high-confidence signal was detected, but the optimizer did not leave a durable patch artifact.",
      ],
      targets: dedupeStrings(options.signals.flatMap((signal) => signal.targets)),
    });
  }

  return recommendations;
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeAutoresearchProposalCalibrationCase(
  filePath: string,
  calibrationCase: AutoresearchCalibrationCase,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(calibrationCase, null, 2)}\n`, "utf8");
}

function createSignalSignature(
  disagreement: OfflineReviewDisagreement,
  owner: OfflineReviewRecommendationOwner,
): string {
  return [
    disagreement.focusArea,
    owner,
    serializeValue(disagreement.apertureValue),
    serializeValue(disagreement.expectedValue),
  ].join("|");
}

function serializeValue(value: string | string[] | boolean | null): string {
  return JSON.stringify(value);
}

function renderSignalValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function confidenceRank(value: OfflineReviewConfidence): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function formatWorkflowField(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}=${values.join(", ")}` : null;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
