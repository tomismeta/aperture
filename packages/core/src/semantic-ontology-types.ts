import type { SemanticConfidence, SemanticConsequenceLevel } from "./semantic-types.js";

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
