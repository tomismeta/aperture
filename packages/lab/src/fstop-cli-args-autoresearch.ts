import path from "node:path";

import {
  DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS,
  DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY,
  defaultPublicTrajectorySplit,
  type AutoresearchCampaignProvider,
  type AutoresearchRunnerProvider,
  type AutoresearchServiceProvider,
  type AutoresearchSweepLane,
  type AutoresearchSweepPreset,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./index.js";
import {
  printCampaignUsage,
  printRunUsage,
  printServiceUsage,
  printSweepUsage,
} from "./fstop-cli-usage.js";
import {
  applySharedProviderArg,
  createSharedProviderState,
  printUsageAndExit,
  readDataset,
  readInteger,
  readPositiveInteger,
  readPublicSplit,
  readSweepLane,
  readSweepPreset,
  resolveSharedProviderState,
} from "./fstop-cli-args-support.js";
import type {
  CampaignCliOptions,
  RunCliOptions,
  ServiceCliOptions,
  SweepCliOptions,
} from "./fstop-cli-args.js";

export function parseRunArgs(argv: string[]): RunCliOptions {
  const providers = createSharedProviderState<AutoresearchRunnerProvider>("generic", {
    initializeReviewer: true,
    initializeOptimizer: true,
  });
  let inputFile: string | undefined;
  let batchReportPath: string | undefined;
  const bundlePaths: string[] = [];
  let dataset: PublicTrajectoryDataset | undefined;
  let split: PublicTrajectorySplit | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 3;
  let reviewConcurrency = DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY;
  let minSessionCount = 2;
  let maxReports = 4;
  let outputPath: string | undefined;
  let statusOutputPath: string | undefined;
  let gateTimeoutSeconds = DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS;
  let skipJudgmentBattle = false;
  let skipReleaseCheck = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: true })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--file":
        inputFile = path.resolve(argv[++index] ?? "");
        break;
      case "--batch-report":
        batchReportPath = path.resolve(argv[++index] ?? "");
        break;
      case "--bundle":
        bundlePaths.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readInteger(argv[++index], "--max-slices");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readInteger(argv[++index], "--max-reports");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--status-output":
        statusOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--gate-timeout-seconds":
        gateTimeoutSeconds = readPositiveInteger(argv[++index], "--gate-timeout-seconds");
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
        return printUsageAndExit(printRunUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);
  const resolvedDataset = dataset ?? "swe-smith";
  const resolvedSplit = split ?? defaultPublicTrajectorySplit(resolvedDataset);

  return {
    provider: resolvedProviders.provider,
    ...(inputFile ? { inputFile } : {}),
    ...(batchReportPath ? { batchReportPath } : {}),
    bundlePaths,
    dataset: resolvedDataset,
    split: resolvedSplit,
    ...(dataset ? { inputDatasetHint: dataset } : {}),
    ...(split ? { inputSplitHint: split } : {}),
    offset,
    limit,
    maxSlices,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    ...(outputPath ? { outputPath } : {}),
    ...(statusOutputPath ? { statusOutputPath } : {}),
    gateTimeoutSeconds,
    skipJudgmentBattle,
    skipReleaseCheck,
    json,
  };
}

export function parseCampaignArgs(argv: string[]): CampaignCliOptions {
  const providers = createSharedProviderState<AutoresearchCampaignProvider>("generic", {
    initializeReviewer: true,
    initializeOptimizer: true,
  });
  let dataset: CampaignCliOptions["dataset"] = "swe-smith";
  let split: CampaignCliOptions["split"] | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let stallThresholdSeconds = 900;
  let campaignId: string | undefined;
  let campaignRoot: string | undefined;
  let sourceRepo = process.cwd();
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: true })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--windows":
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--stall-threshold-seconds":
        stallThresholdSeconds = readPositiveInteger(argv[++index], "--stall-threshold-seconds");
        break;
      case "--campaign-id":
        campaignId = argv[++index];
        break;
      case "--campaign-root":
        campaignRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCampaignUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    dataset,
    split: split ?? defaultPublicTrajectorySplit(dataset),
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    stallThresholdSeconds,
    ...(campaignId ? { campaignId } : {}),
    ...(campaignRoot ? { campaignRoot } : {}),
    sourceRepo,
    json,
  };
}

