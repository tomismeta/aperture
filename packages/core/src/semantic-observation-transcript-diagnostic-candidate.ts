import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeDiagnosticReference } from "./semantic-diagnostic-reference-shapes.js";
import { looksLikeLocationDiagnosticObservation } from "./semantic-location-diagnostic-shapes.js";
import { readActualDiagnosticTranscriptSectionParts } from "./semantic-observation-transcript-actual-section.js";
import {
  looksLikeDiagnosticReferenceBlockBoundary,
  looksLikeDiagnosticReferenceSectionBoundary,
  looksLikeDiagnosticReferenceWrapper,
  looksLikeSourceOrFixtureActualWrapper,
  readReferenceBlockSkipIndex,
} from "./semantic-observation-transcript-diagnostic-boundaries.js";
import { looksLikeFailedTestOutputDiagnostic } from "./semantic-test-output-observation-shapes.js";
import { looksLikeSectionedTestOutputFailure } from "./semantic-test-result-section-shapes.js";
import { normalizeSemanticText } from "./semantic-text.js";
import { looksLikeTerminalFailureEvidence } from "./semantic-terminal-evidence.js";
import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";

export function readObservationTranscriptDiagnosticCandidate(text: string): string | null {
  const actualSection = readActualDiagnosticTranscriptSectionParts(text);
  if (actualSection !== null) {
    const candidate = readActualDiagnosticSectionCandidate(actualSection.section);
    if (candidate === null || looksLikeSourceOrFixtureActualWrapper(actualSection.preamble)) {
      return null;
    }
    return looksLikeDiagnosticReferenceWrapper(actualSection.preamble) &&
      !hasStrongRuntimeDiagnosticEvidence(candidate)
      ? null
      : candidate;
  }

  if (
    !text.includes("\n") &&
    !looksLikeDiagnosticReference(text) &&
    looksLikeDiagnosticCandidateText(text)
  ) {
    return text;
  }

  return readDiagnosticLineCandidate(text);
}

export function readActualDiagnosticSectionCandidate(section: string): string | null {
  return readDiagnosticLineCandidate(section);
}

function readDiagnosticLineCandidate(section: string): string | null {
  const text = section.trim();
  if (text.length === 0) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const candidate = line.trim();
    if (looksLikeDiagnosticReferenceSectionBoundary(candidate)) {
      if (looksLikeDiagnosticReferenceBlockBoundary(candidate)) {
        index = readReferenceBlockSkipIndex(lines, index);
      }
      continue;
    }
    if (
      candidate.length > 0 &&
      !looksLikeDiagnosticReference(candidate) &&
      looksLikeDiagnosticCandidateText(candidate)
    ) {
      return candidate;
    }
    const block = readSectionedDiagnosticBlockCandidate(lines, index);
    if (block !== null) {
      return block;
    }
  }

  return null;
}

function readSectionedDiagnosticBlockCandidate(lines: string[], index: number): string | null {
  const heading = lines[index]?.trim() ?? "";
  if (!/^={2,}\s*[^=\n][^\n]*\s*={2,}$/.test(heading)) {
    return null;
  }
  const next = lines
    .slice(index + 1)
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (next === undefined || looksLikeDiagnosticReferenceSectionBoundary(next)) {
    return null;
  }
  const block = `${heading}\n${next}`;
  return looksLikeDiagnosticCandidateText(block) ? block : null;
}

export function looksLikeDiagnosticCandidateText(text: string): boolean {
  return (
    looksLikeTerminalFailureEvidence(normalizeSemanticText(text)) ||
    hasStrongRuntimeDiagnosticEvidence(text) ||
    looksLikeFailedTestOutputDiagnostic(text) ||
    looksLikeSectionedTestOutputFailure(text) ||
    looksLikeLocationDiagnosticObservation(text) ||
    looksLikeToolOutputDiagnosticPayload(text)
  );
}
