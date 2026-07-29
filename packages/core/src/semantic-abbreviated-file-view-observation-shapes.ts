import { looksLikeStrongRawSourceObservation } from "./semantic-source-observation-shapes.js";

export function looksLikeAbbreviatedFileViewObservation(value: string): boolean {
  const text = value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
  const match = /^\s*<NOTE>([\s\S]{1,600}?)<\/NOTE>\s+([\s\S]+)$/i.exec(text);
  if (!match) {
    return false;
  }

  const note = match[1] ?? "";
  const payload = match[2]?.trim() ?? "";
  return (
    /\bfile is too large to display entirely\b/i.test(note) &&
    /\bshowing abbreviated version\b/i.test(note) &&
    /\bstr_replace_editor\s+view\b/i.test(note) &&
    /\bview_range\b/i.test(note) &&
    (looksLikeStrongRawSourceObservation(payload) ||
      countAbbreviatedNumberedSourceRows(payload) >= 2)
  );
}

function countAbbreviatedNumberedSourceRows(text: string): number {
  return [...text.matchAll(ABBREVIATED_NUMBERED_SOURCE_ROW_PATTERN)].length;
}

const ABBREVIATED_NUMBERED_SOURCE_ROW_PATTERN =
  /(?:^|\s)\d{1,6}\s+(?:#|from\b|import\b|class\b|def\b|function\b|export\b|const\b|let\b|var\b|interface\b|type\b|struct\b|enum\b|static\b)/gi;
