import { PATH_LIKE_TOKEN_PATTERN, SEARCH_RESULT_OUTPUT_PATTERN } from "./semantic-patterns.js";

export function looksLikeSearchResultObservation(normalizedText: string, rawText: string): boolean {
  return (
    looksLikeWebSearchResultOutput(rawText) ||
    looksLikeRepeatedGrepContextOutput(rawText) ||
    SEARCH_RESULT_OUTPUT_PATTERN.test(normalizedText) ||
    (PATH_LIKE_TOKEN_PATTERN.test(normalizedText) && /\bmatch(?:es)?\b/.test(normalizedText))
  );
}

function looksLikeRepeatedGrepContextOutput(text: string): boolean {
  const matches = text.match(/(?:^|\s)\d+[-:]\|\s+\S/g);
  return (matches?.length ?? 0) >= 2;
}

function looksLikeWebSearchResultOutput(rawText: string): boolean {
  return /^\s*web search results for\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[^:\r\n]{1,200})\s*:\s+\S/i.test(
    rawText,
  );
}
