export { interpretSourceEvent } from "./semantic-interpreter.js";
export {
  TRUNCATED_SOURCE_EVIDENCE_FACTOR,
  semanticHintsForTruncatedSourceEvidence,
} from "./semantic-source-quality.js";
export { readAttentionOntologyDiagnostic } from "./semantic-ontology.js";
export { enrichApertureEvent, normalizeSourceEvent } from "./semantic-normalizer.js";

export type { EnrichedApertureEvent } from "./events.js";
export type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticInterpretation,
  SemanticInterpretationHints,
  SemanticIntentFrame,
  SemanticRelationHint,
} from "./semantic-types.js";
export type { TruncatedSourceEvidenceHintOptions } from "./semantic-source-quality.js";
export type {
  AttentionOntologyActivity,
  AttentionOntologyAsk,
  AttentionOntologyAuthority,
  AttentionOntologyBlocking,
  AttentionOntologyDiagnostic,
  AttentionOntologyEpisode,
} from "./semantic-ontology.js";
