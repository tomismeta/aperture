import path from "node:path";

import {
  DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS,
  DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY,
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
  defaultLabRuntimeRoot,
  defaultPublicTrajectorySplit,
  type AutoresearchCalibrationSplit,
  type AutoresearchCampaignCommandOptions,
  type AutoresearchCampaignProvider,
  type AutoresearchRunCommandOptions,
  type AutoresearchRunnerProvider,
  type AutoresearchServiceCommandOptions,
  type AutoresearchServiceProvider,
  type AutoresearchSweepCommandOptions,
  type AutoresearchSweepLane,
  type AutoresearchSweepPreset,
  type ImportPublicTrajectoryBundlesOptions,
  type ImportTrajectoryBundlesFromFileOptions,
  type OfflineReviewConfidence,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./index.js";
import {
  printCalibrationUsage,
  printCampaignUsage,
  printCompareUsage,
  printGcUsage,
  printIngestUsage,
  printOptimizeUsage,
  printPrepareUsage,
  printPromptUsage,
  printReviewRunUsage,
  printRoleUsage,
  printRunUsage,
  printServiceUsage,
  printSweepUsage,
  printTrajectoryImportUsage,
} from "./fstop-cli-usage.js";

export type Provider = "generic" | "hermes" | "openclaw";

export type JsonOptions = {
  json: boolean;
};

export type GcOptions = JsonOptions & {
  dryRun: boolean;
  keepArtifacts: number;
  keepCampaigns: number;
  runtimeRoot: string;
  sourceRepo: string;
};

export type IngestOptions = ImportTrajectoryBundlesFromFileOptions & JsonOptions;

export type ReviewCommand = "prepare" | "prompt" | "compare" | "review-run";

type ReviewPrepareOptions = JsonOptions & {
  command: "prepare";
  bundlePath: string;
  outputPath?: string;
  rubricVersion?: string;
  focusAreas: OfflineReviewFocusArea[];
};

type ReviewPromptOptions = JsonOptions & {
  command: "prompt";
  artifactPath: string;
  outputPath?: string;
};

type ReviewCompareOptions = JsonOptions & {
  command: "compare";
  artifactPath: string;
  outputPath?: string;
  failOnDisagreement: boolean;
};

type ReviewRunOptions = JsonOptions & {
  command: "review-run";
  artifactPath: string;
  responsePath?: string;
  responseFromStdin: boolean;
  reviewerCommand?: string;
  promptPath?: string;
  rawResponsePath?: string;
  responseArtifactPath?: string;
  outputPath?: string;
  recommendationPath?: string;
  runPath?: string;
  failOnDisagreement: boolean;
};

export type ReviewCliOptions =
  | ReviewPrepareOptions
  | ReviewPromptOptions
  | ReviewCompareOptions
  | ReviewRunOptions;

export type CalibrationCommand = "cycle" | "evaluate" | "promote";

export type OptimizeCliOptions = JsonOptions & {
  provider: Provider;
  optimizerCommand?: string;
  extraCalibrationDirs: string[];
  outputPath?: string;
  promptPath?: string;
  rawOutputPath?: string;
  patchOutputPath?: string;
  beforeOutputPath?: string;
  afterOutputPath?: string;
  briefOutputPath?: string;
  skipJudgmentBattle: boolean;
  skipReleaseCheck: boolean;
};

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

export type Role = "optimizer" | "reviewer";

export type RoleOptions = {
  command?: string;
  provider: Provider;
};

export type ServiceCliOptions = AutoresearchServiceCommandOptions & JsonOptions;
export type SweepCliOptions = AutoresearchSweepCommandOptions & JsonOptions;
export type CampaignCliOptions = AutoresearchCampaignCommandOptions & JsonOptions;
export type RunCliOptions = AutoresearchRunCommandOptions & JsonOptions & Partial<{
  inputDatasetHint: PublicTrajectoryDataset;
  inputSplitHint: PublicTrajectorySplit;
}>;

type SharedProviderState<T extends Provider> = {
  provider: T;
  reviewerProvider?: T;
  optimizerProvider?: T;
};

function createSharedProviderState<T extends Provider>(
  provider: T,
  options: {
    initializeReviewer?: boolean;
    initializeOptimizer?: boolean;
  } = {},
): SharedProviderState<T> {
  return {
    provider,
    ...(options.initializeReviewer ? { reviewerProvider: provider } : {}),
    ...(options.initializeOptimizer ? { optimizerProvider: provider } : {}),
  };
}

function applySharedProviderArg<T extends Provider>(
  state: SharedProviderState<T>,
  arg: string | undefined,
  value: string | undefined,
  options: {
    propagatePrimaryProvider: boolean;
  },
): boolean {
  switch (arg) {
    case "--provider": {
      const provider = readProvider(value) as T;
      state.provider = provider;
      if (options.propagatePrimaryProvider) {
        if (state.reviewerProvider === undefined || state.reviewerProvider === "generic") {
          state.reviewerProvider = provider;
        }
        if (state.optimizerProvider === undefined || state.optimizerProvider === "generic") {
          state.optimizerProvider = provider;
        }
      }
      return true;
    }
    case "--reviewer-provider":
      state.reviewerProvider = readProvider(value) as T;
      return true;
    case "--optimizer-provider":
      state.optimizerProvider = readProvider(value) as T;
      return true;
    default:
      return false;
  }
}

function resolveSharedProviderState<T extends Provider>(
  state: SharedProviderState<T>,
): {
  provider: T;
  reviewerProvider: T;
  optimizerProvider: T;
} {
  return {
    provider: state.provider,
    reviewerProvider: state.reviewerProvider ?? state.provider,
    optimizerProvider: state.optimizerProvider ?? state.reviewerProvider ?? state.provider,
  };
}

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
        printRunUsage();
        process.exit(0);
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
        printCampaignUsage();
        process.exit(0);
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
        printServiceUsage();
        process.exit(0);
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
        printSweepUsage();
        process.exit(0);
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

export function parseIngestArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {
    filePath: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--file":
        options.filePath = path.resolve(argv[++index] ?? "");
        break;
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readPublicSplit(argv[++index]);
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printIngestUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.dataset && !options.split) {
    options.split = defaultPublicTrajectorySplit(options.dataset);
  }
  options.outputDirectory ??= DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR;
  return options;
}

