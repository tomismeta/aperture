import { defaultPublicTrajectorySplit } from "./public-trajectories-shared.js";
import {
  type PublicTrajectoryDataset,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { TRACE_COMMONS_ROWS_PAGE_LIMIT } from "./public-corpus-trace-commons-source.js";
import {
  type PublicCorpusDataset,
  type PublicCorpusExistingPolicy,
  type PublicCorpusRunPlan,
} from "./public-corpus-manifest.js";

export function createPublicCorpusRunPlan(input: {
  dataset: PublicCorpusDataset;
  split: TraceCommonsSplit;
  offset: number;
  maxRows: number;
  pageSize: number;
  requestTimeoutSeconds: number;
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
    input.pageSize > TRACE_COMMONS_ROWS_PAGE_LIMIT
  ) {
    throw new Error(`--page-size must be between 1 and ${TRACE_COMMONS_ROWS_PAGE_LIMIT}`);
  }
  if (!Number.isSafeInteger(input.requestTimeoutSeconds) || input.requestTimeoutSeconds <= 0) {
    throw new Error("--request-timeout-seconds must be a positive integer");
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
    maxRetries: input.maxRetries,
    existing: input.existing,
    mirrorRaw: false,
    dryRun: input.dryRun,
    planOnly: input.planOnly,
  };
}

export function readSupportedCorpusDataset(value: PublicTrajectoryDataset): PublicCorpusDataset {
  if (value === "trace-commons") {
    return value;
  }
  throw new Error(
    "corpus-run currently supports trace-commons only; use trajectory-import for one-page diagnostics.",
  );
}

export function readTraceCommonsCorpusSplit(value: string | undefined): TraceCommonsSplit {
  if (value === undefined || value === "train") {
    return value ?? "train";
  }
  throw new Error("Trace Commons corpus runs support split: train");
}

export function defaultTraceCommonsCorpusSplit(dataset: PublicCorpusDataset): TraceCommonsSplit {
  return readTraceCommonsCorpusSplit(defaultPublicTrajectorySplit(dataset));
}
