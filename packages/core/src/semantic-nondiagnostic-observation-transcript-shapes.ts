import {
  readExplicitObservationTranscript,
  type ExplicitObservationTranscript,
} from "./semantic-observation-transcript-shapes.js";
import { looksLikeObservationTranscriptDiagnostic } from "./semantic-observation-transcript-diagnostic-shapes.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";

export function readExplicitNonDiagnosticObservationTranscript(
  value: string,
): ExplicitObservationTranscript | null {
  const body = readExplicitObservationTranscriptBody(value);
  if (body === null || looksLikeObservationTranscriptDiagnostic(body)) {
    return null;
  }

  return readExplicitObservationTranscript(value);
}
