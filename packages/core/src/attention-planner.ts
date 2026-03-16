import type { AttentionFrame, AttentionView } from "./frame.js";

import {
  resolveAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import { readFrameEpisodeId } from "./episode-tracker.js";
import { isBlockingFrame, priorityForFrame } from "./frame-score.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { PlannerDefaults } from "./judgment-config.js";
import type { AttentionPolicyVerdict } from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
import type { AttentionValueBreakdown } from "./attention-value.js";
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

// These defaults intentionally stay conservative so explicit policy still
// dominates. We centralize them in one module to keep future tuning and
// JUDGMENT.md exposure reviewable.
const DEFAULTS = JUDGMENT_DEFAULTS.queuePlanner;

export type AttentionPlanDecision =
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate }
  | { kind: "keep"; frame: AttentionFrame | null }
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
  taskSummary?: AttentionSignalSummary;
  policyVerdict: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  pressureForecast: AttentionPressure;
  candidateScore: number;
  currentScore: number | null;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
} & AttentionEvidenceInput;

const CONTINUITY_RULES: readonly ContinuityRule[] = [
  evaluateSameInteractionContinuityRule,
  evaluateVisibleEpisodeContinuityRule,
  evaluateSameEpisodeContinuityRule,
  evaluateMinimumDwellContinuityRule,
  evaluateBurstDampeningContinuityRule,
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
    const evidence = this.resolveEvidenceContext(current, context);
    const routing = this.route(candidate, context, evidence);
    return this.applyContinuity(candidate, context, evidence, routing);
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

  private peripheralDecision(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    surfaceCapabilities?: AttentionSurfaceCapabilities,
  ): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
    return {
      kind: this.preferredPeripheralBucket(candidate, policyVerdict, surfaceCapabilities),
      candidate,
    };
  }

  private batchedDecision(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    attentionView: AttentionView | undefined,
    surfaceCapabilities?: AttentionSurfaceCapabilities,
  ): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
    const episodeIsAlreadyInterruptive =
      candidate.episodeId !== undefined
      && [attentionView?.active, ...(attentionView?.queued ?? [])]
        .filter((frame): frame is AttentionFrame => frame !== null)
        .some((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (episodeIsAlreadyInterruptive) {
      return { kind: "queue", candidate };
    }

    return this.peripheralDecision(candidate, policyVerdict, surfaceCapabilities);
  }

  private suppressedDecision(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    utility: AttentionValueBreakdown,
    surfaceCapabilities?: AttentionSurfaceCapabilities,
  ): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
    if (
      (utility.components.deferralAffinity > 0 || utility.components.consequenceCalibration > 0)
      && policyVerdict.minimumPresentation !== "active"
    ) {
      return { kind: "queue", candidate };
    }

    return this.peripheralDecision(candidate, policyVerdict, surfaceCapabilities);
  }

  private shouldSuppressForBacklog(
    candidate: AttentionCandidate,
    attentionView: AttentionView | undefined,
    now: string,
  ): boolean {
    if (this.plannerDefaults?.deferLowValueDuringPressure === false) {
      return false;
    }

    if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    if (!attentionView) {
      return false;
    }

    const relatedEpisodeVisible =
      candidate.episodeId !== undefined
      && [attentionView.active, ...attentionView.queued]
        .filter((frame): frame is AttentionFrame => frame !== null)
        .some((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (relatedEpisodeVisible) {
      return true;
    }

    const urgentBacklog = [attentionView.active, ...attentionView.queued]
      .filter((frame): frame is AttentionFrame => frame !== null)
      .filter((frame) => {
        if (frame.interactionId === candidate.interactionId) {
          return false;
        }
        return isBlockingFrame(frame) || frame.consequence === "high" || frame.tone === "critical";
      })
      .filter((frame) => {
        const ageMs = Date.parse(now) - Date.parse(frame.timing.updatedAt);
        return Number.isNaN(ageMs) ? true : ageMs <= DEFAULTS.urgentBacklogWindowMs;
      }).length;

    return urgentBacklog >= 2;
  }

  private shouldPreemptForPressure(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    pressureForecast: AttentionPressure,
  ): boolean {
    if (pressureForecast.overloadRisk === "low") {
      return false;
    }

    if (candidate.blocking || policyVerdict.requiresOperatorResponse || policyVerdict.minimumPresentation === "active") {
      return false;
    }

    if (candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    if (pressureForecast.overloadRisk === "high") {
      return true;
    }

    return (
      candidate.mode === "status"
      || candidate.priority === "background"
      || candidate.consequence === "low"
    );
  }

  private isActionableEpisode(candidate: AttentionCandidate): boolean {
    return (
      !candidate.blocking
      && candidate.episodeState === "actionable"
      && (candidate.episodeEvidenceScore ?? 0) >= DEFAULTS.actionableEpisodeEvidenceThreshold
    );
  }

  private route(
    candidate: AttentionCandidate,
    context: AttentionPlanningContext,
    evidence: AttentionEvidenceContext,
  ): AttentionPlanningExplanation {
    const reasons: string[] = [];
    const actionableEpisode = this.isActionableEpisode(candidate);
    const activeFrame = evidence.currentFrame;

    if (!activeFrame) {
      if (actionableEpisode) {
        if (evidence.pressureForecast.overloadRisk === "high") {
          reasons.push("the episode has become actionable, but predicted overload keeps it queued instead of interrupting");
          return {
            decision: { kind: "queue", candidate },
            currentPriority: null,
            currentScore: null,
            reasons,
          };
        }

        if (context.policyVerdict.mayInterrupt) {
          reasons.push("the episode has accumulated enough evidence to deserve interruptive attention");
          return {
            decision: { kind: "activate", candidate },
            currentPriority: null,
            currentScore: null,
            reasons,
          };
        }

        reasons.push("the episode has become actionable, so it stays visible even though policy still prevents interrupting");
        return {
          decision: { kind: "queue", candidate },
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      if (this.shouldPreemptForPressure(candidate, context.policyVerdict, evidence.pressureForecast)) {
        reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
        return {
          decision: this.suppressedDecision(
            candidate,
            context.policyVerdict,
            context.utility,
            evidence.surfaceCapabilities,
          ),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      if (!context.policyVerdict.mayInterrupt && context.policyVerdict.minimumPresentation === "ambient") {
        reasons.push("policy keeps this interaction ambient until stronger context arrives");
        return {
          decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      reasons.push("no current frame is active for this task");
      return {
        decision: { kind: "activate", candidate },
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    const currentBlocking = isBlockingFrame(activeFrame);
    const currentPriority = priorityForFrame(activeFrame);
    const currentScore = context.currentScore;

    if (actionableEpisode) {
      if (currentBlocking || evidence.pressureForecast.overloadRisk === "high") {
        reasons.push(
          currentBlocking
            ? "the episode has become actionable, but current blocking work keeps it queued"
            : "the episode has become actionable, but predicted overload keeps it queued",
        );
        return {
          decision: { kind: "queue", candidate },
          currentPriority,
          currentScore,
          reasons,
        };
      }

      if (
        currentScore !== null
        && context.candidateScore < currentScore - DEFAULTS.actionableEpisodeScoreSlack
      ) {
        reasons.push("actionable episode evidence keeps this work visible even though the current frame is still stronger");
        return {
          decision: { kind: "queue", candidate },
          currentPriority,
          currentScore,
          reasons,
        };
      }

      if (context.policyVerdict.mayInterrupt) {
        reasons.push("the episode has accumulated enough evidence to compete for current focus");
        return {
          decision: { kind: "activate", candidate },
          currentPriority,
          currentScore,
          reasons,
        };
      }

      reasons.push("the episode has become actionable, so it stays queued even though policy still prevents interrupting");
      return {
        decision: { kind: "queue", candidate },
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (currentBlocking && !candidate.blocking) {
      reasons.push("blocking work keeps non-blocking updates in the periphery");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (!currentBlocking && candidate.blocking) {
      reasons.push("blocking work interrupts non-blocking activity");
      return {
        decision: { kind: "activate", candidate },
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (this.shouldPreemptForPressure(candidate, context.policyVerdict, evidence.pressureForecast)) {
      reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
      return {
        decision: this.suppressedDecision(candidate, context.policyVerdict, context.utility),
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (this.shouldSuppressForBacklog(candidate, evidence.attentionView, candidate.timestamp)) {
      reasons.push(
        context.utility.components.deferralAffinity > 0
          ? "existing urgent backlog defers this work, but memory keeps it queued because it usually returns after deferral"
          : "existing urgent backlog keeps lower-value status work queued",
      );
      return {
        decision: this.suppressedDecision(candidate, context.policyVerdict, context.utility),
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (currentScore !== null && context.candidateScore < currentScore) {
      reasons.push("current work still outranks the new candidate");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict),
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (currentScore !== null && context.candidateScore === currentScore) {
      const candidateTimestamp = Date.parse(candidate.timestamp);
      const currentTimestamp = Date.parse(activeFrame.timing.updatedAt);
      if (!Number.isNaN(candidateTimestamp) && !Number.isNaN(currentTimestamp) && candidateTimestamp < currentTimestamp) {
        reasons.push("older work yields when scores tie");
        return {
          decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
          currentPriority,
          currentScore,
          reasons,
        };
      }
    }

    reasons.push("new work outranks the current frame");
    return {
      decision: { kind: "activate", candidate },
      currentPriority,
      currentScore,
      reasons,
    };
  }

  private applyContinuity(
    candidate: AttentionCandidate,
    context: AttentionPlanningContext,
    evidence: AttentionEvidenceContext,
    routed: AttentionPlanningExplanation,
  ): AttentionPlanningExplanation {
    const disabledContinuityRules = new Set(this.plannerDefaults?.disabledContinuityRules ?? []);
    const continuityEvaluations = CONTINUITY_RULES
      .map((rule) => {
        const evaluation = rule({
          candidate,
          context,
          evidence,
          routed,
          plannerDefaults: this.plannerDefaults,
          helpers: {
            peripheralDecision: this.peripheralDecision.bind(this),
            batchedDecision: this.batchedDecision.bind(this),
          },
        });

        if (!disabledContinuityRules.has(evaluation.rule)) {
          return evaluation;
        }

        return noopContinuityRule(
          evaluation.rule,
          [`operator disabled the ${evaluation.rule} continuity rule`],
        );
      });
    const winningEvaluation = continuityEvaluations.find((evaluation) => evaluation.kind === "override");

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
      ...(context.taskSummary !== undefined ? { taskSignalSummary: context.taskSummary } : {}),
    });
  }
}

export function selectPeripheralBucket(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  surfaceCapabilities: AttentionSurfaceCapabilities = baseAttentionSurfaceCapabilities,
): "queue" | "ambient" {
  if (policyVerdict.minimumPresentation === "ambient" && canRemainAmbientOnSurface(candidate, surfaceCapabilities)) {
    return "ambient";
  }

  return "queue";
}

export function canRemainAmbientOnSurface(
  candidate: AttentionCandidate,
  surfaceCapabilities: AttentionSurfaceCapabilities,
): boolean {
  if (!surfaceCapabilities.topology.supportsAmbient) {
    return false;
  }

  switch (candidate.responseSpec.kind) {
    case "approval":
      return true;
    case "choice":
      return (
        (candidate.responseSpec.selectionMode === "multiple"
          ? surfaceCapabilities.responses.supportsMultipleChoice
          : surfaceCapabilities.responses.supportsSingleChoice)
        && (!candidate.responseSpec.allowTextResponse || surfaceCapabilities.responses.supportsTextResponse)
      );
    case "form":
      return surfaceCapabilities.responses.supportsForm;
    case "none":
      return true;
  }

  return false;
}
