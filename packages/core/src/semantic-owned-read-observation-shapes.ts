import {
  containsArrowNumberedDocumentMarker,
  hasStrictlyIncreasingLineNumbers,
  type LineNumberedDocumentSpan,
} from "./semantic-line-numbered-document-span-shapes.js";
import { readArrowNumberedDocumentSpanParts } from "./semantic-arrow-numbered-document-span-parser.js";
import { hasUnquotedEmbeddedRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { containsOwnedReadTransportMixedNumbering } from "./semantic-owned-read-transport-numbering.js";
import {
  hasVisibleTruncationBoundary,
  stripObservationStatusPrefix,
} from "./semantic-observation-text.js";

export function hasOwnedReadTerminalDiagnosticEvidence(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  return (
    looksLikeExplicitReadFailureDiagnostic(text) ||
    hasEmbeddedReadFailureDiagnostic(text) ||
    hasUnquotedEmbeddedRuntimeDiagnosticEvidence(text)
  );
}

export function looksLikeOwnedReadTransportObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0 || hasOwnedReadTerminalDiagnosticEvidence(text)) {
    return false;
  }

  return looksLikeClippedArrowReadWindow(text);
}

function looksLikeClippedArrowReadWindow(text: string): boolean {
  if (!containsArrowNumberedDocumentMarker(text) || !hasVisibleTruncationBoundary(text)) {
    return false;
  }

  if (containsOwnedReadTransportMixedNumbering(text)) {
    return false;
  }

  const spans = readArrowNumberedDocumentSpanParts(text).map(({ line, body }) => ({ line, body }));
  return (
    spans.length >= 3 &&
    hasStrictlyIncreasingLineNumbers(spans) &&
    hasConsecutiveLineNumbers(spans) &&
    spans.filter((span) => span.body.trim().length > 0).length >= 2
  );
}

function looksLikeExplicitReadFailureDiagnostic(value: string): boolean {
  return /^(?:read\s+failed\b|failed to (?:read|open)\b|could not (?:read|open)\b|unable to (?:read|open)\b)/i.test(
    value
      .trim()
      .replace(/^(?:read|tool)\s+failure\s+/i, "")
      .replace(/^#{1,6}\s+/, ""),
  );
}

function hasConsecutiveLineNumbers(spans: LineNumberedDocumentSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line === spans[index - 1]!.line + 1);
}

function hasEmbeddedReadFailureDiagnostic(text: string): boolean {
  return hasUnquotedMatch(
    text,
    /\b(?:read failed|failed to (?:read|open)|could not (?:read|open)|unable to (?:read|open))\b/gi,
  );
}

function hasUnquotedMatch(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!/[="'`]\s*$/.test(text.slice(Math.max(0, match.index - 3), match.index))) {
      return true;
    }
  }
  return false;
}
