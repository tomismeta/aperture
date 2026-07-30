import type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticFieldProvenance,
  SemanticIntentFrame,
  SemanticRelationHint,
} from "./semantic-types.js";
import type { ApertureEvent } from "./events.js";
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import type { AttentionOntologyDiagnostic } from "./semantic-ontology.js";
import type { SourceEvent } from "./source-event.js";
export type {
  ObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind,
} from "./observational-status-conflict.js";

export type TraceDecisionKind =
  | "auto_approve"
  | "activate"
  | "queue"
  | "ambient"
  | "clear"
  | "suppressed";

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

export type TraceSemanticRoutingAuthority = "status" | "request" | "event";

/**
 * Stable semantic impact summary for SDK consumers.
 *
 * `routingAuthority`, `canonical`, `routing`, `continuity`, `ambiguity`, and
 * `contextOnly` are the preferred fields for product surfaces and audits.
 * `decisionBearing` and `explanatory` remain as coarse compatibility groupings.
 */
export type TraceSemanticImpact = {
  routingAuthority: TraceSemanticRoutingAuthority;
  decisionBearing: string[];
  explanatory: string[];
  canonical: string[];
  routing: string[];
  continuity: string[];
  ambiguity: string[];
  contextOnly: string[];
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
 * `abstained`, `observationalStatusConflict`, `ontology`, `provenance`, and
 * `impact` are suitable for programmatic use.
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
  observationalStatusConflict?: ObservationalStatusConflictEvidence;
  ontology: AttentionOntologyDiagnostic;
  whyNow?: string;
  relationHints: SemanticRelationHint[];
  factors: string[];
  reasons: string[];
  influence: string[];
  impact: TraceSemanticImpact;
  provenance?: SemanticFieldProvenance;
};

export function isCandidateTraceLike<T extends { evaluation: { kind: string } }>(
  trace: T,
): trace is T & { evaluation: Extract<T["evaluation"], { kind: "candidate" }> } {
  return trace.evaluation.kind === "candidate";
}
