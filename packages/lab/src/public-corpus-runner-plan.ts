import { defaultPublicTrajectorySplit } from "./public-trajectories-shared.js";
import { type PublicTrajectoryDataset } from "./public-trajectories-types.js";
import { DATACLAW_ROWS_PAGE_LIMIT } from "./public-corpus-dataclaw-source.js";
import { TRACE_COMMONS_ROWS_PAGE_LIMIT } from "./public-corpus-trace-commons-source.js";
import {
  MAX_PUBLIC_CORPUS_RESPONSE_BYTES,
  type PublicCorpusDataset,
  type PublicCorpusExistingPolicy,
  type PublicCorpusRunPlan,
  type PublicCorpusSplit,
} from "./public-corpus-manifest.js";

export const DEFAULT_DATACLAW_PUBLIC_CORPUS_PAGE_SIZE = 1 as const;

export function createPublicCorpusRunPlan(input: {
  dataset: PublicCorpusDataset;
  split: PublicCorpusSplit;
  offset: number;
  maxRows: number;
  pageSize: number;
  requestTimeoutSeconds: number;
  maxResponseBytes: number;
  maxRetries: number;
  existing: PublicCorpusExistingPolicy;
  dryRun: boolean;
  planOnly: boolean;
}): PublicCorpusRunPlan {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error("--offset must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(input.maxRows) || input.maxRows <= 0) {
    throw new Error("--max-rows must be a positive integer");
  }
  if (!Number.isSafeInteger(input.offset + input.maxRows)) {
    throw new Error("--offset plus --max-rows must remain a safe integer");
  }
  if (
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize <= 0 ||
    input.pageSize > publicCorpusPageLimit(input.dataset)
  ) {
    throw new Error(
      `--page-size must be between 1 and ${publicCorpusPageLimit(input.dataset)} for ${input.dataset}`,
    );
  }
  if (!Number.isSafeInteger(input.requestTimeoutSeconds) || input.requestTimeoutSeconds <= 0) {
    throw new Error("--request-timeout-seconds must be a positive integer");
  }
  if (
    !Number.isSafeInteger(input.maxResponseBytes) ||
    input.maxResponseBytes <= 0 ||
    input.maxResponseBytes > MAX_PUBLIC_CORPUS_RESPONSE_BYTES
  ) {
    throw new Error(
      `--max-response-bytes must be between 1 and ${MAX_PUBLIC_CORPUS_RESPONSE_BYTES}`,
    );
  }
  if (!Number.isSafeInteger(input.maxRetries) || input.maxRetries < 0) {
    throw new Error("--max-retries must be a non-negative safe integer");
  }

  return {
    dataset: input.dataset,
    split: input.split,
    startOffset: input.offset,
    maxRows: input.maxRows,
    pageSize: input.pageSize,
    requestTimeoutSeconds: input.requestTimeoutSeconds,
    maxResponseBytes: input.maxResponseBytes,
    maxRetries: input.maxRetries,
    existing: input.existing,
    mirrorRaw: false,
    dryRun: input.dryRun,
    planOnly: input.planOnly,
  };
}

export function readSupportedCorpusDataset(value: PublicTrajectoryDataset): PublicCorpusDataset {
  if (value === "dataclaw" || value === "trace-commons") {
    return value;
  }
  throw new Error(
    "corpus-run currently supports dataclaw and trace-commons; use trajectory-import for one-page diagnostics.",
  );
}

export function readPublicCorpusSplit(
  dataset: PublicCorpusDataset,
  value: string | undefined,
): PublicCorpusSplit {
  if (value === undefined || value === "train") {
    return value ?? "train";
  }
  throw new Error(`${dataset} corpus runs support split: train`);
}

export function defaultPublicCorpusSplit(dataset: PublicCorpusDataset): PublicCorpusSplit {
  return readPublicCorpusSplit(dataset, defaultPublicTrajectorySplit(dataset));
}

export function defaultPublicCorpusPageSize(dataset: PublicCorpusDataset): number {
  return dataset === "dataclaw"
    ? DEFAULT_DATACLAW_PUBLIC_CORPUS_PAGE_SIZE
    : TRACE_COMMONS_ROWS_PAGE_LIMIT / 4;
}

function publicCorpusPageLimit(dataset: PublicCorpusDataset): number {
  return dataset === "dataclaw" ? DATACLAW_ROWS_PAGE_LIMIT : TRACE_COMMONS_ROWS_PAGE_LIMIT;
}
