import type { AttentionCandidate } from "./interaction-candidate.js";

export type SemanticEvidenceStrength = "weak" | "qualified" | "strong";

export function readSemanticEvidenceStrength(
  candidate: AttentionCandidate,
): SemanticEvidenceStrength | null {
  const confidence = candidate.semanticConfidence ?? candidate.semanticOntology?.confidence;
  if (confidence === undefined) {
    return null;
  }

  if (candidate.semanticAbstained === true) {
    return "weak";
  }

  switch (confidence) {
    case "low":
      return "weak";
    case "medium":
      return candidate.semanticOntology?.source === "inferred" ? "weak" : "qualified";
    case "high":
      return candidate.semanticOntology?.source === "inferred" ? "qualified" : "strong";
  }
}

export function readSemanticSourceCriterionOffset(
  candidate: AttentionCandidate,
): number {
  const strength = readSemanticEvidenceStrength(candidate);
  const source = candidate.semanticOntology?.source;

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
