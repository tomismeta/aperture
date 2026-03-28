import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfflineReviewRecommendationReport,
  compareOfflineReviewArtifact,
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  prepareOfflineReviewArtifact,
  readOfflineReviewFocusAreaValue,
  offlineReviewValuesEqual,
  type OfflineReviewConfidence,
  type OfflineReviewDisagreement,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type OfflineReviewReport,
} from "./offline-review.js";
import {
  createSessionBundle,
  loadSessionBundle,
  runSessionBundle,
  type ReplaySessionBundle,
} from "./session-bundle.js";
import { isRecord } from "./validation.js";

export const AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION = 1 as const;
export const AUTORESEARCH_CALIBRATION_REPORT_SCHEMA_VERSION = 1 as const;
export const AUTORESEARCH_OPTIMIZATION_BRIEF_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AUTORESEARCH_ALLOWED_EDIT_PATHS = [
  "packages/lab/src/public-trajectories.ts",
  "packages/core/src/semantic-detection.ts",
  "packages/core/src/semantic-interpreter.ts",
  "packages/core/src/semantic-language.ts",
  "packages/lab/src/offline-review.ts",
] as const;
export const DEFAULT_AUTORESEARCH_EVALUATION_COMMANDS = [
  "pnpm lab:autoresearch:evaluate",
  "pnpm judgment:battle",
  "pnpm release:check",
] as const;

const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_AUTORESEARCH_CALIBRATION_DIR = path.join(LAB_DIR, "calibration");
export const DEFAULT_AUTORESEARCH_CALIBRATION_SPLIT_DIRS = {
  train: path.join(DEFAULT_AUTORESEARCH_CALIBRATION_DIR, "train"),
  validation: path.join(DEFAULT_AUTORESEARCH_CALIBRATION_DIR, "validation"),
  heldout: path.join(DEFAULT_AUTORESEARCH_CALIBRATION_DIR, "heldout"),
} as const satisfies Record<AutoresearchCalibrationSplit, string>;
export const DEFAULT_AUTORESEARCH_RESULTS_DIR = path.join(LAB_DIR, "results", "autoresearch");
export const DEFAULT_AUTORESEARCH_EVALUATIONS_DIR = path.join(
  DEFAULT_AUTORESEARCH_RESULTS_DIR,
  "evaluations",
);
export const DEFAULT_AUTORESEARCH_BRIEFS_DIR = path.join(
  DEFAULT_AUTORESEARCH_RESULTS_DIR,
  "briefs",
);

export type AutoresearchCalibrationSplit = "train" | "validation" | "heldout";
export type AutoresearchCalibrationExpectationMode = "corrected" | "invariant";

export type AutoresearchCalibrationExpectation = {
  stepIndex: number;
  stepLabel?: string;
  focusArea: OfflineReviewFocusArea;
  mode: AutoresearchCalibrationExpectationMode;
  expectedValue: string | string[] | boolean | null;
  observedValueAtPromotion: string | string[] | boolean | null;
  confidence: OfflineReviewConfidence;
  rationale?: string;
  supportingText?: string;
};

export type AutoresearchCalibrationCase = {
  schemaVersion: typeof AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION;
  promotedAt: string;
  split: AutoresearchCalibrationSplit;
  sessionId: string;
  title: string;
  bundlePath: string;
  targets: string[];
  source: {
    reportPath: string;
    reviewer?: string;
    model?: string;
    disagreementCount: number;
  };
  summary: {
    correctedCount: number;
    invariantCount: number;
    focusAreaCounts: Record<OfflineReviewFocusArea, number>;
  };
  expectations: AutoresearchCalibrationExpectation[];
};

export type AutoresearchCalibrationMismatch = {
  stepIndex: number;
  stepLabel?: string;
  focusArea: OfflineReviewFocusArea;
  mode: AutoresearchCalibrationExpectationMode;
  expectedValue: string | string[] | boolean | null;
  observedValueAtPromotion: string | string[] | boolean | null;
  currentValue: string | string[] | boolean | null;
  confidence: OfflineReviewConfidence;
  rationale?: string;
};

export type AutoresearchCalibrationCaseResult = {
  casePath: string;
  split: AutoresearchCalibrationSplit;
  sessionId: string;
  title: string;
  targets: string[];
  summary: {
    expectationCount: number;
    correctedCount: number;
    invariantCount: number;
    matchedCount: number;
    mismatchCount: number;
    correctedMismatchCount: number;
    invariantMismatchCount: number;
  };
  mismatches: AutoresearchCalibrationMismatch[];
};

