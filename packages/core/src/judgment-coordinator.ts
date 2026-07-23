import type { AttentionFrame } from "./frame.js";

import { AttentionEvaluator, type AttentionDecisionContext } from "./attention-evaluator.js";
import { AttentionPlanner } from "./attention-planner.js";
import { AttentionPolicy } from "./attention-policy.js";
import { AttentionValue } from "./attention-value.js";
import type {
  AttentionDecision,
  AttentionDecisionExplanation,
} from "./attention-decision-record.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AmbiguityDefaults } from "./policy-config.js";

export type {
  AttentionDecision,
  AttentionDecisionExplanation,
  AttentionDecisionPlannedLane,
  AttentionDecisionReasonCode,
  AttentionDecisionRecord,
} from "./attention-decision-record.js";
export type { AttentionDecisionContext } from "./attention-evaluator.js";

type JudgmentCoordinatorOptions = {
  ambiguityDefaults?: AmbiguityDefaults;
};

export class JudgmentCoordinator {
  private readonly evaluator: AttentionEvaluator;

  constructor(
    policyGates: AttentionPolicy = new AttentionPolicy(),
    utilityScore: AttentionValue = new AttentionValue(),
    queuePlanner: AttentionPlanner = new AttentionPlanner(),
    options: JudgmentCoordinatorOptions = {},
  ) {
    this.evaluator = new AttentionEvaluator(policyGates, utilityScore, queuePlanner, options);
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
    return this.evaluator.explain({
      current,
      candidate,
      context,
      evaluatedAt: candidate.timestamp,
    });
  }

  clear(): AttentionDecision {
    return this.evaluator.clear();
  }
}
