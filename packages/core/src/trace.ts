import type { ApertureEvent } from "./events.js";
import type {
  TraceAttentionPriority,
  TraceCandidateTransition,
  TraceContinuityEvaluation,
  TraceCriterionEvaluation,
  TraceDecisionAmbiguity,
  TraceDecisionKind,
  TraceEventTransition,
  TraceFrameTransition,
  TraceGateEvaluation,
  TraceInterruptCriterionVerdict,
  TraceResultLane,
  TraceSemanticSummary,
} from "./trace-common.js";
import { isCandidateTraceLike } from "./trace-common.js";
export type {
  TraceAttentionPriority,
  TraceCandidateTransition,
  TraceContinuityEvaluation,
  TraceCriterionEvaluation,
  TraceDecisionAmbiguity,
  TraceDecisionKind,
  TraceFieldDiff,
  TraceEventFieldDiff,
  TraceEventTransition,
  TraceEventTransitionKind,
  TraceFrameTransition,
  TraceGateEvaluation,
  TraceInterruptCriterion,
  TraceInterruptCriterionVerdict,
  TraceObservationSummary,
  TraceResultLane,
  TraceSemanticImpact,
  TraceSemanticRoutingAuthority,
  TraceSemanticSummary,
  ObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind,
} from "./trace-common.js";
export type {
  AttentionOntologyDiagnostic,
  AttentionOntologyActivity,
  AttentionOntologyAsk,
  AttentionOntologyAuthority,
  AttentionOntologyBlocking,
  AttentionOntologyEpisode,
} from "./semantic-ontology.js";

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
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "noop";
      };
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "clear";
        taskId: string;
      };
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "candidate";
      };
      candidateTransition: TraceCandidateTransition;
      frameTransition: TraceFrameTransition;
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
  return isCandidateTraceLike(trace);
}
