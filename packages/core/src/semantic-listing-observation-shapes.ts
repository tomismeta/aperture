import {
  readListingEntries,
  type ListingEntry,
  type ListingEntryKind,
} from "./semantic-listing-entry-shapes.js";
import { looksLikeKernelLogDiagnosticPayload } from "./semantic-kernel-log-shapes.js";
import {
  hasVisibleTruncationBoundary,
  stripObservationStatusPrefix,
} from "./semantic-observation-text.js";

export function looksLikeStrongListingObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  const entries = readListingEntries(text);
  if (hasDiagnosticKernelLogEntry(entries)) {
    return false;
  }
  if (!hasMonotoneRequiredListingEntries(entries)) {
    return false;
  }

  return entries.length >= 2 || (hasTotalOutputLineMarker(text) && entries.length >= 1);
}

export function looksLikeRecoveredListingObservation(value: string): boolean {
  return looksLikeStrongListingObservation(value);
}

export function looksLikeTruncatedRawReadListingObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (!hasVisibleTruncationBoundary(text)) {
    return false;
  }

  const entries = readListingEntries(text);
  return entries.length >= 3 || hasRepeatedStrongListingGrammar(entries);
}

function hasRepeatedStrongListingGrammar(entries: ListingEntry[]): boolean {
  if (hasDiagnosticKernelLogEntry(entries)) {
    return false;
  }
  if (!hasMonotoneRequiredListingEntries(entries)) {
    return false;
  }

  const counts = new Map<ListingEntryKind, number>();
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  return [...counts.values()].some((count) => count >= 2);
}

function hasDiagnosticKernelLogEntry(entries: ListingEntry[]): boolean {
  return entries.some(
    (entry) => entry.kind === "kernel_log" && looksLikeKernelLogDiagnosticPayload(entry.line),
  );
}

function hasMonotoneRequiredListingEntries(entries: ListingEntry[]): boolean {
  const required = entries.filter((entry) => entry.requiresMonotone === true);
  return required.every(
    (entry, index) =>
      index === 0 || (entry.lineNumber ?? 0) > (required[index - 1]?.lineNumber ?? 0),
  );
}

function hasTotalOutputLineMarker(text: string): boolean {
  return /(?:^|[\r\n])\s*total output lines:\s*\d+\b/i.test(text);
}
