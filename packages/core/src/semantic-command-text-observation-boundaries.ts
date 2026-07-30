import { looksLikeBareDiagnosticObservationBody } from "./semantic-bare-diagnostic-observation-shapes.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";

export function looksLikeRejectedCommandTextObservation(text: string): boolean {
  return (
    looksLikeObservationReferenceWrapper(text) ||
    looksLikeBareDiagnosticObservationBody(text) ||
    looksLikePlainExpectedActualDiffFixture(text) ||
    looksLikeShortSourceLiteralWrapper(text) ||
    looksLikeEmbeddedPatchString(text)
  );
}

function looksLikeShortSourceLiteralWrapper(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return (
    lines.length <= 3 &&
    /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*["'`]\s*;?\s*(?:\r?\n\s*return\b[\s\S]*)?$/i.test(
      text,
    )
  );
}

function looksLikeEmbeddedPatchString(text: string): boolean {
  return /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*\bdiff --git\b/i.test(text);
}

function looksLikePlainExpectedActualDiffFixture(text: string): boolean {
  return /^\s*---\s+expected\b[\s\S]*^\s*\+\+\+\s+actual\b/im.test(text);
}
