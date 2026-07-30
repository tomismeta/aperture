import {
  readObservationTranscriptDiagnosticCandidate,
  looksLikeDiagnosticCandidateText,
} from "./semantic-observation-transcript-diagnostic-candidate.js";

export function looksLikeObservationTranscriptDiagnostic(text: string): boolean {
  const diagnosticText = readObservationTranscriptDiagnosticCandidate(text);
  return diagnosticText !== null && looksLikeDiagnosticCandidateText(diagnosticText);
}
