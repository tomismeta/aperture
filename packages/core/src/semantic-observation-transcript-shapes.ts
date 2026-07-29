import {
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  TAGGED_FILE_OBSERVATION_PHRASES,
} from "./semantic-patterns.js";
import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeSearchResultObservation } from "./semantic-search-observation-shapes.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { looksLikeTerminalFailureEvidence } from "./semantic-terminal-evidence.js";
import { hasToolUseRejectionSignal } from "./semantic-tool-use-rejection-shapes.js";
import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";

export function looksLikeExplicitObservationTranscript(value: string): boolean {
  const body = readExplicitObservationTranscriptBody(value);
  if (
    body === null ||
    hasToolUseRejectionSignal(body) ||
    looksLikeObservationTranscriptDiagnostic(body)
  ) {
    return false;
  }

  const text = normalizeSemanticText(body);
  return (
    containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES) ||
    looksLikeTaggedFileObservationTranscript(text) ||
    looksLikeStrongRawSourceObservation(body) ||
    looksLikePlainReadObservation(body) ||
    looksLikeBuildOrLogObservation(body) ||
    looksLikeSearchResultObservation(text, body) ||
    looksLikeSuccessfulCommandObservationTranscript(text)
  );
}

function readExplicitObservationTranscriptBody(value: string): string | null {
  const match = /^\s*OBSERVATION:\s*([\s\S]+)$/i.exec(value);
  const body = match?.[1]?.trim() ?? "";

  return body.length > 0 && body !== "{}" ? body : null;
}

function looksLikeTaggedFileObservationTranscript(text: string): boolean {
  return (
    containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES) &&
    PATH_LIKE_TOKEN_PATTERN.test(text)
  );
}

function looksLikeObservationTranscriptDiagnostic(text: string): boolean {
  return (
    looksLikeTerminalFailureEvidence(normalizeSemanticText(text)) ||
    hasStrongRuntimeDiagnosticEvidence(text) ||
    looksLikeToolOutputDiagnosticPayload(text)
  );
}

function looksLikeSuccessfulCommandObservationTranscript(text: string): boolean {
  return (
    /\brunning (?:command|[a-z0-9_.-]+)\b/.test(text) &&
    /\b(?:test passed|tests passed|all checks passed|all .* tests passed|no problems found)\b/.test(
      text,
    )
  );
}
