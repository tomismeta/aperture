export type SemanticIntentFrame =
  | "task_started"
  | "status_update"
  | "blocked_work"
  | "failure"
  | "approval_request"
  | "question_request"
  | "form_request"
  | "completion"
  | "cancellation";

export type SemanticActivityClass =
  | "permission_request"
  | "question_request"
  | "follow_up"
  | "tool_completion"
  | "tool_failure"
  | "session_status"
  | "status_update";

export type SemanticConsequenceLevel = "low" | "medium" | "high";

export type SemanticConfidence = "low" | "medium" | "high";

export type SemanticRequestExplicitness = "none" | "implied" | "explicit";

export type SemanticRelationHint = {
  kind: "same_issue" | "resolves" | "supersedes" | "repeats" | "escalates";
  target?: string;
};

export type SemanticInterpretation = {
  intentFrame: SemanticIntentFrame;
  activityClass?: SemanticActivityClass;
  toolFamily?: string;
  operatorActionRequired: boolean;
  requestExplicitness: SemanticRequestExplicitness;
  consequence?: SemanticConsequenceLevel;
  whyNow?: string;
  factors: string[];
  relationHints: SemanticRelationHint[];
  confidence: SemanticConfidence;
  reasons: string[];
  abstained?: boolean;
};

export type SemanticInterpretationHints = Partial<
  Omit<SemanticInterpretation, "reasons" | "relationHints" | "factors">
> & {
  factors?: string[];
  relationHints?: SemanticRelationHint[];
  reasons?: string[];
};
