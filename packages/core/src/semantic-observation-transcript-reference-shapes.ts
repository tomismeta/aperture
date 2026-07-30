import { looksLikeDiagnosticReference } from "./semantic-diagnostic-reference-shapes.js";
import { readActualDiagnosticTranscriptSectionParts } from "./semantic-observation-transcript-actual-section.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import { looksLikeDiagnosticReferenceWrapper } from "./semantic-observation-transcript-diagnostic-boundaries.js";
import {
  readActualDiagnosticSectionCandidate,
  readObservationTranscriptDiagnosticCandidate,
} from "./semantic-observation-transcript-diagnostic-candidate.js";
import { hasToolUseRejectionSignal } from "./semantic-tool-use-rejection-shapes.js";

export function looksLikeExplicitDiagnosticReferenceObservationTranscript(value: string): boolean {
  const body = readExplicitObservationTranscriptBody(value);
  if (body === null || hasToolUseRejectionSignal(body)) {
    return false;
  }
  const parts = readActualDiagnosticTranscriptSectionParts(body);
  if (parts === null) {
    return (
      (looksLikeDiagnosticReference(body) || containsDiagnosticReferenceLine(body)) &&
      readObservationTranscriptDiagnosticCandidate(body) === null
    );
  }

  return (
    looksLikeDiagnosticReferenceWrapper(parts.preamble) ||
    (readActualDiagnosticSectionCandidate(parts.section) === null &&
      (looksLikeDiagnosticReference(body) || containsDiagnosticReferenceLine(parts.section)))
  );
}

export function looksLikeExplicitActualDiagnosticObservationTranscript(value: string): boolean {
  const body = readExplicitObservationTranscriptBody(value);
  if (body === null || hasToolUseRejectionSignal(body)) {
    return false;
  }
  const parts = readActualDiagnosticTranscriptSectionParts(body);
  return parts !== null && readObservationTranscriptDiagnosticCandidate(body) !== null;
}

function containsDiagnosticReferenceLine(text: string): boolean {
  return text.split(/\r?\n/).some((line) => looksLikeDiagnosticReference(line.trim()));
}
