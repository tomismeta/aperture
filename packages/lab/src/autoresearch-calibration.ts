import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfflineReviewRecommendationReport,
  prepareOfflineReviewArtifact,
  readOfflineReviewFocusAreaValue,
  offlineReviewValuesEqual,
  type OfflineReviewConfidence,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type OfflineReviewReport,
} from "./offline-review.js";
import { loadReplayBundleFromFStopInputFile } from "./fstop-session.js";
import type { ReplaySemanticCalibrationFamily } from "./semantic-calibration.js";
import {
  createSessionBundle,
  runSessionBundle,
} from "./session-bundle.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import {
  collectSemanticFamilies,
  confidenceRank,
  createOfflineReviewFocusAreaCounts,
  createSemanticFamilyCounts,
  deriveSemanticFamiliesForDifference,
  invariantFocusAreasForStep,
  readJsonFilesRecursive,
  resolveRepoRelativeCalibrationInputPath,
  resolveRepoRelativePath,
} from "./autoresearch-calibration-support.js";
import {
  validateAutoresearchCalibrationCase,
  validateOfflineReviewReport,
} from "./autoresearch-calibration-validation.js";

export {
  defaultAutoresearchBriefPath,
  defaultAutoresearchCalibrationCasePath,
  defaultAutoresearchEvaluationPath,
  writeAutoresearchCalibrationCase,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
} from "./autoresearch-calibration-files.js";
export {
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
} from "./autoresearch-calibration-render.js";

export const AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION = 1 as const;
export const AUTORESEARCH_CALIBRATION_REPORT_SCHEMA_VERSION = 1 as const;
export const AUTORESEARCH_OPTIMIZATION_BRIEF_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AUTORESEARCH_ALLOWED_EDIT_PATHS = [
  "packages/lab/src/public-trajectories.ts",
  "packages/core/src/semantic-detection.ts",
  "packages/core/src/semantic-interpreter.ts",
  "packages/core/src/semantic-language.ts",
  "packages/core/src/semantic-ontology.ts",
  "packages/lab/src/offline-review.ts",
] as const;
export const DEFAULT_AUTORESEARCH_EVALUATION_COMMANDS = [
  "pnpm lab:fstop:evaluate",
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
export const DEFAULT_AUTORESEARCH_RESULTS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
);
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
  inputPath: string;
  bundlePath?: string;
  targets: string[];
  semanticFamilies: ReplaySemanticCalibrationFamily[];
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
  semanticFamilies: ReplaySemanticCalibrationFamily[];
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
    mismatchSemanticFamilyCounts: Record<ReplaySemanticCalibrationFamily, number>;
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
  const inputPath = resolveRepoRelativeCalibrationInputPath(report.bundle.bundlePath, repoRoot);
  const bundle = await loadReplayBundleFromFStopInputFile(path.resolve(repoRoot, inputPath));
  const artifact = prepareOfflineReviewArtifact(bundle, { bundlePath: inputPath });
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

  const semanticFamilies = collectSemanticFamilies(
    selectedDisagreements.map((disagreement) => ({
      focusArea: disagreement.focusArea,
      apertureValue: disagreement.apertureValue,
      expectedValue: disagreement.expectedValue,
    })),
  );

  return {
    schemaVersion: AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION,
    promotedAt: options.generatedAt ?? new Date().toISOString(),
    split: options.split,
    sessionId: report.bundle.sessionId,
    title: report.bundle.title,
    inputPath,
    targets: [...recommendationTargets].sort(),
    semanticFamilies,
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

export async function loadAutoresearchCalibrationCases(
  options: {
    repoRoot?: string;
    splits?: readonly AutoresearchCalibrationSplit[];
    extraDirectories?: readonly string[];
  } = {},
): Promise<Array<{ filePath: string; calibrationCase: AutoresearchCalibrationCase }>> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const splits = options.splits ?? ["train", "validation", "heldout"];
  const entries: Array<{ filePath: string; calibrationCase: AutoresearchCalibrationCase }> = [];
  const seenFilePaths = new Set<string>();

  for (const split of splits) {
    const directory = DEFAULT_AUTORESEARCH_CALIBRATION_SPLIT_DIRS[split];
    const absoluteDirectory = path.resolve(repoRoot, directory);
    for (const filePath of await readJsonFilesRecursive(absoluteDirectory)) {
      const relativePath = resolveRepoRelativePath(filePath, repoRoot);
      if (seenFilePaths.has(relativePath)) {
        continue;
      }
      const calibrationCase = await loadAutoresearchCalibrationCase(filePath);
      entries.push({
        filePath: relativePath,
        calibrationCase,
      });
      seenFilePaths.add(relativePath);
    }
  }

  for (const directory of options.extraDirectories ?? []) {
    const absoluteDirectory = path.resolve(repoRoot, directory);
    for (const filePath of await readJsonFilesRecursive(absoluteDirectory)) {
      const relativePath = resolveRepoRelativePath(filePath, repoRoot);
      if (seenFilePaths.has(relativePath)) {
        continue;
      }
      const calibrationCase = await loadAutoresearchCalibrationCase(filePath);
      entries.push({
        filePath: relativePath,
        calibrationCase,
      });
      seenFilePaths.add(relativePath);
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
  const mismatchSemanticFamilyCounts = createSemanticFamilyCounts();
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
      for (const family of deriveSemanticFamiliesForDifference(
        mismatch.focusArea,
        mismatch.currentValue,
        mismatch.expectedValue,
      )) {
        mismatchSemanticFamilyCounts[family] += 1;
      }
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
      mismatchSemanticFamilyCounts,
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

async function evaluateAutoresearchCalibrationCase(
  calibrationCase: AutoresearchCalibrationCase,
  options: {
    casePath: string;
    repoRoot: string;
  },
): Promise<AutoresearchCalibrationCaseResult> {
  const storedBundle = await loadReplayBundleFromFStopInputFile(
    path.resolve(
      options.repoRoot,
      calibrationCase.inputPath ?? calibrationCase.bundlePath ?? "",
    ),
  );
  const rerun = runSessionBundle(storedBundle);
  const freshBundle = createSessionBundle(rerun, {
    sessionId: storedBundle.sessionId,
    ...(storedBundle.source !== undefined ? { source: storedBundle.source } : {}),
    exportedAt: storedBundle.exportedAt,
  });
  const artifact = prepareOfflineReviewArtifact(freshBundle, {
    bundlePath: calibrationCase.inputPath ?? calibrationCase.bundlePath,
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
    semanticFamilies: calibrationCase.semanticFamilies,
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

  const calibrationCase = validateAutoresearchCalibrationCase(parsed, {
    schemaVersion: AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION,
  });
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
