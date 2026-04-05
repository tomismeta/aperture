import type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticFieldProvenance,
  SemanticIntentFrame,
  SemanticRelationHint,
} from "./semantic-types.js";
import type { ApertureEvent } from "./events.js";
import type { SemanticOntologyDiagnostic } from "./semantic-ontology.js";
import type { SourceEvent } from "./source-event.js";

export type TraceDecisionKind = "auto_approve" | "activate" | "queue" | "ambient" | "clear";

export type TraceResultLane = "now" | "next" | "ambient" | "none";

export type TraceAttentionPriority = "background" | "normal" | "high";

export type TraceEventTransitionKind =
  | "source_normalized"
  | "direct_enriched"
  | "direct_passthrough";

export type TraceFieldDiff = {
  path: string;
  before: unknown;
  after: unknown;
};

export type TraceEventFieldDiff = TraceFieldDiff;

export type TraceEventTransition = {
  kind: TraceEventTransitionKind;
  original: SourceEvent | ApertureEvent;
  finalized: ApertureEvent;
  changedFields: TraceEventFieldDiff[];
};

export type TraceCandidateTransition = {
  changedFields: TraceFieldDiff[];
};

export type TraceFrameTransition = {
  changedFields: TraceFieldDiff[];
};

export type TraceDecisionAmbiguity = {
  kind: "interrupt";
  reason: "low_signal" | "small_score_gap";
  resolution: "queue" | "ambient";
};

export type TraceInterruptCriterion = {
  activationThreshold: number;
  promotionMargin: number;
};

export type TraceInterruptCriterionVerdict = {
  criterion: TraceInterruptCriterion;
  peripheralResolution: "queue" | "ambient" | null;
  ambiguity: TraceDecisionAmbiguity | null;
  rationale: string[];
};

export type TraceGateEvaluation = {
  rule: string;
  kind: "noop" | "verdict";
  rationale: string[];
};

export type TraceCriterionEvaluation = {
  rule: string;
  kind: "noop" | "adjust" | "verdict";
  rationale: string[];
};

export type TraceContinuityEvaluation = {
  rule: string;
  kind: "noop" | "override";
  rationale: string[];
};

/**
 * Stable semantic summary for SDK consumers.
 *
 * `intentFrame`, `activityClass`, `toolFamily`, `consequence`, `confidence`,
 * `abstained`, `ontology`, `provenance`, and `impact` are suitable for
 * programmatic use.
 * `whyNow`, `factors`, `reasons`, and `influence` are explanatory text and
 * may evolve as the product language gets clearer.
 */
export type TraceSemanticSummary = {
  intentFrame: SemanticIntentFrame;
  activityClass?: SemanticActivityClass;
  toolFamily?: string;
  consequence?: SemanticConsequenceLevel;
  confidence?: SemanticConfidence;
  abstained?: boolean;
  ontology: SemanticOntologyDiagnostic;
  whyNow?: string;
  relationHints: SemanticRelationHint[];
  factors: string[];
  reasons: string[];
  influence: string[];
  impact: {
    decisionBearing: string[];
    explanatory: string[];
  };
  provenance?: SemanticFieldProvenance;
};

export function isCandidateTraceLike<T extends { evaluation: { kind: string } }>(
  trace: T,
): trace is T & { evaluation: Extract<T["evaluation"], { kind: "candidate" }> } {
  return trace.evaluation.kind === "candidate";
}
