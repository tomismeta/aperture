import type { AttentionFrame, AttentionView } from "./frame.js";

import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionResponse } from "./frame-response.js";
import { priorityForFrame, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import {
  resolveAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import {
  AttentionPolicy,
  type AttentionInterruptCriterionVerdict,
  type AttentionPolicyVerdict,
} from "./attention-policy.js";
import type { PolicyCriterionRuleEvaluation } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRuleEvaluation } from "./policy/policy-gate-rule.js";
import type { AttentionPressure } from "./attention-pressure.js";
import { AttentionPlanner } from "./attention-planner.js";
import type { ContinuityRuleEvaluation } from "./continuity/continuity-rule.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { AttentionSurfaceCapabilities } from "./surface-capabilities.js";
import { AttentionValue, type AttentionValueBreakdown } from "./attention-value.js";
import type { AmbiguityDefaults } from "./judgment-config.js";

export type AttentionDecision =
  | { kind: "auto_approve"; candidate: AttentionCandidate; response: AttentionResponse }
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate }
  | { kind: "clear" };

export type AttentionDecisionExplanation = {
  decision: AttentionDecision;
  policy: AttentionPolicyVerdict;
  policyGateEvaluations: PolicyGateRuleEvaluation[];
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  policyCriterionEvaluations: PolicyCriterionRuleEvaluation[];
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: AttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  continuityEvaluations: ContinuityRuleEvaluation[];
};

export type AttentionDecisionContext = AttentionEvidenceContext | AttentionEvidenceInput;

type JudgmentCoordinatorOptions = {
  ambiguityDefaults?: AmbiguityDefaults;
};

export class JudgmentCoordinator {
  private readonly policyGates: AttentionPolicy;
  private readonly utilityScore: AttentionValue;
  private readonly queuePlanner: AttentionPlanner;
  private readonly ambiguityDefaults: AmbiguityDefaults | undefined;

  constructor(
    policyGates: AttentionPolicy = new AttentionPolicy(),
    utilityScore: AttentionValue = new AttentionValue(),
    queuePlanner: AttentionPlanner = new AttentionPlanner(),
    options: JudgmentCoordinatorOptions = {},
  ) {
    this.policyGates = policyGates;
    this.utilityScore = utilityScore;
    this.queuePlanner = queuePlanner;
    this.ambiguityDefaults = options.ambiguityDefaults;
  }

  coordinate(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    context: AttentionDecisionContext = {},
  ): AttentionDecision {
    return this.explain(current, candidate, context).decision;
  }

  explain(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    context: AttentionDecisionContext = {},
  ): AttentionDecisionExplanation {
    const evidence = this.resolveEvidenceContext(current, context);
    const gateExplanation = this.policyGates.explainGates(candidate);
    const policy = gateExplanation.verdict;
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = evidence.currentFrame
      ? scoreAttentionFrame(evidence.currentFrame, { now: candidate.timestamp })
      : null;
    const pressureForecast = evidence.pressureForecast;

    if (policy.autoApprove) {
      const reasons = [
        ...policy.rationale,
        "bounded approval work is auto-resolved instead of entering the attention surface",
      ];
      return {
        decision: {
          kind: "auto_approve",
          candidate,
          response: {
            taskId: candidate.taskId,
            interactionId: candidate.interactionId,
            response: { kind: "approved" },
          },
        },
        policy,
        policyGateEvaluations: gateExplanation.evaluations,
        utility,
        criterion: null,
        policyCriterionEvaluations: [],
        pressureForecast,
        attentionBurden: evidence.attentionBurden,
        candidateScore: utility.total,
        currentScore,
        currentPriority: null,
        ambiguity: null,
        reasons,
        continuityEvaluations: [],
      };
    }

    const criterionExplanation = this.policyGates.explainInterruptCriterion(
      candidate,
      policy,
      evidence,
      utility.total,
      currentScore,
      this.ambiguityDefaults !== undefined
        ? { ambiguityDefaults: this.ambiguityDefaults }
        : {},
    );
    const criterion = criterionExplanation.verdict;
    if (criterion.peripheralResolution) {
      const reasons = [
        ...policy.rationale,
        ...criterion.rationale,
      ];
      return {
        decision: {
          kind: criterion.peripheralResolution,
          candidate,
        },
        policy,
        policyGateEvaluations: gateExplanation.evaluations,
        utility,
        criterion,
        policyCriterionEvaluations: criterionExplanation.evaluations,
        pressureForecast,
        attentionBurden: evidence.attentionBurden,
        candidateScore: utility.total,
        currentScore,
        currentPriority: evidence.currentFrame ? priorityForFrame(evidence.currentFrame) : null,
        ambiguity: criterion.ambiguity,
        reasons,
        continuityEvaluations: [],
      };
    }

    const planning = this.queuePlanner.explain(evidence.currentFrame, candidate, {
      ...evidence,
      policyVerdict: policy,
      utility,
      pressureForecast,
      candidateScore: utility.total,
      currentScore,
    });

    return {
      decision: planning.decision,
      policy,
      policyGateEvaluations: gateExplanation.evaluations,
      utility,
      criterion,
      policyCriterionEvaluations: criterionExplanation.evaluations,
      pressureForecast,
      attentionBurden: evidence.attentionBurden,
      candidateScore: utility.total,
      currentScore: planning.currentScore,
      currentPriority: planning.currentPriority,
      ambiguity: null,
      reasons: planning.reasons,
      continuityEvaluations: planning.continuityEvaluations ?? [],
    };
  }

  clear(): AttentionDecision {
    return this.queuePlanner.clear();
  }

  private resolveEvidenceContext(
    current: AttentionFrame | null,
    context: AttentionDecisionContext,
  ): AttentionEvidenceContext {
    return resolveAttentionEvidenceContext(current, {
      ...(context.currentTaskView !== undefined ? { currentTaskView: context.currentTaskView } : {}),
      ...(context.currentEpisode !== undefined ? { currentEpisode: context.currentEpisode } : {}),
      ...(context.attentionView !== undefined ? { attentionView: context.attentionView } : {}),
      ...(context.taskSignalSummary !== undefined ? { taskSignalSummary: context.taskSignalSummary } : {}),
      ...(context.globalSignalSummary !== undefined ? { globalSignalSummary: context.globalSignalSummary } : {}),
      ...(context.taskAttentionState !== undefined ? { taskAttentionState: context.taskAttentionState } : {}),
      ...(context.globalAttentionState !== undefined ? { globalAttentionState: context.globalAttentionState } : {}),
      ...(context.pressureForecast !== undefined ? { pressureForecast: context.pressureForecast } : {}),
      ...(context.attentionBurden !== undefined ? { attentionBurden: context.attentionBurden } : {}),
      ...(context.surfaceCapabilities !== undefined ? { surfaceCapabilities: context.surfaceCapabilities } : {}),
      ...(context.operatorPresence !== undefined ? { operatorPresence: context.operatorPresence } : {}),
    });
  }
}
