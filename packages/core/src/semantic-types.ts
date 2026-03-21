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

export type SemanticRelationHint = {
  kind: "same_issue" | "resolves" | "supersedes" | "repeats" | "escalates";
  target?: string;
};

/**
 * Bounded semantic read of a {@link SourceEvent}.
 *
 * Contract notes:
 * - `toolFamily`, `activityClass`, `relationHints`, and human-input
 *   `consequence` can influence canonical events or downstream judgment.
 * - `intentFrame`, `whyNow`, `factors`, and `reasons` are primarily
 *   explanatory and benchmark-facing.
 * - `confidence` and `abstained` are semantic uncertainty signals, but they
 *   are not live score multipliers today.
 * - On `task.updated`, `status` remains authoritative for routing even when
 *   the semantic read is richer.
 */
export type SemanticInterpretation = {
  /** Canonical semantic frame for explanation, testing, and adapter inspection. */
  intentFrame: SemanticIntentFrame;
  /** Decision-bearing when projected into canonical events. */
  activityClass?: SemanticActivityClass;
  /** Decision-bearing when projected into canonical events. */
  toolFamily?: string;
  /** Decision-bearing on human-input normalization; non-authoritative on task status routing. */
  consequence?: SemanticConsequenceLevel;
  /** Explanation-bearing semantic summary for provenance and review surfaces. */
  whyNow?: string;
  /** Explanation-bearing semantic factors merged into provenance. */
  factors: string[];
  /** Continuity-bearing semantic relations. */
  relationHints: SemanticRelationHint[];
  /** Semantic uncertainty signal reserved for future abstention-aware policy. */
  confidence: SemanticConfidence;
  /** Explanation-bearing reason strings for tests, diagnostics, and Lab. */
  reasons: string[];
  /** Explicit abstention signal reserved for future policy work. */
  abstained?: boolean;
};

export type SemanticInterpretationHints = Partial<
  Omit<SemanticInterpretation, "reasons" | "relationHints" | "factors">
> & {
  factors?: string[];
  relationHints?: SemanticRelationHint[];
  reasons?: string[];
};
