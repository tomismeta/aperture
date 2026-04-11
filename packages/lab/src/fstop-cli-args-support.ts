import type {
  AutoresearchCalibrationSplit,
  AutoresearchSweepLane,
  AutoresearchSweepPreset,
  OfflineReviewConfidence,
  OfflineReviewFocusArea,
  OfflineReviewRecommendation,
  PublicTrajectoryDataset,
  PublicTrajectorySplit,
} from "./index.js";

export type Provider = "generic" | "hermes" | "openclaw";

export type SharedProviderState<T extends Provider> = {
  provider: T;
  reviewerProvider?: T;
  optimizerProvider?: T;
};

export function createSharedProviderState<T extends Provider>(
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

export function applySharedProviderArg<T extends Provider>(
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

export function resolveSharedProviderState<T extends Provider>(
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

export function readProvider(value: string | undefined): Provider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }
  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

export function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (
    value === "swe-smith" ||
    value === "dataclaw" ||
    value === "pi" ||
    value === "open-agent-sessions"
  ) {
    return value;
  }
  if (
    value === "pi-mono" ||
    value === "pi-sessions" ||
    value === "badlogicgames/pi-mono" ||
    value === "0xSero/pi-sessions"
  ) {
    return "pi";
  }
  throw new Error("--dataset must be: swe-smith, dataclaw, pi, open-agent-sessions");
}

export function readPublicSplit(value: string | undefined): PublicTrajectorySplit {
  if (
    value === "tool" ||
    value === "xml" ||
    value === "ticks" ||
    value === "train" ||
    value === "approved"
  ) {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks, train, approved");
}

export function readSweepPreset(value: string | undefined): AutoresearchSweepPreset {
  if (value === "pre-release") {
    return value;
  }
  throw new Error("--preset must be: pre-release");
}

export function readSweepLane(value: string | undefined): AutoresearchSweepLane {
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

export function readCalibrationSplit(value: string | undefined): AutoresearchCalibrationSplit {
  if (value === "train" || value === "validation" || value === "heldout") {
    return value;
  }
  throw new Error(`Invalid split: ${value ?? "(missing)"}`);
}

export function readFocusArea(value: string | undefined): OfflineReviewFocusArea {
  if (
    value === "title" ||
    value === "summary" ||
    value === "status" ||
    value === "ask" ||
    value === "intentFrame" ||
    value === "toolFamily" ||
    value === "consequence" ||
    value === "blocking" ||
    value === "episode" ||
    value === "confidence" ||
    value === "source"
  ) {
    return value;
  }
  throw new Error(`Invalid focus area: ${value ?? "(missing)"}`);
}

export function readFocusAreas(raw: string | undefined): OfflineReviewFocusArea[] {
  const parts = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (parts.length === 0) {
    throw new Error("--focus requires a comma-separated list");
  }
  return parts.map((part) => readFocusArea(part));
}

export function readRecommendation(value: string | undefined): OfflineReviewRecommendation {
  if (value === "promote" || value === "inspect" || value === "ignore") {
    return value;
  }
  throw new Error(`Invalid recommendation: ${value ?? "(missing)"}`);
}

export function readConfidence(value: string | undefined): OfflineReviewConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  throw new Error(`Invalid confidence: ${value ?? "(missing)"}`);
}

export function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = readInteger(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function printUsageAndExit(printUsage: () => void): never {
  printUsage();
  process.exit(0);
}
