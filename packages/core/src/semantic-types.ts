import type {
  AttentionActivityClass,
  AttentionConsequenceLevel,
} from "./attention-contract-types.js";

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

export type SemanticActivityClass = AttentionActivityClass;

export type SemanticConsequenceLevel = AttentionConsequenceLevel;

export type SemanticConfidence = "low" | "medium" | "high";

export type SemanticProvenanceKind = "source" | "inferred" | "hint";

export type SemanticFieldProvenance = Partial<{
  intentFrame: SemanticProvenanceKind;
  activityClass: SemanticProvenanceKind;
  toolFamily: SemanticProvenanceKind;
  consequence: SemanticProvenanceKind;
  whyNow: SemanticProvenanceKind;
  relationHints: SemanticProvenanceKind;
  confidence: SemanticProvenanceKind;
  abstained: SemanticProvenanceKind;
}>;

export type SemanticRelationHint = {
  kind: "same_issue" | "resolves" | "supersedes" | "repeats" | "escalates";
  target?: string;
};

export type SemanticInterpretation = {
  /** Canonical semantic frame for explanation, testing, and adapter inspection. */
  intentFrame: SemanticIntentFrame;
  /** Decision-bearing when projected into canonical events. */
  activityClass?: SemanticActivityClass;
  /** Decision-bearing when projected into canonical events. */
  toolFamily?: string;
  /** Decision-bearing on human-input normalization and named task-status diagnostics. */
  consequence?: SemanticConsequenceLevel;
  /** Explanation-bearing semantic summary for provenance and review surfaces. */
  whyNow?: string;
  /** Explanation-bearing semantic factors merged into provenance. */
  factors: string[];
  /** Continuity-bearing semantic relations. */
  relationHints: SemanticRelationHint[];
  /** Semantic uncertainty signal used by ambiguity handling on non-blocking work. */
  confidence: SemanticConfidence;
  /** Explanation-bearing reason strings for tests, diagnostics, and Lab. */
  reasons: string[];
  /** Explicit abstention signal used by ambiguity handling on non-blocking work. */
  abstained?: boolean;
  /** Explanation-only provenance for discoverability and replay. */
  provenance?: SemanticFieldProvenance;
};

export type SemanticInterpretationHints = Partial<
  Omit<SemanticInterpretation, "reasons" | "relationHints" | "factors">
> & {
  factors?: string[];
  relationHints?: SemanticRelationHint[];
  reasons?: string[];
};
