import type { SemanticConfidence, SemanticConsequenceLevel } from "./semantic-types.js";

export type SemanticOntologyAsk =
  | "approval"
  | "choice"
  | "form"
  | "status"
  | "none";

export type SemanticOntologyActivity =
  | "decision_request"
  | "question"
  | "task_progress"
  | "task_completion"
  | "failure"
  | "background_work";

export type SemanticOntologyBlocking =
  | "blocking"
  | "waiting"
  | "non_blocking";

export type SemanticOntologyEpisode =
  | "new"
  | "same_issue"
  | "resurfaced"
  | "resolved"
  | "unknown";

export type SemanticOntologySource =
  | "explicit"
  | "hinted"
  | "inferred";

export type SemanticOntologyDiagnostic = {
  ask: SemanticOntologyAsk;
  activity: SemanticOntologyActivity;
  consequence?: SemanticConsequenceLevel;
  blocking: SemanticOntologyBlocking;
  episode: SemanticOntologyEpisode;
  confidence: SemanticConfidence;
  source: SemanticOntologySource;
};
