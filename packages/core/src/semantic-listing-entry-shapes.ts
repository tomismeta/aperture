import { looksLikeNoSpaceListingBody } from "./semantic-listing-body-shapes.js";

export type ListingEntryKind = "grep" | "kernel_log" | "markdown" | "path_line" | "source_location";

export type ListingEntry = {
  kind: ListingEntryKind;
  line: string;
  lineNumber?: number;
  requiresMonotone?: true;
};

export function readListingEntries(text: string): ListingEntry[] {
  const entries: ListingEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const entry = readListingEntry(line);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  return dedupeListingEntries(entries);
}

function readListingEntry(line: string): ListingEntry | null {
  if (SOURCE_LOCATION_LINE_PATTERN.test(line)) {
    return { kind: "source_location", line };
  }
  if (PATH_LINE_ENTRY_PATTERN.test(line)) {
    return { kind: "path_line", line };
  }
  const numberedKernelLog = /^(\d{1,6}):\s*\[\s*\d+(?:\.\d+)?]\s+\S/.exec(line);
  if (numberedKernelLog) {
    return { kind: "kernel_log", line, lineNumber: Number.parseInt(numberedKernelLog[1]!, 10) };
  }
  const noSpaceContext = /^(\d{1,6}):(?!\s)(\S[\s\S]*)$/.exec(line);
  if (noSpaceContext) {
    if (!looksLikeNoSpaceListingBody(noSpaceContext[2] ?? "")) {
      return null;
    }
    return {
      kind: "grep",
      line,
      lineNumber: Number.parseInt(noSpaceContext[1]!, 10),
      requiresMonotone: true,
    };
  }
  if (/^\d{1,6}[-:](?:\||\s+\S)/.test(line)) {
    return { kind: "grep", line };
  }
  if (/^\[\s*\d+(?:\.\d+)?]\s+\S/.test(line)) {
    return { kind: "kernel_log", line };
  }
  if (/^(?:#{1,6}\s+\S|```)/.test(line)) {
    return { kind: "markdown", line };
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

const SOURCE_LOCATION_LINE_PATTERN =
  /^[^\s:\r\n]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift):\d+(?::\d+)?:\s*\S/i;

const PATH_LINE_ENTRY_PATTERN =
  /^(?!(?:[a-z][a-z0-9+.-]*:\/\/))(?:(?:(?:\/|\.{1,2}\/|[^\s:\r\n]+\/)[^\s:\r\n]*\.(?:md|markdown|txt|rst|adoc|json|jsonl|ya?ml|toml|ini|cfg|cmake|ll|td))|(?:Makefile|GNUmakefile|CMakeLists\.txt)):\d+(?::\d+)?:\s*\S/i;
