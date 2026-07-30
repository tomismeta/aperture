import { OBSERVATIONAL_READBACK_PHRASES } from "./semantic-patterns.js";
import { looksLikeAbbreviatedFileViewObservation } from "./semantic-abbreviated-file-view-observation-shapes.js";
import { looksLikeObservationTranscriptDiagnostic } from "./semantic-observation-transcript-diagnostic-shapes.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeLocationDiagnosticObservation } from "./semantic-location-diagnostic-shapes.js";
import { looksLikeSectionedSourceObservation } from "./semantic-sectioned-source-observation-shapes.js";
import { looksLikeSearchResultObservation } from "./semantic-search-observation-shapes.js";
import { looksLikeSourceFixtureObservation } from "./semantic-source-fixture-observation-shapes.js";
import { looksLikeTaggedFileObservationTranscript } from "./semantic-tagged-file-observation-transcript-shapes.js";
import { readTestOutputObservation } from "./semantic-test-output-observation-shapes.js";
import { looksLikeSectionedTestOutputFailure } from "./semantic-test-result-section-shapes.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { hasToolUseRejectionSignal } from "./semantic-tool-use-rejection-shapes.js";

export type ExplicitObservationTranscript = {
  shape:
    | "existing_observation"
    | "successful_test"
    | "concrete_test_result"
    | "abbreviated_file_view";
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
  const testOutput = readTestOutputObservation(body);
  if (testOutput !== null) {
    if (looksLikeObservationTranscriptDiagnostic(body)) {
      return null;
    }
    return {
      shape: testOutput.consequenceBaseline === "low" ? "successful_test" : "concrete_test_result",
      consequenceBaseline: testOutput.consequenceBaseline,
    };
  }
  if (looksLikeAbbreviatedFileViewObservation(body)) {
    return { shape: "abbreviated_file_view", consequenceBaseline: "low" };
  }
  if (
    containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES) ||
    looksLikeSourceFixtureObservation(body)
  ) {
    return { shape: "existing_observation", consequenceBaseline: "high" };
  }
  if (looksLikeSectionedTestOutputFailure(body)) {
    return null;
  }
  if (looksLikeLocationDiagnosticObservation(body)) {
    return null;
  }
  if (
    looksLikeTaggedFileObservationTranscript(text) ||
    looksLikeSectionedSourceObservation(body) ||
    looksLikeStrongRawSourceObservation(body) ||
    looksLikePlainReadObservation(body) ||
    looksLikeBuildOrLogObservation(body) ||
    looksLikeSearchResultObservation(text, body)
  ) {
    return { shape: "existing_observation", consequenceBaseline: "high" };
  }

  return null;
}
