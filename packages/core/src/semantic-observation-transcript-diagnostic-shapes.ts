import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeFailedTestOutputDiagnostic } from "./semantic-test-output-observation-shapes.js";
import { looksLikeSectionedTestOutputFailure } from "./semantic-test-result-section-shapes.js";
import { normalizeSemanticText } from "./semantic-text.js";
import { looksLikeTerminalFailureEvidence } from "./semantic-terminal-evidence.js";
import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";

export function looksLikeObservationTranscriptDiagnostic(text: string): boolean {
  return (
    looksLikeTerminalFailureEvidence(normalizeSemanticText(text)) ||
    hasStrongRuntimeDiagnosticEvidence(text) ||
    looksLikeFailedTestOutputDiagnostic(text) ||
    looksLikeSectionedTestOutputFailure(text) ||
    looksLikeToolOutputDiagnosticPayload(text)
  );
}
