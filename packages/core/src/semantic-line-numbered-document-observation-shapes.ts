import {
  containsArrowNumberedDocumentMarker,
  hasStrictlyIncreasingLineNumbers,
  readArrowNumberedDocumentSpans,
  readLineNumberedDocumentSpans,
  type LineNumberedDocumentSpan,
} from "./semantic-line-numbered-document-span-shapes.js";

export function looksLikeLineNumberedMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  return containsArrowNumberedDocumentMarker(normalized)
    ? looksLikeArrowNumberedMarkdownDocumentObservation(normalized)
    : looksLikeLineNumberedMarkdownDocumentSpans(
        readLineNumberedDocumentSpans(normalized),
        normalized,
      );
}

export function looksLikeArrowNumberedMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  return looksLikeLineNumberedMarkdownDocumentSpans(
    readArrowNumberedDocumentSpans(normalized),
    normalized,
  );
}

function looksLikeLineNumberedMarkdownDocumentSpans(
  spans: LineNumberedDocumentSpan[],
  text: string,
): boolean {
  if (spans.length < 4 || !hasStrictlyIncreasingLineNumbers(spans)) {
    return false;
  }

  return looksLikeStructuredMarkdownDocument(spans.map((span) => span.body).join("\n"), {
    clipped: hasVisibleTruncationBoundary(text),
  });
}

function looksLikeStructuredMarkdownDocument(text: string, options: { clipped: boolean }): boolean {
  const headingCount = [...text.matchAll(/(?:^|[\r\n])\s{0,3}#{1,6}\s+\S/g)].length;
  const listCount = [...text.matchAll(/(?:^|[\r\n])\s*(?:[-*]\s+\S|\d+\.\s+\S)/g)].length;
  const requiredListCount = options.clipped ? 1 : 2;

  return (
    headingCount >= 2 &&
    (listCount >= requiredListCount ||
      /(?:^|[\r\n])\s*```/.test(text) ||
      looksLikeMarkdownTable(text))
  );
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.some(
    (line, index) =>
      isMarkdownTableRow(line) &&
      /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "") &&
      isMarkdownTableRow(lines[index + 2] ?? "") &&
      isMarkdownTableRow(lines[index + 3] ?? ""),
  );
}

function isMarkdownTableRow(line: string): boolean {
  return /^\|.+\|\s*$/.test(line);
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}
