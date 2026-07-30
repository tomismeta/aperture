import {
  readExplicitObservationTranscript,
  type ExplicitObservationTranscript,
} from "./semantic-observation-transcript-shapes.js";
import { looksLikeObservationTranscriptDiagnostic } from "./semantic-observation-transcript-diagnostic-shapes.js";
import { hasToolUseRejectionSignal } from "./semantic-tool-use-rejection-shapes.js";

export function readExplicitNonDiagnosticObservationTranscript(
  value: string,
): ExplicitObservationTranscript | null {
  const body = readExplicitObservationTranscriptBody(value);
  if (
    body === null ||
    hasToolUseRejectionSignal(body) ||
    looksLikeObservationTranscriptDiagnostic(body)
  ) {
    return null;
  }

  return readExplicitObservationTranscript(value);
}

function readExplicitObservationTranscriptBody(value: string): string | null {
  const match = /^\s*OBSERVATION:\s*([\s\S]+)$/i.exec(value);
  const body = match?.[1]?.trim() ?? "";

  return body.length > 0 && body !== "{}" ? body : null;
}
