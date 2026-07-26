import {
  DATACLAW_DATASET,
  DEFAULT_DATACLAW_SPLIT,
  type DataclawRow,
  type DataclawSplit,
} from "./public-trajectories-types.js";
import { parseDataclawRowsResponse } from "./public-trajectories-dataclaw-fetch.js";
import {
  fetchJsonWithPolicy,
  type PublicCorpusFetchLike,
  type PublicCorpusSleep,
} from "./public-corpus-fetch-policy.js";

const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";

export const DATACLAW_ROWS_PAGE_LIMIT = 100 as const;

export type DataclawPageRequest = {
  split?: DataclawSplit;
  offset: number;
  limit: number;
  timeoutMs: number;
  maxBytes: number;
  maxRetries: number;
  fetch?: PublicCorpusFetchLike;
  sleep?: PublicCorpusSleep;
};

export type DataclawPageFetcher = (request: DataclawPageRequest) => Promise<DataclawRow[]>;

export async function fetchDataclawPage(request: DataclawPageRequest): Promise<DataclawRow[]> {
  if (request.limit > DATACLAW_ROWS_PAGE_LIMIT) {
    throw new Error(`DataClaw page size must be <= ${DATACLAW_ROWS_PAGE_LIMIT}.`);
  }

  const query = new URLSearchParams({
    dataset: DATACLAW_DATASET,
    config: "default",
    split: request.split ?? DEFAULT_DATACLAW_SPLIT,
    offset: String(request.offset),
    length: String(request.limit),
  });
  const payload = await fetchJsonWithPolicy(
    `${HUGGING_FACE_DATASETS_SERVER}/rows?${query.toString()}`,
    {
      timeoutMs: request.timeoutMs,
      maxBytes: request.maxBytes,
      maxRetries: request.maxRetries,
      ...(request.fetch ? { fetch: request.fetch } : {}),
      ...(request.sleep ? { sleep: request.sleep } : {}),
    },
  );

  return parseDataclawRowsResponse(payload);
}