export type AutoresearchCalibrationReport = {
  schemaVersion: typeof AUTORESEARCH_CALIBRATION_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  repoRoot: string;
  splits: AutoresearchCalibrationSplit[];
  summary: {
    caseCount: number;
    expectationCount: number;
    matchedCount: number;
    mismatchCount: number;
    correctedMismatchCount: number;
    invariantMismatchCount: number;
    splitCounts: Record<AutoresearchCalibrationSplit, number>;
    mismatchFocusAreaCounts: Record<OfflineReviewFocusArea, number>;
  };
  results: AutoresearchCalibrationCaseResult[];
};

export type AutoresearchOptimizationPriority = {
  focusArea: OfflineReviewFocusArea;
  targets: string[];
  mismatchCount: number;
  correctedMismatchCount: number;
  invariantMismatchCount: number;
  sessions: string[];
  examples: Array<{
    sessionId: string;
    stepIndex: number;
    stepLabel?: string;
    mode: AutoresearchCalibrationExpectationMode;
    expectedValue: string | string[] | boolean | null;
    currentValue: string | string[] | boolean | null;
    confidence: OfflineReviewConfidence;
  }>;
};

export type AutoresearchOptimizationBrief = {
  schemaVersion: typeof AUTORESEARCH_OPTIMIZATION_BRIEF_SCHEMA_VERSION;
  generatedAt: string;
  reportPath?: string;
  summary: {
    caseCount: number;
    expectationCount: number;
    mismatchCount: number;
    correctedMismatchCount: number;
    invariantMismatchCount: number;
  };
  priorities: AutoresearchOptimizationPriority[];
  allowedEditPaths: string[];
  evaluationCommands: string[];
  guidance: string[];
};

type PromoteOptions = {
  split: AutoresearchCalibrationSplit;
  reportPath: string;
  repoRoot?: string;
  generatedAt?: string;
  includeStepInvariants?: boolean;
  focusAreas?: readonly OfflineReviewFocusArea[];
  recommendationAllowlist?: readonly OfflineReviewRecommendation[];
  minimumConfidence?: OfflineReviewConfidence;
};

type EvaluateOptions = {
  repoRoot?: string;
  generatedAt?: string;
};