export function parseServiceArgs(argv: string[]): ServiceCliOptions {
  const providers = createSharedProviderState<AutoresearchServiceProvider>("generic");
  let dataset: PublicTrajectoryDataset = "swe-smith";
  let split: PublicTrajectorySplit | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let maxRestarts = 3;
  let restartBackoffSeconds = 15;
  let campaignStallThresholdSeconds = 900;
  let serviceStallThresholdSeconds = 1200;
  let serviceId: string | undefined;
  let serviceRoot: string | undefined;
  let sourceRepo = process.cwd();
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: false })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readPositiveInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--max-restarts":
        maxRestarts = readInteger(argv[++index], "--max-restarts");
        break;
      case "--restart-backoff-seconds":
        restartBackoffSeconds = readPositiveInteger(argv[++index], "--restart-backoff-seconds");
        break;
      case "--campaign-stall-threshold-seconds":
        campaignStallThresholdSeconds = readPositiveInteger(argv[++index], "--campaign-stall-threshold-seconds");
        break;
      case "--service-stall-threshold-seconds":
        serviceStallThresholdSeconds = readPositiveInteger(argv[++index], "--service-stall-threshold-seconds");
        break;
      case "--service-id":
        serviceId = argv[++index];
        break;
      case "--service-root":
        serviceRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printServiceUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    dataset,
    split: split ?? defaultPublicTrajectorySplit(dataset),
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    maxRestarts,
    restartBackoffSeconds,
    campaignStallThresholdSeconds,
    serviceStallThresholdSeconds,
    ...(serviceId ? { serviceId } : {}),
    ...(serviceRoot ? { serviceRoot } : {}),
    sourceRepo,
    json,
  };
}

export function parseSweepArgs(argv: string[]): SweepCliOptions {
  const providers = createSharedProviderState<AutoresearchServiceProvider>("generic");
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let maxRestarts = 3;
  let restartBackoffSeconds = 15;
  let campaignStallThresholdSeconds = 900;
  let serviceStallThresholdSeconds = 1200;
  let sweepId: string | undefined;
  let sweepRoot: string | undefined;
  let sourceRepo = process.cwd();
  let preset: AutoresearchSweepPreset | undefined;
  const lanes: AutoresearchSweepLane[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: false })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--preset":
        preset = readSweepPreset(argv[++index]);
        break;
      case "--lane":
        lanes.push(readSweepLane(argv[++index]));
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readPositiveInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--max-restarts":
        maxRestarts = readInteger(argv[++index], "--max-restarts");
        break;
      case "--restart-backoff-seconds":
        restartBackoffSeconds = readPositiveInteger(argv[++index], "--restart-backoff-seconds");
        break;
      case "--campaign-stall-threshold-seconds":
        campaignStallThresholdSeconds = readPositiveInteger(argv[++index], "--campaign-stall-threshold-seconds");
        break;
      case "--service-stall-threshold-seconds":
        serviceStallThresholdSeconds = readPositiveInteger(argv[++index], "--service-stall-threshold-seconds");
        break;
      case "--sweep-id":
        sweepId = argv[++index];
        break;
      case "--sweep-root":
        sweepRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printSweepUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!preset && lanes.length === 0) {
    throw new Error("F-Stop sweep requires --preset or at least one --lane <dataset>/<split>.");
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    maxRestarts,
    restartBackoffSeconds,
    campaignStallThresholdSeconds,
    serviceStallThresholdSeconds,
    ...(sweepId ? { sweepId } : {}),
    ...(sweepRoot ? { sweepRoot } : {}),
    sourceRepo,
    ...(preset ? { preset } : {}),
    ...(lanes.length > 0 ? { lanes } : {}),
    json,
  };
}
