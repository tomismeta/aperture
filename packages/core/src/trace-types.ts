import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import type { AttentionDecisionRecord } from "./attention-decision-record.js";
import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type {
  AttentionInterruptCriterionVerdict,
  AttentionPolicyVerdict,
} from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { PolicyCriterionRuleEvaluation } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRuleEvaluation } from "./policy/policy-gate-rule.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { AttentionValueBreakdown } from "./attention-value.js";
import type {
  TraceCandidateTransition,
  TraceDecisionKind,
  TraceEventTransition,
  TraceFrameTransition,
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
  TraceInterruptCriterionVerdict,
  TraceObservationSummary,
  TraceResultLane,
  TraceSemanticImpact,
  TraceSemanticRoutingAuthority,
  TraceSemanticSummary,
} from "./trace-common.js";

export type ApertureTrace =
  | {
      timestamp: string;
      event: ApertureEvent;
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "noop";
      };
      taskSummary: AttentionSignalSummary;
      globalSummary: AttentionSignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      pressureForecast: AttentionPressure;
      attentionBurden: AttentionBurden;
      current: AttentionFrame | null;
      taskView: AttentionTaskView;
      attentionView: AttentionView;
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "clear";
        taskId: string;
      };
      taskSummary: AttentionSignalSummary;
      globalSummary: AttentionSignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      pressureForecast: AttentionPressure;
      attentionBurden: AttentionBurden;
      current: AttentionFrame | null;
      taskView: AttentionTaskView;
      attentionView: AttentionView;
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      eventTransition: TraceEventTransition;
      evaluation: {
        kind: "candidate";
        original: AttentionCandidate;
        adjusted: AttentionCandidate;
      };
      candidateTransition: TraceCandidateTransition;
      frameTransition: TraceFrameTransition;
      heuristics: {
        scoreOffset: number;
        rationale: string[];
      };
      semantic?: TraceSemanticSummary;
      episode: EpisodeSummary | null;
      decisionRecord: AttentionDecisionRecord;
      policy: AttentionPolicyVerdict;
      policyRules: {
        gateEvaluations: PolicyGateRuleEvaluation[];
        criterion: AttentionInterruptCriterionVerdict | null;
        criterionEvaluations: PolicyCriterionRuleEvaluation[];
      };
      utility: {
        candidate: AttentionValueBreakdown;
        currentScore: number | null;
        currentPriority: AttentionPriority | null;
      };
      planner: {
        kind: TraceDecisionKind;
        reasons: string[];
        reasonCodes: AttentionDecisionRecord["planning"]["reasonCodes"];
        continuityEvaluations: AttentionDecisionRecord["planning"]["continuityEvaluations"];
      };
      coordination: {
        kind: TraceDecisionKind;
        resultLane: "now" | "next" | "ambient" | "none";
        candidateScore: number;
        currentScore: number | null;
        currentPriority: AttentionPriority | null;
        criterion: AttentionInterruptCriterionVerdict | null;
        ambiguity: AttentionDecisionAmbiguity | null;
        reasons: string[];
        reasonCodes: AttentionDecisionRecord["planning"]["reasonCodes"];
        continuityEvaluations: AttentionDecisionRecord["planning"]["continuityEvaluations"];
      };
      taskSummary: AttentionSignalSummary;
      globalSummary: AttentionSignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      pressureForecast: AttentionPressure;
      attentionBurden: AttentionBurden;
      current: AttentionFrame | null;
      taskView: AttentionTaskView;
      attentionView: AttentionView;
      result: AttentionFrame | null;
    };

export type CandidateApertureTrace = Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;

export function isCandidateTrace(trace: ApertureTrace): trace is CandidateApertureTrace {
  return isCandidateTraceLike(trace);
}
