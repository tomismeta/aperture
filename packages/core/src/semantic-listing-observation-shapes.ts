type ListingEntryKind = "grep" | "kernel_log" | "markdown" | "source_location";

type ListingEntry = {
  kind: ListingEntryKind;
  line: string;
};

export function looksLikeRecoveredListingObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  const entries = readListingEntries(text);
  return entries.length >= 2 || (hasTotalOutputLineMarker(text) && entries.length >= 1);
}

export function looksLikeTruncatedRawReadListingObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (!hasVisibleTruncationBoundary(text)) {
    return false;
  }

  const entries = readListingEntries(text);
  return entries.length >= 3 || hasRepeatedStrongListingGrammar(entries);
}

function readListingEntries(text: string): ListingEntry[] {
  const entries: ListingEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const kind = readListingEntryKind(line);
    if (kind !== null) {
      entries.push({ kind, line });
    }
  }

  return dedupeListingEntries(entries);
}

function readListingEntryKind(line: string): ListingEntryKind | null {
  if (SOURCE_LOCATION_LINE_PATTERN.test(line)) {
    return "source_location";
  }
  if (/^\d{1,6}[-:](?:\||\s+\S)/.test(line)) {
    return "grep";
  }
  if (/^\[\s*\d+(?:\.\d+)?]\s+\S/.test(line)) {
    return "kernel_log";
  }
  if (/^(?:#{1,6}\s+\S|[-*]\s+\S|\d+\.\s+\S|```)/.test(line)) {
    return "markdown";
  }

  return null;
}

function dedupeListingEntries(entries: ListingEntry[]): ListingEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasRepeatedStrongListingGrammar(entries: ListingEntry[]): boolean {
  const counts = new Map<ListingEntryKind, number>();
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  return [...counts.values()].some((count) => count >= 2);
}

function hasTotalOutputLineMarker(text: string): boolean {
  return /(?:^|[\r\n])\s*total output lines:\s*\d+\b/i.test(text);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}

const SOURCE_LOCATION_LINE_PATTERN =
  /^[^\s:\r\n]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift):\d+(?::\d+)?:\s*\S/i;
