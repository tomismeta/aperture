import type { AttentionCandidate } from "./interaction-candidate.js";
import { readSemanticRelationEvidenceStrength } from "./judgment-input.js";
import {
  hasConflictingSemanticRelationTargets,
  hasSemanticRelationKind,
} from "./semantic-relations.js";

export function hasQualifiedResolvingRelation(candidate: AttentionCandidate): boolean {
  const strength = readSemanticRelationEvidenceStrength(candidate);
  return (
    !candidate.blocking &&
    candidate.responseSpec.kind === "none" &&
    hasSemanticRelationKind(candidate.relationHints, "resolves") &&
    !hasConflictingSemanticRelationTargets(candidate.relationHints) &&
    (strength === null || strength !== "weak")
  );
}