export async function promoteOfflineReviewReportToCalibrationCase(
  reportPath: string,
  options: Omit<PromoteOptions, "reportPath">,
): Promise<AutoresearchCalibrationCase> {
  const report = await loadOfflineReviewReport(reportPath);
  const repoRoot = options.repoRoot ?? process.cwd();
  const recommendation = buildOfflineReviewRecommendationReport(report);
  const bundlePath = resolveRepoRelativeBundlePath(report.bundle.bundlePath, repoRoot);
  const bundle = await loadSessionBundle(path.resolve(repoRoot, bundlePath));
  const artifact = prepareOfflineReviewArtifact(bundle, { bundlePath });
  const allowedFocusAreas = options.focusAreas ? new Set(options.focusAreas) : null;
  const minimumConfidence = confidenceRank(options.minimumConfidence ?? "high");
  const recommendationAllowlist = new Set(options.recommendationAllowlist ?? ["promote"]);

  const selectedDisagreements = report.disagreements.filter((entry) => (
    recommendationAllowlist.has(entry.recommendation)
    && confidenceRank(entry.confidence) >= minimumConfidence
    && (allowedFocusAreas === null || allowedFocusAreas.has(entry.focusArea))
  ));

  if (selectedDisagreements.length === 0) {
    throw new Error("No disagreements matched the promotion filters.");
  }

  const selectedFocusAreasByStep = new Map<number, Set<OfflineReviewFocusArea>>();
  for (const disagreement of selectedDisagreements) {
    const list = selectedFocusAreasByStep.get(disagreement.stepIndex) ?? new Set<OfflineReviewFocusArea>();
    list.add(disagreement.focusArea);
    selectedFocusAreasByStep.set(disagreement.stepIndex, list);
  }

  const expectations: AutoresearchCalibrationExpectation[] = selectedDisagreements.map((disagreement) => ({
    stepIndex: disagreement.stepIndex,
    ...(disagreement.stepLabel ? { stepLabel: disagreement.stepLabel } : {}),
    focusArea: disagreement.focusArea,
    mode: "corrected",
    expectedValue: disagreement.expectedValue,
    observedValueAtPromotion: disagreement.apertureValue,
    confidence: disagreement.confidence,
    ...(disagreement.rationale ? { rationale: disagreement.rationale } : {}),
    ...(disagreement.supportingText ? { supportingText: disagreement.supportingText } : {}),
  }));

  if (options.includeStepInvariants ?? true) {
    for (const [stepIndex, selectedFocusAreas] of selectedFocusAreasByStep) {
      const step = artifact.steps.find((entry) => entry.stepIndex === stepIndex);
      if (!step) {
        continue;
      }

      for (const focusArea of invariantFocusAreasForStep(selectedFocusAreas)) {
        const observedValue = readOfflineReviewFocusAreaValue(step, focusArea);
        if (observedValue === null) {
          continue;
        }

        expectations.push({
          stepIndex,
          ...(step.stepLabel ? { stepLabel: step.stepLabel } : {}),
          focusArea,
          mode: "invariant",
          expectedValue: observedValue,
          observedValueAtPromotion: observedValue,
          confidence: "high",
          rationale: "Preserve adjacent classification state while calibrating the promoted disagreement.",
        });
      }
    }
  }

  const focusAreaCounts = createOfflineReviewFocusAreaCounts();
  let correctedCount = 0;
  let invariantCount = 0;
  for (const expectation of expectations) {
    focusAreaCounts[expectation.focusArea] += 1;
    if (expectation.mode === "corrected") {
      correctedCount += 1;
    } else {
      invariantCount += 1;
    }
  }

  const recommendationTargets = new Set<string>();
  for (const item of recommendation.items) {
    if (selectedDisagreements.some((entry) => entry.focusArea === item.focusArea)) {
      for (const target of item.targets) {
        recommendationTargets.add(target);
      }
    }
  }

  return {
    schemaVersion: AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION,
    promotedAt: options.generatedAt ?? new Date().toISOString(),
    split: options.split,
    sessionId: report.bundle.sessionId,
    title: report.bundle.title,
    bundlePath,
    targets: [...recommendationTargets].sort(),
    source: {
      reportPath: resolveRepoRelativePath(reportPath, repoRoot),
      ...(report.review.reviewer ? { reviewer: report.review.reviewer } : {}),
      ...(report.review.model ? { model: report.review.model } : {}),
      disagreementCount: selectedDisagreements.length,
    },
    summary: {
      correctedCount,
      invariantCount,
      focusAreaCounts,
    },
    expectations,
  };
}

