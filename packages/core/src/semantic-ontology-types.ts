import type { SemanticConfidence, SemanticConsequenceLevel } from "./semantic-types.js";

/**
 * Compact attention ontology projected from richer semantic interpretation.
 *
 * The ontology is the stable kernel vocabulary for attention judgment. It is
 * intentionally smaller than `SemanticInterpretation`: detailed reasons,
 * relation targets, prose, and provenance stay in semantic traces, while this
 * shape carries only the dimensions judgment and conformance need to compare
 * across hosts.
 */
export type AttentionOntologyDiagnostic = {
  ask: AttentionOntologyAsk;
  activity: AttentionOntologyActivity;
  consequence?: SemanticConsequenceLevel;
  blocking: AttentionOntologyBlocking;
  episode: AttentionOntologyEpisode;
  confidence: SemanticConfidence;
  source: AttentionOntologyAuthority;
};

export type AttentionOntologyAsk = "approval" | "choice" | "form" | "status" | "none";

export type AttentionOntologyActivity =
  | "decision_request"
  | "question"
  | "task_progress"
  | "task_completion"
  | "failure"
  | "background_work";

export type AttentionOntologyBlocking = "blocking" | "waiting" | "non_blocking";

export type AttentionOntologyEpisode = "new" | "same_issue" | "resurfaced" | "resolved" | "unknown";

export type AttentionOntologyAuthority = "explicit" | "hinted" | "inferred";

// Backwards-compatible semantic-era names. New kernel work should prefer the
// `AttentionOntology*` names above.
export type SemanticOntologyDiagnostic = AttentionOntologyDiagnostic;
export type SemanticOntologyAsk = AttentionOntologyAsk;
export type SemanticOntologyActivity = AttentionOntologyActivity;
export type SemanticOntologyBlocking = AttentionOntologyBlocking;
export type SemanticOntologyEpisode = AttentionOntologyEpisode;
export type SemanticOntologySource = AttentionOntologyAuthority;
