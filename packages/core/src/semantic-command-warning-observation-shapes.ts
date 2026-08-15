import { hasToolOutputFailureDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";
import { hasVisibleTruncationBoundary } from "./semantic-observation-text.js";
import { hasMatchOutsideQuotedSpans } from "./semantic-quoted-span.js";

export function looksLikeWarningOnlyCommandOutputObservation(value: string): boolean {
  const text = value.trim();
  return (
    safeTruncatedCommandOutput(text) &&
    !looksLikeObservationReferenceWrapper(text) &&
    !looksLikeExplicitErrorLine(text) &&
    (looksLikePathQualifiedWarning(text) || looksLikeToolchainWarning(text))
  );
}
export const safeTruncatedCommandOutput = (text: string): boolean =>
  text.length > 0 &&
  hasVisibleTruncationBoundary(text) &&
  !hasToolOutputFailureDiagnosticEvidence(text);
const looksLikePathQualifiedWarning = (text: string): boolean =>
  hasMatchOutsideQuotedSpans(text, PATH_QUALIFIED_WARNING_PATTERN);
function looksLikeToolchainWarning(text: string): boolean {
  return (
    hasMatchOutsideQuotedSpans(text, TOOLCHAIN_WARNING_PATTERN) ||
    hasMatchOutsideQuotedSpans(text, CMAKE_WARNING_PATTERN)
  );
}
const looksLikeExplicitErrorLine = (text: string): boolean =>
  hasMatchOutsideQuotedSpans(text, EXPLICIT_ERROR_LINE_PATTERN);
const PATH_QUALIFIED_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*(?:[A-Za-z_][A-Za-z0-9_]*Warning|warning):\s+\S/gi;

const TOOLCHAIN_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:clang|gcc|g\+\+|cc|c\+\+|ld|nvcc|hipcc)\s*:\s*warning:\s+\S/gi;

const CMAKE_WARNING_PATTERN = /(?:^|[\r\n])\s*CMake (?:Deprecation )?Warning at \S+:\d+\s+\(/gi;

const EXPLICIT_ERROR_LINE_PATTERN =
  /(?:^|[\r\n])\s*(?:(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*)?(?:error|fatal):\s+\S/gi;
