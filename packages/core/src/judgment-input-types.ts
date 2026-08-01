import type { SemanticConfidence } from "./semantic-types.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import type {
  NormalizedObservationSemanticAgreement,
  NormalizedObservation,
} from "./normalized-observation.js";
export type {
  ObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind,
} from "./observational-status-conflict.js";
export type { NormalizedObservation } from "./normalized-observation.js";

export type SemanticEvidenceStrength = "weak" | "qualified" | "strong";
export type TaskFailureSemanticAgreement = NormalizedObservationSemanticAgreement;

export type AttentionJudgmentInput = {
  ontology?: AttentionOntologyDiagnostic;
  semanticEvidence?: {
    confidence: SemanticConfidence;
    source: AttentionOntologyAuthority;
    strength: SemanticEvidenceStrength;
    abstained: boolean;
  };
  relationEvidence?: {
    source: AttentionOntologyAuthority;
    strength: SemanticEvidenceStrength;
  };
  observation?: NormalizedObservation;
  // Narrow status-routing diagnostic, not a generic proxy for blockingness.
  // Human input is already blocking by contract; this exists only for task
  // statuses that semantically read as blocked without becoming a full
  // human-input interaction.
  blockedLikeStatus: boolean;
  // Compatibility diagnostic for imported or adapter status noise: the source
  // reported a failed task status, but the engine-owned semantic read found an
  // observational payload. Low observations may become ambient; medium/high
  // observations keep their consequence while routing as status work.
  routineObservationalStatusConflict?: boolean;
  observationalStatusConflict?: ObservationalStatusConflictEvidence;
};

export type CandidateSemanticEvidence = NonNullable<AttentionJudgmentInput["semanticEvidence"]>;
