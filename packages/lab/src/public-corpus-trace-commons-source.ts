import {
  DEFAULT_TRACE_COMMONS_SPLIT,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
  type TraceCommonsRow,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { parseTraceCommonsRowsResponse } from "./public-trajectories-trace-commons-parse.js";
import {
  fetchJsonWithPolicy,
  type PublicCorpusFetchLike,
  type PublicCorpusSleep,
} from "./public-corpus-fetch-policy.js";

const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";

export const TRACE_COMMONS_ROWS_PAGE_LIMIT = 100 as const;

export type TraceCommonsPageRequest = {
  split?: TraceCommonsSplit;
  offset: number;
  limit: number;
  timeoutMs: number;
  maxRetries: number;
  fetch?: PublicCorpusFetchLike;
  sleep?: PublicCorpusSleep;
};

export type TraceCommonsPageFetcher = (
  request: TraceCommonsPageRequest,
) => Promise<TraceCommonsRow[]>;

export async function fetchTraceCommonsPage(
  request: TraceCommonsPageRequest,
): Promise<TraceCommonsRow[]> {
  if (request.limit > TRACE_COMMONS_ROWS_PAGE_LIMIT) {
    throw new Error(`Trace Commons page size must be <= ${TRACE_COMMONS_ROWS_PAGE_LIMIT}.`);
  }

  const query = new URLSearchParams({
    dataset: TRACE_COMMONS_AGENT_TRACES_DATASET,
    config: "default",
    split: request.split ?? DEFAULT_TRACE_COMMONS_SPLIT,
    offset: String(request.offset),
    length: String(request.limit),
  });
  const payload = await fetchJsonWithPolicy(
    `${HUGGING_FACE_DATASETS_SERVER}/rows?${query.toString()}`,
    {
      timeoutMs: request.timeoutMs,
      maxRetries: request.maxRetries,
      ...(request.fetch ? { fetch: request.fetch } : {}),
      ...(request.sleep ? { sleep: request.sleep } : {}),
    },
  );

  return parseTraceCommonsRowsResponse(payload);
}
