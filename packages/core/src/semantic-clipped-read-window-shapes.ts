import {
  containsArrowNumberedDocumentMarker,
  hasStrictlyIncreasingLineNumbers,
  readArrowNumberedDocumentSpans,
  type LineNumberedDocumentSpan,
} from "./semantic-line-numbered-document-span-shapes.js";

export function looksLikeClippedArrowReadWindowObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  if (!containsArrowNumberedDocumentMarker(normalized) || !hasVisibleClippingBoundary(normalized)) {
    return false;
  }

  const spans = readArrowNumberedDocumentSpans(normalized);
  return (
    spans.length >= 3 &&
    (spans[0]?.line ?? 1) > 1 &&
    hasStrictlyIncreasingLineNumbers(spans) &&
    hasConsecutiveLineNumbers(spans) &&
    countNonemptyBodies(spans) >= 2
  );
}

function hasConsecutiveLineNumbers(spans: LineNumberedDocumentSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line === spans[index - 1]!.line + 1);
}

function countNonemptyBodies(spans: LineNumberedDocumentSpan[]): number {
  return spans.filter((span) => span.body.trim().length > 0).length;
}

function hasVisibleClippingBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}
