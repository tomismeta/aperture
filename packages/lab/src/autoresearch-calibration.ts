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
import { loadReplayBundleFromFStopInputFile } from "./fstop-session.js";
import {
  SEMANTIC_CALIBRATION_FAMILIES,
  type ReplaySemanticCalibrationFamily,
} from "./semantic-calibration.js";
import {
  createSessionBundle,
  runSessionBundle,
} from "./session-bundle.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import {
  hasShape,
  isArrayOf,
  isNumber,
  isRecord,
  isString,
} from "./shape.js";

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

  lines.push("", "## Semantic Families", "");

  for (const family of SEMANTIC_CALIBRATION_FAMILIES) {
    lines.push(`- ${family}: ${report.summary.mismatchSemanticFamilyCounts[family]}`);
  }

  lines.push("", "## Results", "");

  for (const result of report.results) {
    lines.push(`### ${result.sessionId}`);
    lines.push("");
    lines.push(`- split: ${result.split}`);
    lines.push(`- targets: ${result.targets.join(", ") || "(none)"}`);
    lines.push(`- semantic families: ${result.semanticFamilies.join(", ") || "(none)"}`);
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
  ) {
    return null;
  }

  const inputPath = typeof value.inputPath === "string"
    ? value.inputPath
    : typeof value.bundlePath === "string"
      ? value.bundlePath
      : null;
  if (
    inputPath === null
    || !hasShape(value, {
      promotedAt: isString,
      split: isCalibrationSplit,
      sessionId: isString,
      title: isString,
      targets: isArrayOf(isString),
      source: (source): source is NonNullable<AutoresearchCalibrationCase["source"]> => (
        isRecord(source) && hasShape(source, {
          reportPath: isString,
          disagreementCount: isNumber,
        })
      ),
      summary: (summary): summary is NonNullable<AutoresearchCalibrationCase["summary"]> => (
        isRecord(summary) && hasShape(summary, {
          correctedCount: isNumber,
          invariantCount: isNumber,
          focusAreaCounts: isRecord,
        })
      ),
      expectations: isArrayOf((entry): entry is AutoresearchCalibrationExpectation => (
        validateAutoresearchCalibrationExpectation(entry) !== null
      )),
    }, {
      bundlePath: isString,
      inputPath: isString,
    })
  ) {
    return null;
  }

  const promotedAt = value.promotedAt as string;
  const split = value.split as AutoresearchCalibrationSplit;
  const sessionId = value.sessionId as string;
  const title = value.title as string;
  const targets = value.targets as string[];
  const semanticFamilies = Array.isArray(value.semanticFamilies)
    ? value.semanticFamilies.filter(isSemanticCalibrationFamily)
    : [];
  const source = value.source as Record<string, unknown>;
  const summary = value.summary as Record<string, unknown>;
  const expectations = value.expectations as AutoresearchCalibrationExpectation[];
  const focusAreaCounts = summary.focusAreaCounts as Record<string, unknown>;
  return {
    schemaVersion: AUTORESEARCH_CALIBRATION_CASE_SCHEMA_VERSION,
    promotedAt,
    split,
    sessionId,
    title,
    inputPath,
    ...(typeof value.bundlePath === "string" ? { bundlePath: value.bundlePath } : {}),
    targets: [...targets],
    semanticFamilies,
    source: {
      reportPath: source.reportPath as string,
      ...(typeof source.reviewer === "string" ? { reviewer: source.reviewer } : {}),
      ...(typeof source.model === "string" ? { model: source.model } : {}),
      disagreementCount: source.disagreementCount as number,
    },
    summary: {
      correctedCount: summary.correctedCount as number,
      invariantCount: summary.invariantCount as number,
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
    || !hasShape(value, {
      generatedAt: isString,
      rubricVersion: isString,
      bundle: (bundle): bundle is NonNullable<OfflineReviewReport["bundle"]> => (
        isRecord(bundle) && hasShape(bundle, {
          sessionId: isString,
          title: isString,
        })
      ),
      review: isRecord,
      summary: (summary): summary is NonNullable<OfflineReviewReport["summary"]> => (
        isRecord(summary) && hasShape(summary, {
          totalFindings: isNumber,
          disagreementCount: isNumber,
          matchedFindings: isNumber,
          disagreementsByFocusArea: isRecord,
        })
      ),
      disagreements: isArrayOf((entry): entry is OfflineReviewDisagreement => validateOfflineReviewDisagreement(entry) !== null),
    })
  ) {
    return null;
  }

  const bundle = value.bundle as Record<string, unknown>;
  const review = value.review as Record<string, unknown>;
  const summary = value.summary as Record<string, unknown>;
  const disagreements = value.disagreements as OfflineReviewDisagreement[];

  return {
    schemaVersion: value.schemaVersion as OfflineReviewReport["schemaVersion"],
    generatedAt: value.generatedAt as string,
    rubricVersion: value.rubricVersion as string,
    bundle: {
      sessionId: bundle.sessionId as string,
      title: bundle.title as string,
      ...(typeof bundle.description === "string" ? { description: bundle.description } : {}),
      ...(typeof bundle.bundlePath === "string" ? { bundlePath: bundle.bundlePath } : {}),
      ...(isRecord(bundle.source)
        ? { source: bundle.source as NonNullable<OfflineReviewReport["bundle"]["source"]> }
        : {}),
    },
    review: {
      ...(typeof review.reviewer === "string" ? { reviewer: review.reviewer } : {}),
      ...(typeof review.model === "string" ? { model: review.model } : {}),
      ...(typeof review.completedAt === "string" ? { completedAt: review.completedAt } : {}),
      ...(typeof review.notes === "string" ? { notes: review.notes } : {}),
    },
    summary: {
      totalFindings: summary.totalFindings as number,
      disagreementCount: summary.disagreementCount as number,
      matchedFindings: summary.matchedFindings as number,
      disagreementsByFocusArea: createFocusAreaCountsFromRecord(summary.disagreementsByFocusArea as Record<string, unknown>),
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
  const invariantCandidates: OfflineReviewFocusArea[] = [
    "status",
    "toolFamily",
    "consequence",
    "blocking",
    "episode",
    "confidence",
  ];
  return invariantCandidates.filter((focusArea) => !selectedFocusAreas.has(focusArea));
}

function resolveRepoRelativeCalibrationInputPath(
  inputPath: string | undefined,
  repoRoot: string,
): string {
  if (!inputPath) {
    throw new Error("Offline review report is missing bundle.bundlePath.");
  }
  return resolveRepoRelativePath(inputPath, repoRoot);
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
  return Object.fromEntries(
    DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.map((focusArea) => [focusArea, 0]),
  ) as Record<OfflineReviewFocusArea, number>;
}

function createSemanticFamilyCounts(): Record<ReplaySemanticCalibrationFamily, number> {
  return Object.fromEntries(
    SEMANTIC_CALIBRATION_FAMILIES.map((family) => [family, 0]),
  ) as Record<ReplaySemanticCalibrationFamily, number>;
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

function isSemanticCalibrationFamily(
  value: unknown,
): value is ReplaySemanticCalibrationFamily {
  return typeof value === "string"
    && (SEMANTIC_CALIBRATION_FAMILIES as readonly string[]).includes(value);
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

function collectSemanticFamilies(
  entries: Array<{
    focusArea: OfflineReviewFocusArea;
    apertureValue: string | string[] | boolean | null;
    expectedValue: string | string[] | boolean | null;
  }>,
): ReplaySemanticCalibrationFamily[] {
  const families = new Set<ReplaySemanticCalibrationFamily>();

  for (const entry of entries) {
    for (const family of deriveSemanticFamiliesForDifference(
      entry.focusArea,
      entry.apertureValue,
      entry.expectedValue,
    )) {
      families.add(family);
    }
  }

  return [...families].sort();
}

function deriveSemanticFamiliesForDifference(
  focusArea: OfflineReviewFocusArea,
  apertureValue: string | string[] | boolean | null,
  expectedValue: string | string[] | boolean | null,
): ReplaySemanticCalibrationFamily[] {
  switch (focusArea) {
    case "blocking":
      return ["blocking_missed"];
    case "episode":
      return ["episode_missed"];
    case "confidence": {
      const current = readConfidenceLevel(apertureValue);
      const expected = readConfidenceLevel(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentRank = confidenceRank(current);
      const expectedRank = confidenceRank(expected);
      if (currentRank > expectedRank) {
        return ["confidence_too_high"];
      }
      if (currentRank < expectedRank) {
        return ["confidence_too_low"];
      }
      return [];
    }
    case "consequence": {
      const current = readConsequenceLevel(apertureValue);
      const expected = readConsequenceLevel(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentRank = consequenceRank(current);
      const expectedRank = consequenceRank(expected);
      if (currentRank > expectedRank) {
        return ["consequence_overread"];
      }
      if (currentRank < expectedRank) {
        return ["consequence_underread"];
      }
      return [];
    }
    case "intentFrame": {
      const current = readIntentFrame(apertureValue);
      const expected = readIntentFrame(expectedValue);
      if (current === null || expected === null) {
        return [];
      }
      const currentAskLike = isAskLikeIntentFrame(current);
      const expectedAskLike = isAskLikeIntentFrame(expected);
      if (currentAskLike && !expectedAskLike) {
        return ["ask_overread"];
      }
      if (!currentAskLike && expectedAskLike) {
        return ["ask_missed"];
      }
      return [];
    }
    default:
      return [];
  }
}

function readConfidenceLevel(
  value: string | string[] | boolean | null,
): OfflineReviewConfidence | null {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return null;
}

function readConsequenceLevel(
  value: string | string[] | boolean | null,
): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const annotated = trimmed.match(/^(low|medium|high) consequence\s*;/);
    if (annotated?.[1] === "low" || annotated?.[1] === "medium" || annotated?.[1] === "high") {
      return annotated[1];
    }
  }

  return null;
}

function consequenceRank(value: "low" | "medium" | "high"): number {
  switch (value) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function readIntentFrame(
  value: string | string[] | boolean | null,
): string | null {
  return typeof value === "string" ? value : null;
}

function isAskLikeIntentFrame(value: string): boolean {
  return value === "approval_request"
    || value === "question_request"
    || value === "form_request";
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
