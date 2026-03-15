import type { AttentionFrame, AttentionView } from "./frame.js";

import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import { deriveAttentionBurden, type AttentionBurden } from "./attention-burden.js";
import type { AttentionResponse } from "./frame-response.js";
import { priorityForFrame, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import {
  createAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import {
  AttentionPolicy,
  type AttentionInterruptCriterionVerdict,
  type AttentionPolicyVerdict,
} from "./attention-policy.js";
import { forecastAttentionPressure, idleAttentionPressure, type AttentionPressure } from "./attention-pressure.js";
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
  | { kind: "keep"; frame: AttentionFrame | null }
  | { kind: "clear" };

export type AttentionDecisionExplanation = {
  decision: AttentionDecision;
  policy: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: AttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  continuityEvaluations: ContinuityRuleEvaluation[];
};

type LegacyAttentionDecisionContext = {
  attentionView?: AttentionView;
  taskSummary?: AttentionSignalSummary;
  globalSummary?: AttentionSignalSummary;
  pressureForecast?: AttentionPressure;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
} & AttentionEvidenceInput;

export type AttentionDecisionContext = AttentionEvidenceContext | LegacyAttentionDecisionContext;

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
    const policy = this.policyGates.evaluateGates(candidate);
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
        utility,
        criterion: null,
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

    const criterion = this.policyGates.evaluateInterruptCriterion(
      candidate,
      policy,
      evidence,
      utility.total,
      currentScore,
      this.ambiguityDefaults !== undefined
        ? { ambiguityDefaults: this.ambiguityDefaults }
        : {},
    );
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
        utility,
        criterion,
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
      utility,
      criterion,
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
    if (this.isEvidenceContext(context)) {
      if (context.currentFrame === current) {
        return context;
      }

      return createAttentionEvidenceContext({
        ...context,
        currentFrame: current,
      });
    }

    const attentionView = context.attentionView;
    const taskSignalSummary = context.taskSignalSummary ?? context.taskSummary;
    const globalSignalSummary = context.globalSignalSummary ?? context.globalSummary;
    const pressureForecast =
      context.pressureForecast
      ?? forecastAttentionPressure(globalSignalSummary ?? idleAttentionSummary(), attentionView)
      ?? idleAttentionPressure();
    const operatorPresence = context.operatorPresence ?? "present";
    const attentionBurden = context.attentionBurden
      ?? deriveAttentionBurden(
        globalSignalSummary ?? idleAttentionSummary(),
        pressureForecast,
        context.globalAttentionState,
        operatorPresence,
      );

    return createAttentionEvidenceContext({
      currentFrame: current,
      ...(context.currentTaskView !== undefined ? { currentTaskView: context.currentTaskView } : {}),
      ...(context.currentEpisode !== undefined ? { currentEpisode: context.currentEpisode } : {}),
      ...(attentionView !== undefined ? { attentionView } : {}),
      ...(taskSignalSummary !== undefined ? { taskSignalSummary } : {}),
      ...(globalSignalSummary !== undefined ? { globalSignalSummary } : {}),
      ...(context.taskAttentionState !== undefined ? { taskAttentionState: context.taskAttentionState } : {}),
      ...(context.globalAttentionState !== undefined ? { globalAttentionState: context.globalAttentionState } : {}),
      attentionBurden,
      ...(context.surfaceCapabilities !== undefined ? { surfaceCapabilities: context.surfaceCapabilities } : {}),
      operatorPresence,
      pressureForecast,
    });
  }

  private isEvidenceContext(context: AttentionDecisionContext): context is AttentionEvidenceContext {
    return (
      "currentFrame" in context
      && "currentTaskView" in context
      && "currentEpisode" in context
      && "attentionView" in context
      && "taskSignalSummary" in context
      && "globalSignalSummary" in context
      && "taskAttentionState" in context
      && "globalAttentionState" in context
      && "pressureForecast" in context
      && "attentionBurden" in context
      && "surfaceCapabilities" in context
      && "operatorPresence" in context
    );
  }
}

function idleAttentionSummary(): AttentionSignalSummary {
  return {
    recentSignals: 0,
    lifetimeSignals: 0,
    counts: {
      presented: 0,
      viewed: 0,
      responded: 0,
      dismissed: 0,
      deferred: 0,
      contextExpanded: 0,
      contextSkipped: 0,
      timedOut: 0,
      returned: 0,
      attentionShifted: 0,
    },
    deferred: {
      queued: 0,
      suppressed: 0,
      manual: 0,
    },
    responseRate: 0,
    dismissalRate: 0,
    averageResponseLatencyMs: null,
    averageDismissalLatencyMs: null,
    lastSignalAt: null,
  };
}
