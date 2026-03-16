import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
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
import type { ContinuityRuleEvaluation } from "./continuity/continuity-rule.js";

export type ApertureTrace =
  | {
      timestamp: string;
      event: ApertureEvent;
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
      evaluation: {
        kind: "candidate";
        original: AttentionCandidate;
        adjusted: AttentionCandidate;
      };
      heuristics: {
        scoreOffset: number;
        rationale: string[];
      };
      episode: EpisodeSummary | null;
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
        kind: "auto_approve" | "activate" | "queue" | "ambient" | "clear";
        reasons: string[];
        continuityEvaluations: ContinuityRuleEvaluation[];
      };
      coordination: {
        kind: "auto_approve" | "activate" | "queue" | "ambient" | "clear";
        candidateScore: number;
        currentScore: number | null;
        currentPriority: AttentionPriority | null;
        criterion: AttentionInterruptCriterionVerdict | null;
        ambiguity: AttentionDecisionAmbiguity | null;
        reasons: string[];
        continuityEvaluations: ContinuityRuleEvaluation[];
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
