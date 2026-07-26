import { type PublicCorpusRunManifest } from "./public-corpus-manifest.js";
import { digestPublicCorpusLedgerEntries } from "./public-corpus-ledger-format.js";
import type { PublicCorpusLedgerSnapshot } from "./public-corpus-ledger.js";

export type PublicCorpusLedgerIntegrityMode = "strict" | "recover-running-append";
type PublicCorpusLedgerDigests = {
  recordsDigest: `sha256:${string}`;
  errorsDigest: `sha256:${string}`;
};

export function computePublicCorpusLedgerIntegrity(
  snapshot: Pick<PublicCorpusLedgerSnapshot, "records" | "errors">,
): PublicCorpusLedgerDigests {
  return {
    recordsDigest: digestPublicCorpusLedgerEntries(snapshot.records),
    errorsDigest: digestPublicCorpusLedgerEntries(snapshot.errors),
  };
}

export function verifyPublicCorpusLedgerIntegrity(input: {
  snapshot: PublicCorpusLedgerSnapshot;
  integrityMode: PublicCorpusLedgerIntegrityMode;
  manifest: PublicCorpusRunManifest;
}): void {
  assertNoDuplicateLedgerOutcomes(input.snapshot);
  const currentIntegrity = computePublicCorpusLedgerIntegrity(input.snapshot);
  let expectedRecordsDigest = input.manifest.integrity.recordsDigest;
  let expectedErrorsDigest = input.manifest.integrity.errorsDigest;

  if (!expectedRecordsDigest && input.snapshot.records.length === 0) {
    input.manifest.integrity.recordsDigest = currentIntegrity.recordsDigest;
    expectedRecordsDigest = currentIntegrity.recordsDigest;
  }
  if (!expectedErrorsDigest && input.snapshot.errors.length === 0) {
    input.manifest.integrity.errorsDigest = currentIntegrity.errorsDigest;
    expectedErrorsDigest = currentIntegrity.errorsDigest;
  }

  if (
    currentIntegrity.recordsDigest === expectedRecordsDigest &&
    currentIntegrity.errorsDigest === expectedErrorsDigest
  ) {
    return;
  }

  if (
    input.integrityMode !== "recover-running-append" ||
    !expectedRecordsDigest ||
    !expectedErrorsDigest ||
    !isRecoverableRunningAppend(input.manifest, input.snapshot)
  ) {
    throw new Error("Public corpus ledger digest mismatch; refusing to resume.");
  }

  input.manifest.integrity = {
    ...input.manifest.integrity,
    ...currentIntegrity,
  };
}

function isRecoverableRunningAppend(
  manifest: PublicCorpusRunManifest,
  snapshot: PublicCorpusLedgerSnapshot,
): boolean {
  const checkpointOffset = manifest.progress.nextOffset;
  const pageUpperBound = Math.min(
    checkpointOffset + manifest.plan.pageSize,
    manifest.plan.startOffset + manifest.plan.maxRows,
  );
  const checkpointRecords = snapshot.records.filter((entry) => entry.offset < checkpointOffset);
  const checkpointErrors = snapshot.errors.filter((entry) => entry.offset < checkpointOffset);
  const appendedEntries = [...snapshot.records, ...snapshot.errors].filter(
    (entry) => entry.offset >= checkpointOffset,
  );
  const appendedOffsets = [...new Set(appendedEntries.map((entry) => entry.offset))].sort(
    (left, right) => left - right,
  );

  return (
    digestPublicCorpusLedgerEntries(checkpointRecords) === manifest.integrity.recordsDigest &&
    digestPublicCorpusLedgerEntries(checkpointErrors) === manifest.integrity.errorsDigest &&
    appendedEntries.length === appendedOffsets.length &&
    appendedEntries.length <= manifest.plan.pageSize &&
    appendedOffsets.every((offset, index) => offset === checkpointOffset + index) &&
    appendedEntries.every(
      (entry) => entry.offset >= checkpointOffset && entry.offset < pageUpperBound,
    )
  );
}

function assertNoDuplicateLedgerOutcomes(snapshot: PublicCorpusLedgerSnapshot): void {
  const consumedOffsets = new Set<number>();
  for (const record of [...snapshot.records, ...snapshot.errors]) {
    if (consumedOffsets.has(record.offset)) {
      throw new Error(`Public corpus ledger has multiple outcomes for offset ${record.offset}.`);
    }
    consumedOffsets.add(record.offset);
  }
}
