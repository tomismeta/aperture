import type { SemanticConfidence } from "./semantic-types.js";
import type {
  SemanticOntologyDiagnostic,
  SemanticOntologySource,
} from "./semantic-ontology-types.js";

export type SemanticEvidenceStrength = "weak" | "qualified" | "strong";

export type AttentionJudgmentInput = {
  ontology?: SemanticOntologyDiagnostic;
  semanticEvidence?: {
    confidence: SemanticConfidence;
    source: SemanticOntologySource;
    strength: SemanticEvidenceStrength;
    abstained: boolean;
  };
  relationEvidence?: {
    source: SemanticOntologySource;
    strength: SemanticEvidenceStrength;
  };
  // Narrow status-routing diagnostic, not a generic proxy for blockingness.
  // Human input is already blocking by contract; this exists only for task
  // statuses that semantically read as blocked without becoming a full
  // human-input interaction.
  blockedLikeStatus: boolean;
};

export type CandidateSemanticEvidence = NonNullable<AttentionJudgmentInput["semanticEvidence"]>;
