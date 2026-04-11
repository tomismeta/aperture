import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AUTORESEARCH_BRIEFS_DIR,
  DEFAULT_AUTORESEARCH_CALIBRATION_SPLIT_DIRS,
  DEFAULT_AUTORESEARCH_EVALUATIONS_DIR,
  type AutoresearchCalibrationCase,
  type AutoresearchCalibrationReport,
  type AutoresearchOptimizationBrief,
} from "./autoresearch-calibration.js";

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

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
