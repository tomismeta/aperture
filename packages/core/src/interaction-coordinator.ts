import type { AttentionView, Frame } from "./index.js";

import { scoreFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import { PolicyGates, type PolicyVerdict } from "./policy-gates.js";
import { forecastPressure, idlePressureForecast, type PressureForecast } from "./pressure-forecast.js";
import { QueuePlanner } from "./queue-planner.js";
import type { SignalSummary } from "./signal-summary.js";
import { UtilityScore, type UtilityBreakdown } from "./utility-score.js";

export type CoordinationDecision =
  | { kind: "activate"; candidate: InteractionCandidate }
  | { kind: "queue"; candidate: InteractionCandidate }
  | { kind: "ambient"; candidate: InteractionCandidate }
  | { kind: "keep"; frame: Frame | null }
  | { kind: "clear" };

export type CoordinationExplanation = {
  decision: CoordinationDecision;
  policy: PolicyVerdict;
  utility: UtilityBreakdown;
  pressureForecast: PressureForecast;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: InteractionPriority | null;
  reasons: string[];
};

export type CoordinationContext = {
  attentionView?: AttentionView;
  taskSummary?: SignalSummary;
  globalSummary?: SignalSummary;
  pressureForecast?: PressureForecast;
};

export class InteractionCoordinator {
  private readonly policyGates: PolicyGates;
  private readonly utilityScore: UtilityScore;
  private readonly queuePlanner: QueuePlanner;

  constructor(
    policyGates: PolicyGates = new PolicyGates(),
    utilityScore: UtilityScore = new UtilityScore(),
    queuePlanner: QueuePlanner = new QueuePlanner(),
  ) {
    this.policyGates = policyGates;
    this.utilityScore = utilityScore;
    this.queuePlanner = queuePlanner;
  }

  coordinate(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: CoordinationContext = {},
  ): CoordinationDecision {
    return this.explain(current, candidate, context).decision;
  }

  explain(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: CoordinationContext = {},
  ): CoordinationExplanation {
    const policy = this.policyGates.evaluate(candidate);
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = current ? scoreFrame(current, { now: candidate.timestamp }) : null;
    const pressureForecast =
      context.pressureForecast
      ?? forecastPressure(context.globalSummary ?? context.taskSummary, context.attentionView)
      ?? idlePressureForecast();
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

  clear(): CoordinationDecision {
    return this.queuePlanner.clear();
  }
}
