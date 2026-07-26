import { importDataclawCorpusRows } from "./public-corpus-runner-dataclaw-records.js";
import { importTraceCommonsCorpusRows } from "./public-corpus-runner-trace-commons-records.js";
import { type DataclawRow, type TraceCommonsRow } from "./public-trajectories-types.js";
import { type PublicCorpusRunManifest } from "./public-corpus-manifest.js";
import { type PublicCorpusLedgerSnapshot } from "./public-corpus-ledger.js";
import type { PublicCorpusRows } from "./public-corpus-runner-source.js";

export async function importPublicCorpusRows(input: {
  rows: PublicCorpusRows;
  offset: number;
  manifest: PublicCorpusRunManifest;
  ledger: PublicCorpusLedgerSnapshot;
  bundlePaths: string[];
  bundleDigests: `sha256:${string}`[];
}): Promise<void> {
  switch (input.manifest.plan.dataset) {
    case "dataclaw":
      return importDataclawCorpusRows({
        ...input,
        rows: input.rows as DataclawRow[],
      });
    case "trace-commons":
      return importTraceCommonsCorpusRows({
        ...input,
        rows: input.rows as TraceCommonsRow[],
      });
    default:
      return assertUnsupportedDataset(input.manifest.plan.dataset);
  }
}

function assertUnsupportedDataset(value: never): never {
  throw new Error(`Unsupported public corpus dataset: ${value}`);
}
