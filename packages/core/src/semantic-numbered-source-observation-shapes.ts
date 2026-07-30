import { readArrowNumberedSourceSpans } from "./semantic-arrow-numbered-source-span-shapes.js";
import {
  looksLikeStrongNumberedSourceSpans,
  readFlattenedNumberedSourceSpans,
  readLineNumberedSourceSpans,
} from "./semantic-numbered-source-span-shapes.js";

export function looksLikeFlattenedNumberedSourceObservation(text: string): boolean {
  if (containsArrowNumberedMarker(text)) {
    return looksLikeStrongNumberedSourceSpans(readArrowNumberedSourceSpans(text));
  }

  if (
    /^\s*\d+\.\s+\S/m.test(text) ||
    /(?:^|\s)\d+:\s+\S/.test(text) ||
    containsMultilineNumberedRows(text)
  ) {
    return false;
  }

  return looksLikeStrongNumberedSourceSpans(readFlattenedNumberedSourceSpans(text));
}

export function looksLikeLineNumberedSourceFragment(text: string): boolean {
  if (containsArrowNumberedMarker(text)) {
    return false;
  }

  const clipped = hasVisibleTruncationBoundary(text);
  return (
    !/^\s*(?:\{|\[|")/.test(text) &&
    looksLikeStrongNumberedSourceSpans(readLineNumberedSourceSpans(text), {
      allowClippedSourceContext: clipped,
      ignoreTruncatedFinalSpan: clipped,
      minSourceStatements: clipped ? 3 : 2,
    })
  );
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function containsMultilineNumberedRows(text: string): boolean {
  return /[\r\n]\s*\d{1,6}[ \t]+\S/.test(text);
}

function containsArrowNumberedMarker(text: string): boolean {
  return /(?:^|[\r\n]|\s)\d{1,6}\u2192/.test(text);
}
