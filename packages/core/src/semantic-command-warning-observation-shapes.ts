import { hasToolOutputFailureDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";
import { hasMatchOutsideQuotedSpans } from "./semantic-quoted-span.js";

export function looksLikeWarningOnlyCommandOutputObservation(value: string): boolean {
  const text = value.trim();
  return (
    text.length > 0 &&
    hasVisibleTruncationBoundary(text) &&
    !looksLikeObservationReferenceWrapper(text) &&
    !hasToolOutputFailureDiagnosticEvidence(text) &&
    !looksLikeExplicitErrorLine(text) &&
    (looksLikePathQualifiedWarning(text) || looksLikeToolchainWarning(text))
  );
}

function looksLikePathQualifiedWarning(text: string): boolean {
  return hasMatchOutsideQuotedSpans(text, PATH_QUALIFIED_WARNING_PATTERN);
}

function looksLikeToolchainWarning(text: string): boolean {
  return (
    hasMatchOutsideQuotedSpans(text, TOOLCHAIN_WARNING_PATTERN) ||
    hasMatchOutsideQuotedSpans(text, CMAKE_WARNING_PATTERN)
  );
}

function looksLikeExplicitErrorLine(text: string): boolean {
  return hasMatchOutsideQuotedSpans(text, EXPLICIT_ERROR_LINE_PATTERN);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text);
}

const PATH_QUALIFIED_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*(?:[A-Za-z_][A-Za-z0-9_]*Warning|warning):\s+\S/gi;

const TOOLCHAIN_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:clang|gcc|g\+\+|cc|c\+\+|ld|nvcc|hipcc)\s*:\s*warning:\s+\S/gi;

const CMAKE_WARNING_PATTERN = /(?:^|[\r\n])\s*CMake (?:Deprecation )?Warning at \S+:\d+\s+\(/gi;

const EXPLICIT_ERROR_LINE_PATTERN =
  /(?:^|[\r\n])\s*(?:(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*)?(?:error|fatal):\s+\S/gi;
