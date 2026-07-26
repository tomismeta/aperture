import {
  createImportedSessionFromTraceCommonsRow,
  createSessionBundleFromTraceCommonsRow,
} from "./public-trajectories-trace-commons.js";
import { defaultImportedTrajectoryBundlePath } from "./public-trajectories-shared.js";
import { type TraceCommonsRow } from "./public-trajectories-types.js";
import {
  appendPublicCorpusRecord,
  digestJsonValue,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
} from "./public-corpus-manifest.js";
import {
  assertPublicCorpusOffsetDigest,
  isPublicCorpusRecordAlreadyRecorded,
  recordPublicCorpusLedgerError,
  recordPublicCorpusLedgerSuccess,
  type PublicCorpusLedgerSnapshot,
} from "./public-corpus-ledger.js";
import {
  isFatalPublicCorpusRecordError,
  persistPublicCorpusBundleRecord,
} from "./public-corpus-runner-support.js";

export async function importTraceCommonsCorpusRows(input: {
  rows: TraceCommonsRow[];
  offset: number;
  manifest: PublicCorpusRunManifest;
  ledger: PublicCorpusLedgerSnapshot;
  bundlePaths: string[];
  bundleDigests: `sha256:${string}`[];
}): Promise<void> {
  for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex += 1) {
    await importTraceCommonsCorpusRow({
      row: input.rows[rowIndex]!,
      rowIndex,
      sourceOffset: input.offset + rowIndex,
      manifest: input.manifest,
      ledger: input.ledger,
      bundlePaths: input.bundlePaths,
      bundleDigests: input.bundleDigests,
    });
  }
}

async function importTraceCommonsCorpusRow(input: {
  row: TraceCommonsRow;
  rowIndex: number;
  sourceOffset: number;
  manifest: PublicCorpusRunManifest;
  ledger: PublicCorpusLedgerSnapshot;
  bundlePaths: string[];
  bundleDigests: `sha256:${string}`[];
}): Promise<void> {
  const rowDigest = digestJsonValue(input.row);
  const recordBase = {
    offset: input.sourceOffset,
    rowIndex: input.rowIndex,
    recordId: `${input.row.harness}:${input.row.session_id}`,
    sourceIdentity: input.row.file_path ?? `${input.row.harness}/${input.row.session_id}`,
    rowDigest,
  };

  assertPublicCorpusOffsetDigest(input.ledger, input.sourceOffset, rowDigest);
  if (isPublicCorpusRecordAlreadyRecorded(input.ledger, input.sourceOffset, rowDigest)) {
    return;
  }

  try {
    const session = createImportedSessionFromTraceCommonsRow(input.row, {
      split: input.manifest.plan.split,
    });
    const bundle = createSessionBundleFromTraceCommonsRow(input.row, {
      split: input.manifest.plan.split,
    });
    const bundlePath = defaultImportedTrajectoryBundlePath(
      bundle,
      "trace-commons",
      input.manifest.plan.split,
      input.manifest.artifacts.bundleRoot,
    );
    const bundleDigest = digestJsonValue(bundle);
    const record = await persistPublicCorpusBundleRecord({
      manifest: input.manifest,
      bundle,
      bundlePath,
      record: {
        ...recordBase,
        status: input.manifest.plan.dryRun ? "prepared" : "written",
        sessionId: bundle.sessionId,
        bundlePath,
        bundleDigest,
        canonicalSessionDigest: digestJsonValue(session),
      },
    });

    input.bundlePaths.push(bundlePath);
    input.bundleDigests.push(bundleDigest);
    await appendRecordIfNeeded(input.manifest, record);
    recordPublicCorpusLedgerSuccess(input.ledger, record);
    if (record.status === "skipped_existing") {
      input.manifest.progress.rowsSkipped += 1;
    } else {
      input.manifest.progress.rowsImported += 1;
    }
  } catch (error) {
    const record: PublicCorpusRecordLedgerEntry = {
      ...recordBase,
      status: "failed",
      errorCode: "record_import_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    await appendRecordIfNeeded(input.manifest, record, { error: true });
    recordPublicCorpusLedgerError(input.ledger, record);
    input.manifest.progress.rowsFailed += 1;
    if (isFatalPublicCorpusRecordError(error)) {
      throw error;
    }
  }
}

async function appendRecordIfNeeded(
  manifest: PublicCorpusRunManifest,
  record: PublicCorpusRecordLedgerEntry,
  options: { error?: boolean } = {},
): Promise<void> {
  if (manifest.plan.dryRun) {
    return;
  }
  await appendPublicCorpusRecord(
    options.error ? manifest.artifacts.errorsPath : manifest.artifacts.recordsPath,
    record,
  );
}
