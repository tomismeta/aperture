import path from "node:path";

import type {
  AutoresearchCalibrationSplit,
  OfflineReviewConfidence,
  OfflineReviewFocusArea,
  OfflineReviewRecommendation,
} from "./index.js";
import { printCalibrationUsage } from "./fstop-cli-usage.js";
import {
  printUsageAndExit,
  readCalibrationSplit,
  readConfidence,
  readFocusArea,
  readRecommendation,
} from "./fstop-cli-args-support.js";

export type JsonOptions = {
  json: boolean;
};

export type CalibrationCommand = "cycle" | "evaluate" | "promote";

type PromoteOptions = JsonOptions & {
  command: "promote";
  focusAreas: OfflineReviewFocusArea[];
  includeStepInvariants: boolean;
  minimumConfidence?: OfflineReviewConfidence;
  outputPath?: string;
  recommendations: OfflineReviewRecommendation[];
  reportPath: string;
  split: AutoresearchCalibrationSplit;
};

type EvaluateOptions = JsonOptions & {
  command: "evaluate";
  extraCalibrationDirs: string[];
  outputPath?: string;
  splits: AutoresearchCalibrationSplit[];
};

type CycleOptions = JsonOptions & {
  briefOutputPath?: string;
  command: "cycle";
  extraCalibrationDirs: string[];
  outputPath?: string;
  splits: AutoresearchCalibrationSplit[];
};

export type CalibrationOptions = PromoteOptions | EvaluateOptions | CycleOptions;

export function parseCalibrationArgs(
  command: CalibrationCommand,
  argv: string[],
): CalibrationOptions {
  if (command === "promote") {
    return parsePromoteArgs(argv);
  }
  if (command === "evaluate") {
    return parseEvaluateArgs(argv);
  }
  return parseCycleArgs(argv);
}

function parsePromoteArgs(argv: string[]): PromoteOptions {
  let reportPath: string | undefined;
  let split: AutoresearchCalibrationSplit | undefined;
  let outputPath: string | undefined;
  const focusAreas: OfflineReviewFocusArea[] = [];
  const recommendations: OfflineReviewRecommendation[] = [];
  let minimumConfidence: OfflineReviewConfidence | undefined;
  let includeStepInvariants = true;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--report":
        reportPath = path.resolve(argv[++index] ?? "");
        break;
      case "--split":
        split = readCalibrationSplit(argv[++index]);
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--focus-area":
        focusAreas.push(readFocusArea(argv[++index]));
        break;
      case "--recommendation":
        recommendations.push(readRecommendation(argv[++index]));
        break;
      case "--minimum-confidence":
        minimumConfidence = readConfidence(argv[++index]);
        break;
      case "--no-step-invariants":
        includeStepInvariants = false;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCalibrationUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!reportPath) {
    throw new Error("--report is required.");
  }
  if (!split) {
    throw new Error("--split is required.");
  }

  return {
    command: "promote",
    reportPath,
    split,
    ...(outputPath ? { outputPath } : {}),
    focusAreas,
    recommendations: recommendations.length > 0 ? recommendations : ["promote"],
    ...(minimumConfidence ? { minimumConfidence } : {}),
    includeStepInvariants,
    json,
  };
}

function parseEvaluateArgs(argv: string[]): EvaluateOptions {
  const splits: AutoresearchCalibrationSplit[] = [];
  const extraCalibrationDirs: string[] = [];
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readCalibrationSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCalibrationUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command: "evaluate",
    splits,
    extraCalibrationDirs,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function parseCycleArgs(argv: string[]): CycleOptions {
  const splits: AutoresearchCalibrationSplit[] = [];
  const extraCalibrationDirs: string[] = [];
  let outputPath: string | undefined;
  let briefOutputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readCalibrationSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--brief-output":
        briefOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCalibrationUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command: "cycle",
    splits,
    extraCalibrationDirs,
    ...(outputPath ? { outputPath } : {}),
    ...(briefOutputPath ? { briefOutputPath } : {}),
    json,
  };
}
