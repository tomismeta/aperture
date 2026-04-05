import type { ApertureEvent } from "./events.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import {
  projectSemanticOntologyDiagnostic,
  type SemanticOntologyDiagnostic,
  type SemanticOntologySource,
} from "./semantic-ontology.js";
import type { SemanticConfidence } from "./semantic-types.js";

export type SemanticEvidenceStrength = "weak" | "qualified" | "strong";

export type AttentionJudgmentInput = {
  ontology?: SemanticOntologyDiagnostic;
  semanticEvidence?: {
    confidence: SemanticConfidence;
    source: SemanticOntologySource;
    strength: SemanticEvidenceStrength;
    abstained: boolean;
  };
  blockedLikeStatus: boolean;
};

export function buildAttentionJudgmentInput(
  event: ApertureEvent,
): AttentionJudgmentInput {
  if (!event.semantic) {
    return {
      blockedLikeStatus: false,
    };
  }

  const ontology = projectSemanticOntologyDiagnostic(event, event.semantic);
  const abstained = event.semantic.abstained === true;

  return {
    ontology,
    semanticEvidence: {
      confidence: ontology.confidence,
      source: ontology.source,
      strength: readSemanticEvidenceStrengthFromParts(
        ontology.confidence,
        ontology.source,
        abstained,
      ),
      abstained,
    },
    blockedLikeStatus:
      event.type === "task.updated"
      && ontology.blocking === "blocking"
      && event.status !== "blocked",
  };
}

export function readSemanticEvidenceStrength(
  candidate: AttentionCandidate,
): SemanticEvidenceStrength | null {
  return candidate.judgmentInput.semanticEvidence?.strength ?? null;
}

export function readSemanticSourceCriterionOffset(
  candidate: AttentionCandidate,
): number {
  const strength = readSemanticEvidenceStrength(candidate);
  const source = candidate.judgmentInput.semanticEvidence?.source;

  if (!strength || !source) {
    return 0;
  }

  if (source === "inferred") {
    switch (strength) {
      case "weak":
        return -2;
      case "qualified":
        return -1;
      case "strong":
        return 0;
    }
  }

  if ((source === "explicit" || source === "hinted") && strength === "strong") {
    return 1;
  }

  return 0;
}

export function hasBlockedLikeStatusSemantics(candidate: AttentionCandidate): boolean {
  return candidate.judgmentInput.blockedLikeStatus;
}

export function resolvePeripheralResolutionFloor(
  candidate: AttentionCandidate,
  fallback: "queue" | "ambient",
): "queue" | "ambient" {
  if (fallback === "ambient" && hasBlockedLikeStatusSemantics(candidate)) {
    return "queue";
  }

  return fallback;
}

function readSemanticEvidenceStrengthFromParts(
  confidence: SemanticConfidence,
  source: SemanticOntologySource | undefined,
  abstained: boolean,
): SemanticEvidenceStrength {
  if (abstained) {
    return "weak";
  }

  switch (confidence) {
    case "low":
      return "weak";
    case "medium":
      return source === "inferred" ? "weak" : "qualified";
    case "high":
      return source === "inferred" ? "qualified" : "strong";
  }
}
