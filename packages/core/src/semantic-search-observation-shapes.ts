import { PATH_LIKE_TOKEN_PATTERN, SEARCH_RESULT_OUTPUT_PATTERN } from "./semantic-patterns.js";

type GrepContextEntry = { path?: string; line: number; separator: string; body: string };

export function looksLikeSearchResultObservation(normalizedText: string, rawText: string): boolean {
  return (
    looksLikeWebSearchResultOutput(rawText) ||
    looksLikeRepeatedGrepContextOutput(rawText) ||
    SEARCH_RESULT_OUTPUT_PATTERN.test(normalizedText) ||
    (PATH_LIKE_TOKEN_PATTERN.test(normalizedText) && /\bmatch(?:es)?\b/.test(normalizedText))
  );
}

function looksLikeRepeatedGrepContextOutput(text: string): boolean {
  const entries = readGrepContextEntries(text);
  const lineOnlyEntries = entries.filter((entry) => entry.path === undefined);
  if (
    lineOnlyEntries.length >= 3 &&
    hasIncreasingLines(lineOnlyEntries) &&
    hasStrongLineOnlyGrepMarker(lineOnlyEntries)
  ) {
    return true;
  }

  const entriesByPath = groupEntriesByPath(entries.filter((entry) => entry.path !== undefined));
  return [...entriesByPath.values()].some(
    (pathEntries) => pathEntries.length >= 2 && hasIncreasingLines(pathEntries),
  );
}

function readGrepContextEntries(text: string): GrepContextEntry[] {
  return [...text.matchAll(GREP_CONTEXT_ENTRY_PATTERN)].map((match) => ({
    ...(match.groups?.path ? { path: match.groups.path } : {}),
    line: Number.parseInt(match.groups?.line ?? "", 10),
    separator: match.groups?.separator ?? "",
    body: match.groups?.body?.trim() ?? "",
  }));
}

function hasIncreasingLines(entries: GrepContextEntry[]): boolean {
  return entries.every((entry, index) => {
    if (!Number.isSafeInteger(entry.line) || entry.body.length === 0) {
      return false;
    }
    return index === 0 || entry.line > entries[index - 1]!.line;
  });
}

function groupEntriesByPath(entries: GrepContextEntry[]): Map<string, GrepContextEntry[]> {
  const groups = new Map<string, GrepContextEntry[]>();
  for (const entry of entries) {
    if (entry.path === undefined) {
      continue;
    }
    groups.set(entry.path, [...(groups.get(entry.path) ?? []), entry]);
  }
  return groups;
}

function hasStrongLineOnlyGrepMarker(entries: GrepContextEntry[]): boolean {
  return entries.some((entry) => entry.separator === "--" || entry.separator.includes("|"));
}

const GREP_CONTEXT_ENTRY_PATTERN =
  /(?:^|\s)(?:(?<path>\S+\.[a-z0-9]+)-)?(?<line>\d{1,6})(?<separator>--|[-:]\||-)\s+(?<body>\S[\s\S]*?)(?=(?:\s(?:\S+\.[a-z0-9]+-)?\d{1,6}(?:--|[-:]\||-)\s+\S)|$)/gi;

function looksLikeWebSearchResultOutput(rawText: string): boolean {
  return /^\s*web search results for\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[^:\r\n]{1,200})\s*:\s+\S/i.test(
    rawText,
  );
}
