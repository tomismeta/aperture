import { readListingEntries } from "./semantic-listing-entry-shapes.js";

export type SingleOwnedListingObservation = {
  consequenceBaseline: "medium" | "high";
  source: boolean;
};

export function readSingleOwnedListingObservation(
  value: string,
): SingleOwnedListingObservation | null {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0 || hasProsePathReference(text) || hasListingDiagnosticLine(text)) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) {
    return null;
  }

  const entries = readListingEntries(text);
  if (entries.length !== 1 || entries[0]?.line !== lines[0]) {
    return null;
  }

  const entry = entries[0];
  if (entry === undefined) {
    return null;
  }

  switch (entry.kind) {
    case "source_location":
      return { consequenceBaseline: "high", source: true };
    case "path_line":
      return { consequenceBaseline: "medium", source: false };
    default:
      return null;
  }
}

function hasProsePathReference(text: string): boolean {
  return /^\s*(?:see|refer to|open|read|check)\s+\S/i.test(text);
}

function hasListingDiagnosticLine(text: string): boolean {
  const body = listingDiagnosticBody(text);
  return (
    /:\d+(?::\d+)?:\s*(?:(?:fatal\s+)?error|fatal|userwarning|warning):\s+\S/i.test(text) ||
    (body !== null && looksLikeSingleListingDiagnosticBody(body))
  );
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/i, "");
}

function listingDiagnosticBody(text: string): string | null {
  return /:\d+(?::\d+)?:\s*(\S[\s\S]*)$/.exec(text)?.[1] ?? null;
}

function looksLikeSingleListingDiagnosticBody(body: string): boolean {
  const text = body.trim();
  if (looksLikeDocumentedFailureReference(text)) {
    return false;
  }

  return [
    /^(?:tests?|build|command|process|subprocess)\s+failed\b/i,
    /^failed\s+(?:tests?|build|command|process|subprocess)\b/i,
    /^assertion\s+failed\s*:/i,
    /^(?:uncaught|unhandled)\s+exception\b/i,
    /^(?:E\s+)?(?:AssertionError|RuntimeError|ValueError|TypeError|Exception):\s+\S/i,
    /^(?:FAIL|FAILED|ERROR)\b[:\s]\s*\S/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeDocumentedFailureReference(body: string): boolean {
  return /^(?:tests?|build|command|process|subprocess)\s+failed\s+(?:is|are|was|were)\s+(?:documented|described|noted|mentioned)\b/i.test(
    body,
  );
}
