import type { AttentionFrame, AttentionView } from "./frame.js";

import type { AttentionResponse } from "./frame-response.js";
import { priorityForFrame, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import { AttentionPolicy, type AttentionPolicyVerdict } from "./attention-policy.js";
import { forecastAttentionPressure, idleAttentionPressure, type AttentionPressure } from "./attention-pressure.js";
import { AttentionPlanner } from "./attention-planner.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import { AttentionValue, type AttentionValueBreakdown } from "./attention-value.js";
import type { AmbiguityDefaults } from "./judgment-config.js";

export type AttentionDecision =
  | { kind: "auto_approve"; candidate: AttentionCandidate; response: AttentionResponse }
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate }
  | { kind: "keep"; frame: AttentionFrame | null }
  | { kind: "clear" };

export type AttentionDecisionExplanation = {
  decision: AttentionDecision;
  policy: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  pressureForecast: AttentionPressure;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: AttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
};

export type AttentionDecisionAmbiguity = {
  kind: "interrupt";
  reason: "low_signal" | "small_score_gap";
  resolution: "queue" | "ambient";
};

export type AttentionDecisionContext = {
  attentionView?: AttentionView;
  taskSummary?: AttentionSignalSummary;
  globalSummary?: AttentionSignalSummary;
  pressureForecast?: AttentionPressure;
};

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
    const policy = this.policyGates.evaluate(candidate);
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = current ? scoreAttentionFrame(current, { now: candidate.timestamp }) : null;
    const pressureForecast =
      context.pressureForecast
      ?? forecastAttentionPressure(context.globalSummary ?? context.taskSummary, context.attentionView)
      ?? idleAttentionPressure();

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
        utility,
        pressureForecast,
        candidateScore: utility.total,
        currentScore,
        currentPriority: null,
        ambiguity: null,
        reasons,
      };
    }

    const ambiguityResolution = this.resolveInterruptAmbiguity(current, candidate, policy, utility.total, currentScore);
    if (ambiguityResolution) {
      const reasons = [
        ...policy.rationale,
        ambiguityResolution.reason,
      ];
      return {
        decision: ambiguityResolution.decision,
        policy,
        utility,
        pressureForecast,
        candidateScore: utility.total,
        currentScore,
        currentPriority: current ? priorityForFrame(current) : null,
        ambiguity: ambiguityResolution.ambiguity,
        reasons,
      };
    }

    const planning = this.queuePlanner.explain(current, candidate, {
      attentionView: context.attentionView,
      taskSummary: context.taskSummary,
      policyVerdict: policy,
      utility,
      pressureForecast,
      candidateScore: utility.total,
      currentScore,
    });

    return {
      decision: planning.decision,
      policy,
      utility,
      pressureForecast,
      candidateScore: utility.total,
      currentScore: planning.currentScore,
      currentPriority: planning.currentPriority,
      ambiguity: null,
      reasons: planning.reasons,
    };
  }

  clear(): AttentionDecision {
    return this.queuePlanner.clear();
  }

  private resolveInterruptAmbiguity(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    policy: AttentionPolicyVerdict,
    candidateScore: number,
    currentScore: number | null,
  ): {
    decision: Extract<AttentionDecision, { kind: "queue" | "ambient" }>;
    ambiguity: AttentionDecisionAmbiguity;
    reason: string;
  } | null {
    if (candidate.blocking || policy.autoApprove || !policy.mayInterrupt || policy.requiresOperatorResponse) {
      return null;
    }

    if (policy.minimumPresentation === "active") {
      return null;
    }

    const resolution = this.peripheralDecision(candidate, policy);
    if (!current) {
      const threshold =
        this.ambiguityDefaults?.nonBlockingActivationThreshold
        ?? JUDGMENT_DEFAULTS.ambiguity.nonBlockingActivationThreshold;
      if (candidateScore >= threshold) {
        return null;
      }

      return {
        decision: resolution,
        ambiguity: {
          kind: "interrupt",
          reason: "low_signal",
          resolution: resolution.kind,
        },
        reason: "uncertain interruptive work stays peripheral until its signal is stronger",
      };
    }

    if (currentScore === null || candidateScore <= currentScore) {
      return null;
    }

    const margin = this.ambiguityDefaults?.promotionMargin ?? JUDGMENT_DEFAULTS.ambiguity.promotionMargin;
    if (candidateScore >= currentScore + margin) {
      return null;
    }

    return {
      decision: resolution,
      ambiguity: {
        kind: "interrupt",
        reason: "small_score_gap",
        resolution: resolution.kind,
      },
      reason: "small score gaps resolve to the periphery instead of stealing focus immediately",
    };
  }

  private peripheralDecision(
    candidate: AttentionCandidate,
    policy: AttentionPolicyVerdict,
  ): Extract<AttentionDecision, { kind: "queue" | "ambient" }> {
    if (policy.minimumPresentation === "ambient") {
      return { kind: "ambient", candidate };
    }

    return { kind: "queue", candidate };
  }
}
