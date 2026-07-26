import { fetchDataclawPage } from "./public-corpus-dataclaw-source.js";
import { fetchTraceCommonsPage } from "./public-corpus-trace-commons-source.js";
import type { PublicCorpusFetchLike, PublicCorpusSleep } from "./public-corpus-fetch-policy.js";
import type { PublicCorpusDataset, PublicCorpusSplit } from "./public-corpus-manifest.js";
import type { DataclawRow, TraceCommonsRow } from "./public-trajectories-types.js";

export type PublicCorpusRow = DataclawRow | TraceCommonsRow;
export type PublicCorpusRows = DataclawRow[] | TraceCommonsRow[];

export type PublicCorpusPageRequest = {
  dataset: PublicCorpusDataset;
  split: PublicCorpusSplit;
  offset: number;
  limit: number;
  timeoutMs: number;
  maxBytes: number;
  maxRetries: number;
  fetch?: PublicCorpusFetchLike;
  sleep?: PublicCorpusSleep;
};

export type PublicCorpusPageFetcher = (
  request: PublicCorpusPageRequest,
) => Promise<PublicCorpusRows>;

export async function fetchPublicCorpusPage(
  request: PublicCorpusPageRequest,
): Promise<PublicCorpusRows> {
  switch (request.dataset) {
    case "dataclaw":
      return fetchDataclawPage(request);
    case "trace-commons":
      return fetchTraceCommonsPage(request);
    default:
      return assertUnsupportedDataset(request.dataset);
  }
}

function assertUnsupportedDataset(value: never): never {
  throw new Error(`Unsupported public corpus dataset: ${value}`);
}
