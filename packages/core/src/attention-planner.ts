import type { AttentionFrame, AttentionView } from "./frame.js";

import {
  buildAttentionEvidenceInput,
  resolveAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import type { PlannerDefaults } from "./policy-config.js";
import type { AttentionPolicyVerdict } from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import { type AttentionSurfaceCapabilities } from "./surface-capabilities.js";
import { parseTimestamp } from "./time.js";
import type { AttentionValueBreakdown } from "./attention-value.js";
import {
  batchedDecision,
  canRemainAmbientOnSurface,
  peripheralDecision,
  routeCandidate,
  selectPeripheralBucket,
} from "./attention-planner-routing.js";
import {
  noopContinuityRule,
  type ContinuityRule,
  type ContinuityRuleEvaluation,
} from "./continuity/continuity-rule.js";
import { evaluateBurstDampeningContinuityRule } from "./continuity/burst-dampening-continuity-rule.js";
import { evaluateConflictingInterruptContinuityRule } from "./continuity/conflicting-interrupt-continuity-rule.js";
import { evaluateContextPatienceContinuityRule } from "./continuity/context-patience-continuity-rule.js";
import { evaluateDecisionStreamContinuityRule } from "./continuity/decision-stream-continuity-rule.js";
import { evaluateDeferralEscalationContinuityRule } from "./continuity/deferral-escalation-continuity-rule.js";
import { evaluateMinimumDwellContinuityRule } from "./continuity/minimum-dwell-continuity-rule.js";
import { evaluateSameEpisodeContinuityRule } from "./continuity/same-episode-continuity-rule.js";
import { evaluateSameInteractionContinuityRule } from "./continuity/same-interaction-continuity-rule.js";
import { evaluateVisibleEpisodeContinuityRule } from "./continuity/visible-episode-continuity-rule.js";

export type AttentionPlanDecision =
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate }
  | { kind: "clear" };

export type AttentionPlanningExplanation = {
  decision: AttentionPlanDecision;
  currentPriority: AttentionPriority | null;
  currentScore: number | null;
  reasons: string[];
  continuityEvaluations?: ContinuityRuleEvaluation[];
};

export type AttentionPlanningContext = {
  attentionView?: AttentionView;
  policyVerdict: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  pressureForecast: AttentionPressure;
  candidateScore: number;
  currentScore: number | null;
  referenceTimestamp?: string;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
} & AttentionEvidenceInput;

const CONTINUITY_RULES: readonly ContinuityRule[] = [
  evaluateVisibleEpisodeContinuityRule,
  evaluateSameEpisodeContinuityRule,
  evaluateMinimumDwellContinuityRule,
  evaluateBurstDampeningContinuityRule,
  evaluateSameInteractionContinuityRule,
  evaluateDeferralEscalationContinuityRule,
  evaluateConflictingInterruptContinuityRule,
  evaluateDecisionStreamContinuityRule,
  evaluateContextPatienceContinuityRule,
];

type AttentionPlannerOptions = {
  plannerDefaults?: PlannerDefaults;
};

export class AttentionPlanner {
  private readonly plannerDefaults: PlannerDefaults | undefined;

  constructor(options: AttentionPlannerOptions = {}) {
    this.plannerDefaults = options.plannerDefaults;
  }

  explain(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    context: AttentionPlanningContext,
  ): AttentionPlanningExplanation {
    const referenceTimestamp = context.referenceTimestamp ?? candidate.timestamp;
    const evidence = this.resolveEvidenceContext(current, context, referenceTimestamp);
    const routing = routeCandidate(candidate, context, evidence, this.plannerDefaults);
    return this.applyContinuity(candidate, context, evidence, routing, referenceTimestamp);
  }

  clear(): AttentionPlanDecision {
    return { kind: "clear" };
  }

  preferredPeripheralBucket(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    surfaceCapabilities?: AttentionSurfaceCapabilities,
  ): "queue" | "ambient" {
    return selectPeripheralBucket(candidate, policyVerdict, surfaceCapabilities);
  }

  private applyContinuity(
    candidate: AttentionCandidate,
    context: AttentionPlanningContext,
    evidence: AttentionEvidenceContext,
    routed: AttentionPlanningExplanation,
    referenceTimestamp: string,
  ): AttentionPlanningExplanation {
    const disabledContinuityRules = new Set(this.plannerDefaults?.disabledContinuityRules ?? []);
    const continuityEvaluations = CONTINUITY_RULES.map((rule) => {
      const evaluation = rule({
        candidate,
        context,
        evidence,
        routed,
        referenceTimestamp,
        plannerDefaults: this.plannerDefaults,
        helpers: {
          peripheralDecision,
          batchedDecision,
        },
      });

      if (!disabledContinuityRules.has(evaluation.rule)) {
        return evaluation;
      }

      return noopContinuityRule(evaluation.rule, [
        `operator disabled the ${evaluation.rule} continuity rule`,
      ]);
    });
    const winningEvaluation = continuityEvaluations.find(
      (evaluation) => evaluation.kind === "override",
    );

    if (!winningEvaluation) {
      return {
        ...routed,
        continuityEvaluations,
      };
    }

    return {
      decision: winningEvaluation.decision,
      currentPriority: winningEvaluation.currentPriority,
      currentScore: winningEvaluation.currentScore,
      reasons: [...routed.reasons, ...winningEvaluation.rationale],
      continuityEvaluations,
    };
  }

  private resolveEvidenceContext(
    current: AttentionFrame | null,
    context: AttentionPlanningContext,
    referenceTimestamp: string,
  ): AttentionEvidenceContext {
    return resolveAttentionEvidenceContext(
      current,
      buildAttentionEvidenceInput(context),
      parseTimestamp(referenceTimestamp) ?? 0,
    );
  }
}

export { canRemainAmbientOnSurface, selectPeripheralBucket };
