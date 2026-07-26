import {
  DATACLAW_DATASET,
  HUGGINGFACE_DATACLAW_DATASET,
  HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET,
  TRACE_COMMONS_AGENT_TRACES_DATASET,
} from "./public-trajectories-types.js";
import type {
  PublicCorpusDataset,
  PublicCorpusRunManifest,
  PublicCorpusSplit,
} from "./public-corpus-manifest.js";

export const TRACE_COMMONS_DATASET_URL =
  "https://huggingface.co/datasets/trace-commons/agent-traces" as const;
export const DATACLAW_DATASET_URL = "https://huggingface.co/datasets/woctordho/dataclaw" as const;

export function publicCorpusSourceMetadata(
  dataset: PublicCorpusDataset,
  _split: PublicCorpusSplit,
): {
  dataset: PublicCorpusRunManifest["source"]["dataset"];
  upstream: PublicCorpusRunManifest["source"]["upstream"];
  upstreamUrl: PublicCorpusRunManifest["source"]["upstreamUrl"];
  classification: PublicCorpusRunManifest["privacy"]["classification"];
  licenseScope: PublicCorpusRunManifest["privacy"]["licenseScope"];
} {
  switch (dataset) {
    case "dataclaw":
      return {
        dataset: DATACLAW_DATASET,
        upstream: HUGGINGFACE_DATACLAW_DATASET,
        upstreamUrl: DATACLAW_DATASET_URL,
        classification: "public_unredacted_review_required",
        licenseScope: "dataset_license_review_required_embedded_content_may_differ",
      };
    case "trace-commons":
      return {
        dataset: TRACE_COMMONS_AGENT_TRACES_DATASET,
        upstream: HUGGINGFACE_TRACE_COMMONS_AGENT_TRACES_DATASET,
        upstreamUrl: TRACE_COMMONS_DATASET_URL,
        classification: "public_anonymized_best_effort",
        licenseScope: "dataset_compilation_cc_by_4.0_embedded_content_may_differ",
      };
    default:
      return assertUnsupportedDataset(dataset);
  }
}

function assertUnsupportedDataset(value: never): never {
  throw new Error(`Unsupported public corpus dataset: ${value}`);
}
