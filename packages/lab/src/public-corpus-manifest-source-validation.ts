import {
  DATACLAW_DATASET,
  HUGGINGFACE_DATACLAW_DATASET,
  HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
} from "./public-trajectories-types.js";
import {
  DATACLAW_DATASET_URL,
  TRACE_COMMONS_DATASET_URL,
  type PublicCorpusDataset,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";

export function isPublicCorpusSource(
  value: unknown,
  dataset: PublicCorpusDataset,
): value is PublicCorpusRunManifest["source"] {
  if (typeof value !== "object" || value === null) return false;
  const source = value as PublicCorpusRunManifest["source"];
  return (
    source.kind === "public-trajectory" &&
    source.adapter === dataset &&
    source.config === "default" &&
    source.split === "train" &&
    source.requestedRevision === "live_rows_api_unpinned" &&
    source.resolvedRevision === "live_rows_api_unpinned" &&
    source.reproducibility === "digest-verifiable" &&
    isDatasetSourceIdentity(source, dataset)
  );
}

function isDatasetSourceIdentity(
  source: PublicCorpusRunManifest["source"],
  dataset: PublicCorpusDataset,
): boolean {
  if (dataset === "dataclaw") {
    return (
      source.dataset === DATACLAW_DATASET &&
      source.upstream === HUGGINGFACE_DATACLAW_DATASET &&
      source.upstreamUrl === DATACLAW_DATASET_URL
    );
  }
  return (
    source.dataset === TRACE_COMMONS_AGENT_TRACES_DATASET &&
    source.upstream === HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET &&
    source.upstreamUrl === TRACE_COMMONS_DATASET_URL
  );
}
