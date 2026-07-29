import {
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  TAGGED_FILE_OBSERVATION_PHRASES,
} from "./semantic-patterns.js";
import { looksLikeAbbreviatedFileViewObservation } from "./semantic-abbreviated-file-view-observation-shapes.js";
import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeSearchResultObservation } from "./semantic-search-observation-shapes.js";
import {
  looksLikeFailedTestOutputDiagnostic,
  looksLikeSuccessfulTestOutputObservation,
} from "./semantic-test-output-observation-shapes.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { looksLikeTerminalFailureEvidence } from "./semantic-terminal-evidence.js";
import { hasToolUseRejectionSignal } from "./semantic-tool-use-rejection-shapes.js";
import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";

export type ExplicitObservationTranscript = {
  shape: "existing_observation" | "successful_test" | "abbreviated_file_view";
  consequenceBaseline: "low" | "high";
};

export function readExplicitObservationTranscript(
  value: string,
): ExplicitObservationTranscript | null {
  const body = readExplicitObservationTranscriptBody(value);
  if (body === null || hasToolUseRejectionSignal(body)) {
    return null;
  }

  return readObservationTranscriptBody(body);
}

export function looksLikeExplicitObservationTranscript(value: string): boolean {
  return readExplicitObservationTranscript(value) !== null;
}

export function looksLikeExplicitDiagnosticObservationTranscript(value: string): boolean {
  const body = readExplicitObservationTranscriptBody(value);
  return (
    body !== null &&
    !hasToolUseRejectionSignal(body) &&
    readObservationTranscriptBody(body) === null &&
    looksLikeObservationTranscriptDiagnostic(body)
  );
}

function readObservationTranscriptBody(body: string): ExplicitObservationTranscript | null {
  const text = normalizeSemanticText(body);
  if (looksLikeSuccessfulTestOutputObservation(body)) {
    return { shape: "successful_test", consequenceBaseline: "low" };
  }
  if (looksLikeAbbreviatedFileViewObservation(body)) {
    return { shape: "abbreviated_file_view", consequenceBaseline: "low" };
  }
  if (
    containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES) ||
    looksLikeTaggedFileObservationTranscript(text) ||
    looksLikeStrongRawSourceObservation(body) ||
    looksLikePlainReadObservation(body) ||
    looksLikeBuildOrLogObservation(body) ||
    looksLikeSearchResultObservation(text, body)
  ) {
    return { shape: "existing_observation", consequenceBaseline: "high" };
  }

  return null;
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
    looksLikeFailedTestOutputDiagnostic(text) ||
    looksLikeToolOutputDiagnosticPayload(text)
  );
}
