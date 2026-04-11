import { ALL_OFFLINE_REVIEW_FOCUS_AREAS } from "./offline-review.js";
import { SEMANTIC_CALIBRATION_FAMILIES } from "./semantic-calibration.js";
import type {
  AutoresearchCalibrationReport,
  AutoresearchOptimizationBrief,
} from "./autoresearch-calibration.js";

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

  for (const focusArea of ALL_OFFLINE_REVIEW_FOCUS_AREAS) {
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

function renderCalibrationValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}
