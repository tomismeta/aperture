import type { AttentionFrame as Frame, AttentionView } from "./frame.js";

import type { FrameResponse } from "./frame-response.js";
import { scoreFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import { AttentionPolicy, type AttentionPolicyVerdict } from "./attention-policy.js";
import { forecastAttentionPressure, idleAttentionPressure, type AttentionPressure } from "./attention-pressure.js";
import { AttentionPlanner } from "./attention-planner.js";
import type { SignalSummary } from "./signal-summary.js";
import { AttentionValue, type AttentionValueBreakdown } from "./attention-value.js";

export type JudgmentDecision =
  | { kind: "auto_approve"; candidate: InteractionCandidate; response: FrameResponse }
  | { kind: "activate"; candidate: InteractionCandidate }
  | { kind: "queue"; candidate: InteractionCandidate }
  | { kind: "ambient"; candidate: InteractionCandidate }
  | { kind: "keep"; frame: Frame | null }
  | { kind: "clear" };

export type JudgmentExplanation = {
  decision: JudgmentDecision;
  policy: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  pressureForecast: AttentionPressure;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: InteractionPriority | null;
  reasons: string[];
};

export type JudgmentContext = {
  attentionView?: AttentionView;
  taskSummary?: SignalSummary;
  globalSummary?: SignalSummary;
  pressureForecast?: AttentionPressure;
};

export class JudgmentCoordinator {
  private readonly policyGates: AttentionPolicy;
  private readonly utilityScore: AttentionValue;
  private readonly queuePlanner: AttentionPlanner;

  constructor(
    policyGates: AttentionPolicy = new AttentionPolicy(),
    utilityScore: AttentionValue = new AttentionValue(),
    queuePlanner: AttentionPlanner = new AttentionPlanner(),
  ) {
    this.policyGates = policyGates;
    this.utilityScore = utilityScore;
    this.queuePlanner = queuePlanner;
  }

  coordinate(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: JudgmentContext = {},
  ): JudgmentDecision {
    return this.explain(current, candidate, context).decision;
  }

  explain(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: JudgmentContext = {},
  ): JudgmentExplanation {
    const policy = this.policyGates.evaluate(candidate);
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = current ? scoreFrame(current, { now: candidate.timestamp }) : null;
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
      reasons: planning.reasons,
    };
  }

  clear(): JudgmentDecision {
    return this.queuePlanner.clear();
  }
}
