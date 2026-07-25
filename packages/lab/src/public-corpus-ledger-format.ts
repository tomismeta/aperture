import { digestText, type PublicCorpusRecordLedgerEntry } from "./public-corpus-manifest.js";

export function serializePublicCorpusLedgerEntries(
  entries: PublicCorpusRecordLedgerEntry[],
): string {
  return entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
}

export function digestPublicCorpusLedgerEntries(
  entries: PublicCorpusRecordLedgerEntry[],
): `sha256:${string}` {
  return digestText(serializePublicCorpusLedgerEntries(entries));
}
