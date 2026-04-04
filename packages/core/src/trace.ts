import type { ApertureEvent } from "./events.js";
import type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticFieldProvenance,
  SemanticIntentFrame,
  SemanticRelationHint,
} from "./semantic-types.js";

export type TraceDecisionKind = "auto_approve" | "activate" | "queue" | "ambient" | "clear";

export type TraceResultLane = "now" | "next" | "ambient" | "none";

export type TraceAttentionPriority = "background" | "normal" | "high";

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
 * `abstained`, `provenance`, and `impact` are suitable for programmatic use.
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

/**
 * Public explanation trace emitted by `ApertureCore.onTrace(...)`.
 *
 * The public trace surface is intentionally narrower than the workspace's
 * internal trace snapshot. It is meant to explain what happened and why,
 * without freezing the full coordinator and state-store internals.
 */
export type ApertureTrace =
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "noop";
      };
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "clear";
        taskId: string;
      };
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "candidate";
      };
      semantic?: TraceSemanticSummary;
      policyRules: {
        gateEvaluations: TraceGateEvaluation[];
        criterion: TraceInterruptCriterionVerdict | null;
        criterionEvaluations: TraceCriterionEvaluation[];
      };
      coordination: {
        kind: TraceDecisionKind;
        resultLane: TraceResultLane;
        candidateScore: number;
        currentScore: number | null;
        currentPriority: TraceAttentionPriority | null;
        ambiguity: TraceDecisionAmbiguity | null;
        reasons: string[];
        continuityEvaluations: TraceContinuityEvaluation[];
      };
    };

export type CandidateApertureTrace = Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;

export function isCandidateTrace(trace: ApertureTrace): trace is CandidateApertureTrace {
  return trace.evaluation.kind === "candidate";
}
