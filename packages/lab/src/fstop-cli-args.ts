import {
  type AutoresearchCampaignCommandOptions,
  type AutoresearchRunCommandOptions,
  type AutoresearchServiceCommandOptions,
  type AutoresearchSweepCommandOptions,
  type ImportTrajectoryBundlesFromFileOptions,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./index.js";
export {
  parseCampaignArgs,
  parseRunArgs,
  parseServiceArgs,
  parseSweepArgs,
} from "./fstop-cli-args-autoresearch.js";
export { parseIngestArgs, parseTrajectoryImportArgs } from "./fstop-cli-args-ingest.js";
export {
  parseCorpusRunArgs,
  type CorpusRunCliOptions,
} from "./fstop-cli-args-corpus.js";
export {
  parseCorpusPruneArgs,
  type CorpusPruneCliOptions,
} from "./fstop-cli-args-corpus-prune.js";
export {
  parseGcArgs,
  parseOptimizeArgs,
  parseRoleArgs,
  parseWorkflowSummaryArgs,
} from "./fstop-cli-args-ops.js";
export {
  parseReviewCandidateArgs,
  type ReviewCandidateCliOptions,
} from "./fstop-cli-args-review-candidates.js";
export {
  parseCalibrationArgs,
  type CalibrationCommand,
  type CalibrationOptions,
} from "./fstop-cli-args-calibration.js";
export {
  parseReviewArgs,
  type ReviewCliOptions,
  type ReviewCommand,
} from "./fstop-cli-args-review.js";

export type { Provider } from "./fstop-cli-args-support.js";

type Provider = import("./fstop-cli-args-support.js").Provider;

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

export type Role = "optimizer" | "reviewer";

export type RoleOptions = {
  command?: string;
  provider: Provider;
};

export type WorkflowSummaryCliOptions = JsonOptions & {
  bundlePaths: string[];
  bundleDirectories: string[];
  outputPath?: string;
};

export type ServiceCliOptions = AutoresearchServiceCommandOptions & JsonOptions;
export type SweepCliOptions = AutoresearchSweepCommandOptions & JsonOptions;
export type CampaignCliOptions = AutoresearchCampaignCommandOptions & JsonOptions;
export type RunCliOptions = AutoresearchRunCommandOptions &
  JsonOptions &
  Partial<{
    inputDatasetHint: PublicTrajectoryDataset;
    inputSplitHint: PublicTrajectorySplit;
  }>;
