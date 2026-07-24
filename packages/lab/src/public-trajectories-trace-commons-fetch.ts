import {
  DEFAULT_TRACE_COMMONS_SPLIT,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
  type ImportPublicTrajectoryBundlesOptions,
  type PublicTrajectorySplit,
  type TraceCommonsRow,
  type TraceCommonsSplit,
} from "./public-trajectories-types.js";
import { parseTraceCommonsRowsResponse } from "./public-trajectories-trace-commons-parse.js";

const HUGGING_FACE_DATASETS_SERVER = "https://datasets-server.huggingface.co";
const HUGGING_FACE_ROWS_LIMIT = 100;

export { parseTraceCommonsRowsResponse } from "./public-trajectories-trace-commons-parse.js";

export async function fetchTraceCommonsRows(
  options: Pick<ImportPublicTrajectoryBundlesOptions, "split" | "offset" | "limit"> = {},
): Promise<TraceCommonsRow[]> {
  const split = options.split ?? DEFAULT_TRACE_COMMONS_SPLIT;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  if (limit > HUGGING_FACE_ROWS_LIMIT) {
    throw new Error(`Trace Commons import limit must be <= ${HUGGING_FACE_ROWS_LIMIT}; use offset paging for larger imports.`);
  }
  const query = new URLSearchParams({
    dataset: TRACE_COMMONS_AGENT_TRACES_DATASET,
    config: "default",
    split,
    offset: String(offset),
    length: String(limit),
  });

  const response = await fetch(`${HUGGING_FACE_DATASETS_SERVER}/rows?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Trace Commons rows: ${response.status} ${response.statusText}`);
  }

  return parseTraceCommonsRowsResponse(await response.json());
}

export function readTraceCommonsSplit(
  value: PublicTrajectorySplit | undefined,
): TraceCommonsSplit {
  if (value === undefined || value === "train") {
    return value ?? DEFAULT_TRACE_COMMONS_SPLIT;
  }

  throw new Error("Trace Commons split must be: train");
}
