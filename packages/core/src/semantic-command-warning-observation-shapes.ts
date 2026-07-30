import { hasToolOutputFailureDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";

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
  return PATH_QUALIFIED_WARNING_PATTERN.test(text);
}

function looksLikeToolchainWarning(text: string): boolean {
  return TOOLCHAIN_WARNING_PATTERN.test(text) || CMAKE_WARNING_PATTERN.test(text);
}

function looksLikeExplicitErrorLine(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:[a-z0-9_./-]+:\d+(?::\d+)?:\s*)?(?:error|fatal):\s+\S/i.test(text);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text);
}

const PATH_QUALIFIED_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*(?:[A-Za-z_][A-Za-z0-9_]*Warning|warning):\s+\S/;

const TOOLCHAIN_WARNING_PATTERN =
  /(?:^|[\r\n])\s*(?:clang|gcc|g\+\+|cc|c\+\+|ld|nvcc|hipcc)\s*:\s*warning:\s+\S/i;

const CMAKE_WARNING_PATTERN = /(?:^|[\r\n])\s*CMake (?:Deprecation )?Warning at \S+:\d+\s+\(/i;
