import path from "node:path";

import { defaultLabRuntimeRoot } from "./index.js";
import {
  printGcUsage,
  printOptimizeUsage,
  printRoleUsage,
  printWorkflowSummaryUsage,
} from "./fstop-cli-usage.js";
import {
  printUsageAndExit,
  readInteger,
  readProvider,
} from "./fstop-cli-args-support.js";
import type {
  GcOptions,
  OptimizeCliOptions,
  Provider,
  RoleOptions,
  WorkflowSummaryCliOptions,
} from "./fstop-cli-args.js";

export function parseOptimizeArgs(argv: string[]): OptimizeCliOptions {
  let provider: Provider = "generic";
  let optimizerCommand: string | undefined;
  const extraCalibrationDirs: string[] = [];
  let outputPath: string | undefined;
  let promptPath: string | undefined;
  let rawOutputPath: string | undefined;
  let patchOutputPath: string | undefined;
  let beforeOutputPath: string | undefined;
  let afterOutputPath: string | undefined;
  let briefOutputPath: string | undefined;
  let json = false;
  let skipJudgmentBattle = false;
  let skipReleaseCheck = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--provider":
        provider = readProvider(argv[++index]);
        break;
      case "--optimizer-command":
        optimizerCommand = argv[++index];
        break;
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--prompt-output":
        promptPath = path.resolve(argv[++index] ?? "");
        break;
      case "--raw-output":
        rawOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--patch-output":
        patchOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--before-output":
        beforeOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--after-output":
        afterOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--brief-output":
        briefOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--skip-judgment-battle":
        skipJudgmentBattle = true;
        break;
      case "--skip-release-check":
        skipReleaseCheck = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printOptimizeUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(optimizerCommand ? { optimizerCommand } : {}),
    extraCalibrationDirs,
    ...(outputPath ? { outputPath } : {}),
    ...(promptPath ? { promptPath } : {}),
    ...(rawOutputPath ? { rawOutputPath } : {}),
    ...(patchOutputPath ? { patchOutputPath } : {}),
    ...(beforeOutputPath ? { beforeOutputPath } : {}),
    ...(afterOutputPath ? { afterOutputPath } : {}),
    ...(briefOutputPath ? { briefOutputPath } : {}),
    json,
    skipJudgmentBattle,
    skipReleaseCheck,
  };
}

export function parseGcArgs(argv: string[]): GcOptions {
  let runtimeRoot = defaultLabRuntimeRoot(process.cwd());
  let sourceRepo = process.cwd();
  let keepCampaigns = 5;
  let keepArtifacts = 50;
  let dryRun = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--runtime-root":
        runtimeRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--keep-campaigns":
        keepCampaigns = readInteger(argv[++index], "--keep-campaigns");
        break;
      case "--keep-artifacts":
        keepArtifacts = readInteger(argv[++index], "--keep-artifacts");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printGcUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    runtimeRoot,
    sourceRepo,
    keepCampaigns,
    keepArtifacts,
    dryRun,
    json,
  };
}

export function parseRoleArgs(argv: string[]): RoleOptions {
  let provider: Provider = "generic";
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--provider":
        provider = readProvider(argv[++index]);
        break;
      case "--command":
        command = argv[++index];
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printRoleUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(command ? { command } : {}),
  };
}

export function parseWorkflowSummaryArgs(argv: string[]): WorkflowSummaryCliOptions {
  const bundlePaths: string[] = [];
  const bundleDirectories: string[] = [];
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--bundle":
        bundlePaths.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--bundle-dir":
        bundleDirectories.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printWorkflowSummaryUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (bundlePaths.length === 0 && bundleDirectories.length === 0) {
    throw new Error("Provide at least one --bundle or --bundle-dir");
  }

  return {
    bundlePaths,
    bundleDirectories,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}