export function parseReviewArgs(command: ReviewCommand, argv: string[]): ReviewCliOptions {
  switch (command) {
    case "prepare":
      return parseReviewPrepareArgs(argv);
    case "prompt":
      return parseReviewPromptArgs(argv);
    case "compare":
      return parseReviewCompareArgs(argv);
    case "review-run":
      return parseReviewRunArgs(argv);
  }
}

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
        printOptimizeUsage();
        process.exit(0);
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

function parseReviewPrepareArgs(argv: string[]): ReviewPrepareOptions {
  let bundlePath: string | undefined;
  let outputPath: string | undefined;
  let rubricVersion: string | undefined;
  let focusAreas: OfflineReviewFocusArea[] = [...DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--bundle":
        bundlePath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--rubric-version":
        rubricVersion = argv[++index];
        break;
      case "--focus":
        focusAreas = readFocusAreas(argv[++index]);
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printPrepareUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for prepare: ${arg}`);
    }
  }

  if (!bundlePath) {
    throw new Error("--bundle is required");
  }

  return {
    command: "prepare",
    bundlePath,
    ...(outputPath ? { outputPath } : {}),
    ...(rubricVersion ? { rubricVersion } : {}),
    focusAreas,
    json,
  };
}

function parseReviewPromptArgs(argv: string[]): ReviewPromptOptions {
  let artifactPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printPromptUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for prompt: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  return {
    command: "prompt",
    artifactPath,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function parseReviewCompareArgs(argv: string[]): ReviewCompareOptions {
  let artifactPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;
  let failOnDisagreement = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--fail-on-disagreement":
        failOnDisagreement = true;
        break;
      case "--help":
      case "-h":
        printCompareUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for compare: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  return {
    command: "compare",
    artifactPath,
    ...(outputPath ? { outputPath } : {}),
    failOnDisagreement,
    json,
  };
}

function parseReviewRunArgs(argv: string[]): ReviewRunOptions {
  let artifactPath: string | undefined;
  let responsePath: string | undefined;
  let responseFromStdin = false;
  let reviewerCommand: string | undefined;
  let promptPath: string | undefined;
  let rawResponsePath: string | undefined;
  let responseArtifactPath: string | undefined;
  let outputPath: string | undefined;
  let recommendationPath: string | undefined;
  let runPath: string | undefined;
  let json = false;
  let failOnDisagreement = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--response":
        responsePath = path.resolve(argv[++index] ?? "");
        break;
      case "--response-stdin":
        responseFromStdin = true;
        break;
      case "--reviewer-command":
        reviewerCommand = argv[++index];
        break;
      case "--prompt":
        promptPath = path.resolve(argv[++index] ?? "");
        break;
      case "--raw-response-output":
        rawResponsePath = path.resolve(argv[++index] ?? "");
        break;
      case "--response-artifact":
        responseArtifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--recommendation-output":
        recommendationPath = path.resolve(argv[++index] ?? "");
        break;
      case "--run-output":
        runPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--fail-on-disagreement":
        failOnDisagreement = true;
        break;
      case "--help":
      case "-h":
        printReviewRunUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for review-run: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  const responseSourceCount =
    Number(responseFromStdin)
    + Number(Boolean(responsePath))
    + Number(Boolean(reviewerCommand));
  if (responseSourceCount !== 1) {
    throw new Error("Provide exactly one of --response, --response-stdin, or --reviewer-command");
  }

  return {
    command: "review-run",
    artifactPath,
    ...(responsePath ? { responsePath } : {}),
    responseFromStdin,
    ...(reviewerCommand ? { reviewerCommand } : {}),
    ...(promptPath ? { promptPath } : {}),
    ...(rawResponsePath ? { rawResponsePath } : {}),
    ...(responseArtifactPath ? { responseArtifactPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(recommendationPath ? { recommendationPath } : {}),
    ...(runPath ? { runPath } : {}),
    failOnDisagreement,
    json,
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
        printGcUsage();
        process.exit(0);
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

export function parseCalibrationArgs(command: CalibrationCommand, argv: string[]): CalibrationOptions {
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
        printCalibrationUsage();
        process.exit(0);
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
        printCalibrationUsage();
        process.exit(0);
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
        printCalibrationUsage();
        process.exit(0);
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
        printRoleUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(command ? { command } : {}),
  };
}

export function parseTrajectoryImportArgs(argv: string[]): ImportPublicTrajectoryBundlesOptions {
  const options: ImportPublicTrajectoryBundlesOptions = {
    dataset: "swe-smith",
    offset: 0,
    limit: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        options.offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        options.limit = readInteger(argv[++index], "--limit");
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printTrajectoryImportUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.split ??= defaultPublicTrajectorySplit(options.dataset ?? "swe-smith");
  options.outputDirectory ??= DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR;
  return options;
}

function readProvider(value: string | undefined): Provider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }
  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith" || value === "dataclaw" || value === "pi" || value === "open-agent-sessions") {
    return value;
  }
  if (
    value === "pi-mono"
    || value === "pi-sessions"
    || value === "badlogicgames/pi-mono"
    || value === "0xSero/pi-sessions"
  ) {
    return "pi";
  }
  throw new Error("--dataset must be: swe-smith, dataclaw, pi, open-agent-sessions");
}

function readPublicSplit(value: string | undefined): PublicTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks" || value === "train" || value === "approved") {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks, train, approved");
}

function readSweepPreset(value: string | undefined): AutoresearchSweepPreset {
  if (value === "pre-release") {
    return value;
  }
  throw new Error("--preset must be: pre-release");
}

function readSweepLane(value: string | undefined): AutoresearchSweepLane {
  const raw = (value ?? "").trim();
  const separator = raw.includes("/") ? "/" : raw.includes(":") ? ":" : undefined;
  if (!separator) {
    throw new Error("--lane must look like <dataset>/<split>");
  }
  const [datasetRaw, splitRaw] = raw.split(separator);
  return {
    dataset: readDataset(datasetRaw),
    split: readPublicSplit(splitRaw),
  };
}

function readCalibrationSplit(value: string | undefined): AutoresearchCalibrationSplit {
  if (value === "train" || value === "validation" || value === "heldout") {
    return value;
  }
  throw new Error(`Invalid split: ${value ?? "(missing)"}`);
}

function readFocusArea(value: string | undefined): OfflineReviewFocusArea {
  if (
    value === "title"
    || value === "summary"
    || value === "status"
    || value === "ask"
    || value === "intentFrame"
    || value === "toolFamily"
    || value === "consequence"
    || value === "blocking"
    || value === "episode"
    || value === "confidence"
    || value === "source"
  ) {
    return value;
  }
  throw new Error(`Invalid focus area: ${value ?? "(missing)"}`);
}

function readFocusAreas(raw: string | undefined): OfflineReviewFocusArea[] {
  const parts = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (parts.length === 0) {
    throw new Error("--focus requires a comma-separated list");
  }
  return parts.map((part) => readFocusArea(part));
}

function readRecommendation(value: string | undefined): OfflineReviewRecommendation {
  if (value === "promote" || value === "inspect" || value === "ignore") {
    return value;
  }
  throw new Error(`Invalid recommendation: ${value ?? "(missing)"}`);
}

function readConfidence(value: string | undefined): OfflineReviewConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  throw new Error(`Invalid confidence: ${value ?? "(missing)"}`);
}

function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = readInteger(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}