export async function writeAutoresearchCalibrationCase(
  filePath: string,
  calibrationCase: AutoresearchCalibrationCase,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(calibrationCase, null, 2)}\n`, "utf8");
}

export function defaultAutoresearchCalibrationCasePath(
  calibrationCase: AutoresearchCalibrationCase,
  directory = DEFAULT_AUTORESEARCH_CALIBRATION_SPLIT_DIRS[calibrationCase.split],
): string {
  return path.join(directory, `${safeSegment(calibrationCase.sessionId)}.json`);
}

export async function loadAutoresearchCalibrationCases(
  options: {
    repoRoot?: string;
    splits?: readonly AutoresearchCalibrationSplit[];
  } = {},
): Promise<Array<{ filePath: string; calibrationCase: AutoresearchCalibrationCase }>> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const splits = options.splits ?? ["train", "validation", "heldout"];
  const entries: Array<{ filePath: string; calibrationCase: AutoresearchCalibrationCase }> = [];

  for (const split of splits) {
    const directory = DEFAULT_AUTORESEARCH_CALIBRATION_SPLIT_DIRS[split];
    const absoluteDirectory = path.resolve(repoRoot, directory);
    for (const filePath of await readJsonFilesRecursive(absoluteDirectory)) {
      const calibrationCase = await loadAutoresearchCalibrationCase(filePath);
      entries.push({
        filePath: resolveRepoRelativePath(filePath, repoRoot),
        calibrationCase,
      });
    }
  }

  return entries.sort((left, right) => left.calibrationCase.sessionId.localeCompare(right.calibrationCase.sessionId));
}

export async function evaluateAutoresearchCalibrationCases(
  cases: Array<{ filePath: string; calibrationCase: AutoresearchCalibrationCase }>,
  options: EvaluateOptions = {},
): Promise<AutoresearchCalibrationReport> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const results: AutoresearchCalibrationCaseResult[] = [];
  const splitCounts = {
    train: 0,
    validation: 0,
    heldout: 0,
  } satisfies Record<AutoresearchCalibrationSplit, number>;
  const mismatchFocusAreaCounts = createOfflineReviewFocusAreaCounts();
  let expectationCount = 0;
  let matchedCount = 0;
  let mismatchCount = 0;
  let correctedMismatchCount = 0;
  let invariantMismatchCount = 0;
  const splits = new Set<AutoresearchCalibrationSplit>();

  for (const entry of cases) {
    const result = await evaluateAutoresearchCalibrationCase(entry.calibrationCase, {
      casePath: entry.filePath,
      repoRoot,
    });
    results.push(result);
    splitCounts[entry.calibrationCase.split] += 1;
    splits.add(entry.calibrationCase.split);
    expectationCount += result.summary.expectationCount;
    matchedCount += result.summary.matchedCount;
    mismatchCount += result.summary.mismatchCount;
    correctedMismatchCount += result.summary.correctedMismatchCount;
    invariantMismatchCount += result.summary.invariantMismatchCount;
    for (const mismatch of result.mismatches) {
      mismatchFocusAreaCounts[mismatch.focusArea] += 1;
    }
  }

  return {
    schemaVersion: AUTORESEARCH_CALIBRATION_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    repoRoot,
    splits: [...splits].sort(),
    summary: {
      caseCount: cases.length,
      expectationCount,
      matchedCount,
      mismatchCount,
      correctedMismatchCount,
      invariantMismatchCount,
      splitCounts,
      mismatchFocusAreaCounts,
    },
    results,
  };
}

export function createAutoresearchOptimizationBrief(
  report: AutoresearchCalibrationReport,
  options: {
    generatedAt?: string;
    reportPath?: string;
    allowedEditPaths?: readonly string[];
    evaluationCommands?: readonly string[];
  } = {},
): AutoresearchOptimizationBrief {
  const grouped = new Map<string, AutoresearchOptimizationPriority>();

  for (const result of report.results) {
    for (const mismatch of result.mismatches) {
      const key = `${mismatch.focusArea}:${result.targets.join("|")}`;
      const existing = grouped.get(key) ?? {
        focusArea: mismatch.focusArea,
        targets: [...result.targets],
        mismatchCount: 0,
        correctedMismatchCount: 0,
        invariantMismatchCount: 0,
        sessions: [],
        examples: [],
      };

      existing.mismatchCount += 1;
      if (mismatch.mode === "corrected") {
        existing.correctedMismatchCount += 1;
      } else {
        existing.invariantMismatchCount += 1;
      }
      if (!existing.sessions.includes(result.sessionId)) {
        existing.sessions.push(result.sessionId);
      }
      if (existing.examples.length < 5) {
        existing.examples.push({
          sessionId: result.sessionId,
          stepIndex: mismatch.stepIndex,
          ...(mismatch.stepLabel ? { stepLabel: mismatch.stepLabel } : {}),
          mode: mismatch.mode,
          expectedValue: mismatch.expectedValue,
          currentValue: mismatch.currentValue,
          confidence: mismatch.confidence,
        });
      }
      grouped.set(key, existing);
    }
  }

  const priorities = [...grouped.values()].sort((left, right) => (
    right.correctedMismatchCount - left.correctedMismatchCount
    || right.mismatchCount - left.mismatchCount
    || left.focusArea.localeCompare(right.focusArea)
  ));

  return {
    schemaVersion: AUTORESEARCH_OPTIMIZATION_BRIEF_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.reportPath ? { reportPath: options.reportPath } : {}),
    summary: {
      caseCount: report.summary.caseCount,
      expectationCount: report.summary.expectationCount,
      mismatchCount: report.summary.mismatchCount,
      correctedMismatchCount: report.summary.correctedMismatchCount,
      invariantMismatchCount: report.summary.invariantMismatchCount,
    },
    priorities,
    allowedEditPaths: [...(options.allowedEditPaths ?? DEFAULT_AUTORESEARCH_ALLOWED_EDIT_PATHS)],
    evaluationCommands: [...(options.evaluationCommands ?? DEFAULT_AUTORESEARCH_EVALUATION_COMMANDS)],
    guidance: [
      "Reduce corrected mismatches first; treat invariant mismatches as regressions.",
      "Edit only the allowed semantic/importer files.",
      "Rerun the calibration report plus judgment and release gates after every candidate patch.",
      "Promote new reviewer disagreements separately; do not overwrite the frozen calibration corpus during optimization.",
    ],
  };
}

export async function writeAutoresearchCalibrationReport(
  filePath: string,
  report: AutoresearchCalibrationReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function writeAutoresearchOptimizationBrief(
  filePath: string,
  brief: AutoresearchOptimizationBrief,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
}

export function defaultAutoresearchEvaluationPath(
  reportOrTimestamp: AutoresearchCalibrationReport | string,
  directory = DEFAULT_AUTORESEARCH_EVALUATIONS_DIR,
): string {
  const generatedAt = typeof reportOrTimestamp === "string"
    ? reportOrTimestamp
    : reportOrTimestamp.generatedAt;
  return path.join(directory, `autoresearch-evaluation-${safeTimestamp(generatedAt)}.json`);
}

export function defaultAutoresearchBriefPath(
  briefOrTimestamp: AutoresearchOptimizationBrief | string,
  directory = DEFAULT_AUTORESEARCH_BRIEFS_DIR,
): string {
  const generatedAt = typeof briefOrTimestamp === "string"
    ? briefOrTimestamp
    : briefOrTimestamp.generatedAt;
  return path.join(directory, `autoresearch-brief-${safeTimestamp(generatedAt)}.json`);
}

export function renderAutoresearchCalibrationMarkdown(
  report: AutoresearchCalibrationReport,
): string {
  const lines: string[] = [
    "# Autoresearch Calibration Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Cases: ${report.summary.caseCount}`,
    `Expectations: ${report.summary.expectationCount}`,
    `Mismatches: ${report.summary.mismatchCount}`,
    `Corrected mismatches: ${report.summary.correctedMismatchCount}`,
    `Invariant mismatches: ${report.summary.invariantMismatchCount}`,
    "",
    "## Mismatch Focus Areas",
    "",
  ];

  for (const focusArea of DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS) {
    lines.push(`- ${focusArea}: ${report.summary.mismatchFocusAreaCounts[focusArea]}`);
  }

  lines.push("", "## Results", "");

  for (const result of report.results) {
    lines.push(`### ${result.sessionId}`);
    lines.push("");
    lines.push(`- split: ${result.split}`);
    lines.push(`- targets: ${result.targets.join(", ") || "(none)"}`);
    lines.push(`- mismatches: ${result.summary.mismatchCount}/${result.summary.expectationCount}`);
    lines.push(`- corrected mismatches: ${result.summary.correctedMismatchCount}`);
    lines.push(`- invariant mismatches: ${result.summary.invariantMismatchCount}`);
    for (const mismatch of result.mismatches.slice(0, 5)) {
      lines.push(
        `- step ${mismatch.stepIndex}${mismatch.stepLabel ? ` (${mismatch.stepLabel})` : ""}: ${mismatch.focusArea} ${renderCalibrationValue(mismatch.currentValue)} -> ${renderCalibrationValue(mismatch.expectedValue)} (${mismatch.mode})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderAutoresearchOptimizationMarkdown(
  brief: AutoresearchOptimizationBrief,
): string {
  const lines: string[] = [
    "# Autoresearch Optimization Brief",
    "",
    `Generated: ${brief.generatedAt}`,
    `Cases: ${brief.summary.caseCount}`,
    `Expectations: ${brief.summary.expectationCount}`,
    `Mismatches: ${brief.summary.mismatchCount}`,
    `Corrected mismatches: ${brief.summary.correctedMismatchCount}`,
    `Invariant mismatches: ${brief.summary.invariantMismatchCount}`,
    "",
    "## Guidance",
    "",
    ...brief.guidance.map((line) => `- ${line}`),
    "",
    "## Allowed Edit Paths",
    "",
    ...brief.allowedEditPaths.map((line) => `- ${line}`),
    "",
    "## Evaluation Commands",
    "",
    ...brief.evaluationCommands.map((line) => `- ${line}`),
    "",
    "## Priorities",
    "",
  ];

  for (const priority of brief.priorities) {
    lines.push(`### ${priority.focusArea}`);
    lines.push("");
    lines.push(`- mismatches: ${priority.mismatchCount}`);
    lines.push(`- corrected mismatches: ${priority.correctedMismatchCount}`);
    lines.push(`- invariant mismatches: ${priority.invariantMismatchCount}`);
    lines.push(`- targets: ${priority.targets.join(", ") || "(none)"}`);
    lines.push(`- sessions: ${priority.sessions.join(", ")}`);
    for (const example of priority.examples) {
      lines.push(
        `- step ${example.stepIndex}${example.stepLabel ? ` (${example.stepLabel})` : ""}: ${renderCalibrationValue(example.currentValue)} -> ${renderCalibrationValue(example.expectedValue)} (${example.mode}, ${example.confidence})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function evaluateAutoresearchCalibrationCase(
  calibrationCase: AutoresearchCalibrationCase,
  options: {
    casePath: string;
    repoRoot: string;
  },
): Promise<AutoresearchCalibrationCaseResult> {
  const bundlePath = path.resolve(options.repoRoot, calibrationCase.bundlePath);
  const storedBundle = await loadSessionBundle(bundlePath);
  const rerun = runSessionBundle(storedBundle);
  const freshBundle = createSessionBundle(rerun, {
    sessionId: storedBundle.sessionId,
    ...(storedBundle.source !== undefined ? { source: storedBundle.source } : {}),
    exportedAt: storedBundle.exportedAt,
  });
  const artifact = prepareOfflineReviewArtifact(freshBundle, {
    bundlePath: calibrationCase.bundlePath,
  });
  const mismatches: AutoresearchCalibrationMismatch[] = [];
  let matchedCount = 0;
  let correctedMismatchCount = 0;
  let invariantMismatchCount = 0;

  for (const expectation of calibrationCase.expectations) {
    const step = artifact.steps.find((entry) => entry.stepIndex === expectation.stepIndex);
    if (!step) {
      mismatches.push({
        stepIndex: expectation.stepIndex,
        ...(expectation.stepLabel ? { stepLabel: expectation.stepLabel } : {}),
        focusArea: expectation.focusArea,
        mode: expectation.mode,
        expectedValue: expectation.expectedValue,
        observedValueAtPromotion: expectation.observedValueAtPromotion,
        currentValue: null,
        confidence: expectation.confidence,
        rationale: `Step ${expectation.stepIndex} no longer exists in the rerun artifact.`,
      });
      if (expectation.mode === "corrected") {
        correctedMismatchCount += 1;
      } else {
        invariantMismatchCount += 1;
      }
      continue;
    }

    const currentValue = readOfflineReviewFocusAreaValue(step, expectation.focusArea);
    if (offlineReviewValuesEqual(currentValue, expectation.expectedValue)) {
      matchedCount += 1;
      continue;
    }

    mismatches.push({
      stepIndex: expectation.stepIndex,
      ...(expectation.stepLabel ? { stepLabel: expectation.stepLabel } : {}),
      focusArea: expectation.focusArea,
      mode: expectation.mode,
      expectedValue: expectation.expectedValue,
      observedValueAtPromotion: expectation.observedValueAtPromotion,
      currentValue,
      confidence: expectation.confidence,
      ...(expectation.rationale ? { rationale: expectation.rationale } : {}),
    });
    if (expectation.mode === "corrected") {
      correctedMismatchCount += 1;
    } else {
      invariantMismatchCount += 1;
    }
  }

  return {
    casePath: options.casePath,
    split: calibrationCase.split,
    sessionId: calibrationCase.sessionId,
    title: calibrationCase.title,
    targets: calibrationCase.targets,
    summary: {
      expectationCount: calibrationCase.expectations.length,
      correctedCount: calibrationCase.summary.correctedCount,
      invariantCount: calibrationCase.summary.invariantCount,
      matchedCount,
      mismatchCount: mismatches.length,
      correctedMismatchCount,
      invariantMismatchCount,
    },
    mismatches,
  };
}

async function loadAutoresearchCalibrationCase(filePath: string): Promise<AutoresearchCalibrationCase> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse calibration case at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const calibrationCase = validateAutoresearchCalibrationCase(parsed);
  if (!calibrationCase) {
    throw new Error(`Invalid calibration case at ${filePath}`);
  }

  return calibrationCase;
}

async function loadOfflineReviewReport(filePath: string): Promise<OfflineReviewReport> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse offline review report at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const report = validateOfflineReviewReport(parsed);
  if (!report) {
    throw new Error(`Invalid offline review report at ${filePath}`);
  }

  return report;
}

function validateAutoresearchCalibrationCase(value: unknown): AutoresearchCalibrationCase | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION
    || typeof value.promotedAt !== "string"
    || !isCalibrationSplit(value.split)
    || typeof value.sessionId !== "string"
    || typeof value.title !== "string"
    || typeof value.bundlePath !== "string"
    || !Array.isArray(value.targets)
    || !value.targets.every((entry) => typeof entry === "string")
    || !isRecord(value.source)
    || typeof value.source.reportPath !== "string"
    || typeof value.source.disagreementCount !== "number"
    || !isRecord(value.summary)
    || typeof value.summary.correctedCount !== "number"
    || typeof value.summary.invariantCount !== "number"
    || !isRecord(value.summary.focusAreaCounts)
    || !Array.isArray(value.expectations)
  ) {
    return null;
  }

  const focusAreaCounts = value.summary.focusAreaCounts;
  if (!DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.every((focusArea) => typeof focusAreaCounts[focusArea] === "number")) {
    return null;
  }

  const expectations: AutoresearchCalibrationExpectation[] = [];
  for (const entry of value.expectations) {
    const expectation = validateAutoresearchCalibrationExpectation(entry);
    if (!expectation) {
      return null;
    }
    expectations.push(expectation);
  }

  return {
    schemaVersion: AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION,
    promotedAt: value.promotedAt,
    split: value.split,
    sessionId: value.sessionId,
    title: value.title,
    bundlePath: value.bundlePath,
    targets: [...value.targets],
    source: {
      reportPath: value.source.reportPath,
      ...(typeof value.source.reviewer === "string" ? { reviewer: value.source.reviewer } : {}),
      ...(typeof value.source.model === "string" ? { model: value.source.model } : {}),
      disagreementCount: value.source.disagreementCount,
    },
    summary: {
      correctedCount: value.summary.correctedCount,
      invariantCount: value.summary.invariantCount,
      focusAreaCounts: createFocusAreaCountsFromRecord(focusAreaCounts),
    },
    expectations,
  };
}

function validateAutoresearchCalibrationExpectation(
  value: unknown,
): AutoresearchCalibrationExpectation | null {
  if (
    !isRecord(value)
    || typeof value.stepIndex !== "number"
    || !isOfflineReviewFocusArea(value.focusArea)
    || (value.mode !== "corrected" && value.mode !== "invariant")
    || !isOfflineReviewValue(value.expectedValue)
    || !isOfflineReviewValue(value.observedValueAtPromotion)
    || !isOfflineReviewConfidence(value.confidence)
  ) {
    return null;
  }

  return {
    stepIndex: value.stepIndex,
    ...(typeof value.stepLabel === "string" ? { stepLabel: value.stepLabel } : {}),
    focusArea: value.focusArea,
    mode: value.mode,
    expectedValue: value.expectedValue,
    observedValueAtPromotion: value.observedValueAtPromotion,
    confidence: value.confidence,
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    ...(typeof value.supportingText === "string" ? { supportingText: value.supportingText } : {}),
  };
}

function validateOfflineReviewReport(value: unknown): OfflineReviewReport | null {
  if (
    !isRecord(value)
    || typeof value.generatedAt !== "string"
    || typeof value.rubricVersion !== "string"
    || !isRecord(value.bundle)
    || typeof value.bundle.sessionId !== "string"
    || typeof value.bundle.title !== "string"
    || !isRecord(value.review)
    || !isRecord(value.summary)
    || typeof value.summary.totalFindings !== "number"
    || typeof value.summary.disagreementCount !== "number"
    || typeof value.summary.matchedFindings !== "number"
    || !isRecord(value.summary.disagreementsByFocusArea)
    || !Array.isArray(value.disagreements)
  ) {
    return null;
  }

  const disagreements: OfflineReviewDisagreement[] = [];
  for (const entry of value.disagreements) {
    const disagreement = validateOfflineReviewDisagreement(entry);
    if (!disagreement) {
      return null;
    }
    disagreements.push(disagreement);
  }

  return {
    schemaVersion: value.schemaVersion as OfflineReviewReport["schemaVersion"],
    generatedAt: value.generatedAt,
    rubricVersion: value.rubricVersion,
    bundle: {
      sessionId: value.bundle.sessionId,
      title: value.bundle.title,
      ...(typeof value.bundle.description === "string" ? { description: value.bundle.description } : {}),
      ...(typeof value.bundle.bundlePath === "string" ? { bundlePath: value.bundle.bundlePath } : {}),
      ...(isRecord(value.bundle.source)
        ? { source: value.bundle.source as NonNullable<OfflineReviewReport["bundle"]["source"]> }
        : {}),
    },
    review: {
      ...(typeof value.review.reviewer === "string" ? { reviewer: value.review.reviewer } : {}),
      ...(typeof value.review.model === "string" ? { model: value.review.model } : {}),
      ...(typeof value.review.completedAt === "string" ? { completedAt: value.review.completedAt } : {}),
      ...(typeof value.review.notes === "string" ? { notes: value.review.notes } : {}),
    },
    summary: {
      totalFindings: value.summary.totalFindings,
      disagreementCount: value.summary.disagreementCount,
      matchedFindings: value.summary.matchedFindings,
      disagreementsByFocusArea: createFocusAreaCountsFromRecord(value.summary.disagreementsByFocusArea),
    },
    disagreements,
  };
}

function validateOfflineReviewDisagreement(value: unknown): OfflineReviewDisagreement | null {
  if (
    !isRecord(value)
    || typeof value.stepIndex !== "number"
    || !isOfflineReviewFocusArea(value.focusArea)
    || !isOfflineReviewValue(value.apertureValue)
    || !isOfflineReviewValue(value.expectedValue)
    || !isOfflineReviewConfidence(value.confidence)
    || !isOfflineReviewRecommendation(value.recommendation)
  ) {
    return null;
  }

  return {
    stepIndex: value.stepIndex,
    ...(typeof value.stepLabel === "string" ? { stepLabel: value.stepLabel } : {}),
    focusArea: value.focusArea,
    apertureValue: value.apertureValue,
    expectedValue: value.expectedValue,
    confidence: value.confidence,
    ...(typeof value.supportingText === "string" ? { supportingText: value.supportingText } : {}),
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    recommendation: value.recommendation,
  };
}

function invariantFocusAreasForStep(
  selectedFocusAreas: Set<OfflineReviewFocusArea>,
): OfflineReviewFocusArea[] {
  const invariantCandidates: OfflineReviewFocusArea[] = ["status", "toolFamily", "consequence"];
  return invariantCandidates.filter((focusArea) => !selectedFocusAreas.has(focusArea));
}

function resolveRepoRelativeBundlePath(
  bundlePath: string | undefined,
  repoRoot: string,
): string {
  if (!bundlePath) {
    throw new Error("Offline review report is missing bundle.bundlePath.");
  }
  return resolveRepoRelativePath(bundlePath, repoRoot);
}

function resolveRepoRelativePath(filePath: string, repoRoot: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..")) {
    throw new Error(`Path ${filePath} is outside repo root ${repoRoot}.`);
  }
  return relative;
}

function createOfflineReviewFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return {
    title: 0,
    summary: 0,
    status: 0,
    intentFrame: 0,
    toolFamily: 0,
    consequence: 0,
  };
}

function createFocusAreaCountsFromRecord(
  value: Record<string, unknown>,
): Record<OfflineReviewFocusArea, number> {
  const counts = createOfflineReviewFocusAreaCounts();
  for (const focusArea of DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS) {
    counts[focusArea] = typeof value[focusArea] === "number" ? value[focusArea] : 0;
  }
  return counts;
}

function isCalibrationSplit(value: unknown): value is AutoresearchCalibrationSplit {
  return value === "train" || value === "validation" || value === "heldout";
}

function isOfflineReviewFocusArea(value: unknown): value is OfflineReviewFocusArea {
  return typeof value === "string" && DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.includes(value as OfflineReviewFocusArea);
}

function isOfflineReviewConfidence(value: unknown): value is OfflineReviewConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function isOfflineReviewRecommendation(value: unknown): value is OfflineReviewRecommendation {
  return value === "promote" || value === "inspect" || value === "ignore";
}

function isOfflineReviewValue(value: unknown): value is string | string[] | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function confidenceRank(value: OfflineReviewConfidence): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

async function readJsonFilesRecursive(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  const filePaths: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...await readJsonFilesRecursive(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths.sort();
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function renderCalibrationValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function isMissingDirectoryError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
