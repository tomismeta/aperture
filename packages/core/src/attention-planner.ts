import type { AttentionFrame as Frame, AttentionView } from "./frame.js";

import { readFrameEpisodeId } from "./episode-tracker.js";
import { isBlockingFrame, priorityForFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { PlannerDefaults } from "./judgment-config.js";
import type { AttentionPolicyVerdict } from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { SignalSummary } from "./signal-summary.js";
import type { AttentionValueBreakdown } from "./attention-value.js";

// These defaults intentionally stay conservative so explicit policy still
// dominates. We centralize them in one module to keep future tuning and
// JUDGMENT.md exposure reviewable.
const DEFAULTS = JUDGMENT_DEFAULTS.queuePlanner;

export type PlannedDecision =
  | { kind: "activate"; candidate: InteractionCandidate }
  | { kind: "queue"; candidate: InteractionCandidate }
  | { kind: "ambient"; candidate: InteractionCandidate }
  | { kind: "keep"; frame: Frame | null }
  | { kind: "clear" };

export type AttentionPlanningExplanation = {
  decision: PlannedDecision;
  currentPriority: InteractionPriority | null;
  currentScore: number | null;
  reasons: string[];
};

export type AttentionPlanningContext = {
  attentionView: AttentionView | undefined;
  taskSummary: SignalSummary | undefined;
  policyVerdict: AttentionPolicyVerdict;
  utility: AttentionValueBreakdown;
  pressureForecast: AttentionPressure;
  candidateScore: number;
  currentScore: number | null;
};

type AttentionPlannerOptions = {
  plannerDefaults?: PlannerDefaults;
};

export class AttentionPlanner {
  private readonly plannerDefaults: PlannerDefaults | undefined;

  constructor(options: AttentionPlannerOptions = {}) {
    this.plannerDefaults = options.plannerDefaults;
  }

  explain(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: AttentionPlanningContext,
  ): AttentionPlanningExplanation {
    const reasons: string[] = [];
    const actionableEpisode = this.isActionableEpisode(candidate);

    if (!current) {
      if (this.shouldBatchVisibleEpisode(candidate, context.attentionView)) {
        reasons.push("related episode work is already visible, so this interaction batches with it instead of interrupting");
        return {
          decision: this.batchedDecision(candidate, context.policyVerdict, context.attentionView),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      if (actionableEpisode) {
        if (context.pressureForecast.overloadRisk === "high") {
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

      if (this.shouldPreemptForPressure(candidate, context.policyVerdict, context.pressureForecast)) {
        reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
        return {
          decision: this.suppressedDecision(candidate, context.policyVerdict, context.utility),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      if (!context.policyVerdict.mayInterrupt && context.policyVerdict.minimumPresentation === "ambient") {
        reasons.push("policy keeps this interaction ambient until stronger context arrives");
        return {
          decision: { kind: "ambient", candidate },
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

    if (current.interactionId === candidate.interactionId) {
      reasons.push("same interaction refreshes the existing frame");
      return {
        decision: { kind: "activate", candidate },
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (this.shouldBatchVisibleEpisode(candidate, context.attentionView)) {
      reasons.push("related episode work is already building in the queue, so this interaction stays bundled with it");
      return {
        decision: this.batchedDecision(candidate, context.policyVerdict, context.attentionView),
        currentPriority: null,
        currentScore: context.currentScore,
        reasons,
      };
    }

    const currentBlocking = isBlockingFrame(current);
    const currentEpisodeId = readFrameEpisodeId(current);
    if (candidate.episodeId && currentEpisodeId && candidate.episodeId === currentEpisodeId) {
      if (candidate.blocking && !currentBlocking) {
        reasons.push("the active episode has progressed into an interruptive step");
        return {
          decision: { kind: "activate", candidate },
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      reasons.push("related work stays bundled with the active episode");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict),
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (actionableEpisode) {
      if (currentBlocking || context.pressureForecast.overloadRisk === "high") {
        reasons.push(
          currentBlocking
            ? "the episode has become actionable, but current blocking work keeps it queued"
            : "the episode has become actionable, but predicted overload keeps it queued",
        );
        return {
          decision: { kind: "queue", candidate },
          currentPriority: priorityForFrame(current),
          currentScore: context.currentScore,
          reasons,
        };
      }

      if (
        context.currentScore !== null
        && context.candidateScore < context.currentScore - DEFAULTS.actionableEpisodeScoreSlack
      ) {
        reasons.push("actionable episode evidence keeps this work visible even though the current frame is still stronger");
        return {
          decision: { kind: "queue", candidate },
          currentPriority: priorityForFrame(current),
          currentScore: context.currentScore,
          reasons,
        };
      }

      if (context.policyVerdict.mayInterrupt) {
        reasons.push("the episode has accumulated enough evidence to compete for current focus");
        return {
          decision: { kind: "activate", candidate },
          currentPriority: priorityForFrame(current),
          currentScore: context.currentScore,
          reasons,
        };
      }

      reasons.push("the episode has become actionable, so it stays queued even though policy still prevents interrupting");
      return {
        decision: { kind: "queue", candidate },
        currentPriority: priorityForFrame(current),
        currentScore: context.currentScore,
        reasons,
      };
    }

    if (currentBlocking && !candidate.blocking) {
      reasons.push("blocking work keeps non-blocking updates in the periphery");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict),
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

    const currentPriority = priorityForFrame(current);
    const currentScore = context.currentScore;

    if (this.shouldDampenBurst(current, candidate)) {
      reasons.push("rapid successive updates from the same task stay bundled instead of stealing focus");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict),
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (this.shouldPreemptForPressure(candidate, context.policyVerdict, context.pressureForecast)) {
      reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
      return {
        decision: this.suppressedDecision(candidate, context.policyVerdict, context.utility),
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (this.shouldSuppressForBacklog(candidate, context.attentionView, candidate.timestamp)) {
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

    if (
      currentScore !== null &&
      this.shouldEscalateDeferredTask(current, candidate, context.candidateScore, currentScore, context.taskSummary)
    ) {
      reasons.push("repeated deferral makes this task more deserving of current focus");
      return {
        decision: { kind: "activate", candidate },
        currentPriority,
        currentScore,
        reasons,
      };
    }

    if (
      currentScore !== null
      && this.shouldWaitForContext(current, candidate, context.utility, context.candidateScore, currentScore)
    ) {
      reasons.push("memory suggests this interaction usually needs context, so it stays peripheral until it clearly outranks current work");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict),
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
      const currentTimestamp = Date.parse(current.timing.updatedAt);
      if (!Number.isNaN(candidateTimestamp) && !Number.isNaN(currentTimestamp) && candidateTimestamp < currentTimestamp) {
        reasons.push("older work yields when scores tie");
        return {
          decision: this.peripheralDecision(candidate, context.policyVerdict),
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

  clear(): PlannedDecision {
    return { kind: "clear" };
  }

  private peripheralDecision(
    candidate: InteractionCandidate,
    policyVerdict: AttentionPolicyVerdict,
  ): Extract<PlannedDecision, { kind: "queue" | "ambient" }> {
    if (policyVerdict.minimumPresentation === "ambient") {
      return { kind: "ambient", candidate };
    }

    return { kind: "queue", candidate };
  }

  private batchedDecision(
    candidate: InteractionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    attentionView: AttentionView | undefined,
  ): Extract<PlannedDecision, { kind: "queue" | "ambient" }> {
    const episodeIsAlreadyInterruptive =
      candidate.episodeId !== undefined
      && [attentionView?.active, ...(attentionView?.queued ?? [])]
        .filter((frame): frame is Frame => frame !== null)
        .some((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (episodeIsAlreadyInterruptive) {
      return { kind: "queue", candidate };
    }

    return this.peripheralDecision(candidate, policyVerdict);
  }

  private suppressedDecision(
    candidate: InteractionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    utility: AttentionValueBreakdown,
  ): Extract<PlannedDecision, { kind: "queue" | "ambient" }> {
    if (
      (utility.components.deferralAffinity > 0 || utility.components.consequenceCalibration > 0)
      && policyVerdict.minimumPresentation !== "active"
    ) {
      return { kind: "queue", candidate };
    }

    return this.peripheralDecision(candidate, policyVerdict);
  }

  private shouldSuppressForBacklog(
    candidate: InteractionCandidate,
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
        .filter((frame): frame is Frame => frame !== null)
        .some((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (relatedEpisodeVisible) {
      return true;
    }

    const urgentBacklog = [attentionView.active, ...attentionView.queued]
      .filter((frame): frame is Frame => frame !== null)
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
    candidate: InteractionCandidate,
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

  private shouldBatchVisibleEpisode(
    candidate: InteractionCandidate,
    attentionView: AttentionView | undefined,
  ): boolean {
    if (!candidate.episodeId || !attentionView) {
      return false;
    }

    if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    const visibleRelatedFrames = [attentionView.active, ...attentionView.queued, ...attentionView.ambient]
      .filter((frame): frame is Frame => frame !== null)
      .filter((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (visibleRelatedFrames.length === 0) {
      return false;
    }

    return candidate.episodeState === "batched" || (candidate.episodeSize ?? 1) >= 2 || visibleRelatedFrames.length >= 2;
  }

  private shouldEscalateDeferredTask(
    current: Frame,
    candidate: InteractionCandidate,
    candidateScore: number,
    currentScore: number,
    taskSummary: SignalSummary | undefined,
  ): boolean {
    if (candidate.blocking || candidate.priority === "background") {
      return false;
    }

    if (isBlockingFrame(current)) {
      return false;
    }

    if (!taskSummary) {
      return false;
    }

    const repeatedlyDeferred = taskSummary.counts.deferred >= DEFAULTS.deferredEscalationThreshold;
    const repeatedlyReturned = taskSummary.counts.returned >= DEFAULTS.returnedEscalationThreshold;

    if (!repeatedlyDeferred && !repeatedlyReturned) {
      return false;
    }

    return candidateScore >= currentScore - DEFAULTS.escalationScoreSlack;
  }

  private shouldWaitForContext(
    current: Frame,
    candidate: InteractionCandidate,
    utility: AttentionValueBreakdown,
    candidateScore: number,
    currentScore: number,
  ): boolean {
    if (candidate.blocking || isBlockingFrame(current)) {
      return false;
    }

    if (candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    if (candidateScore <= currentScore) {
      return false;
    }

    if (utility.components.contextCost <= -6) {
      return candidateScore < currentScore + DEFAULTS.highContextQueueMargin;
    }

    if (utility.components.contextCost <= -3) {
      return candidateScore < currentScore + DEFAULTS.mediumContextQueueMargin;
    }

    return false;
  }

  private shouldDampenBurst(current: Frame, candidate: InteractionCandidate): boolean {
    if (this.plannerDefaults?.batchStatusBursts === false) {
      return false;
    }

    if (
      current.taskId !== candidate.taskId ||
      current.mode !== "status" ||
      candidate.mode !== "status" ||
      candidate.blocking ||
      candidate.consequence === "high" ||
      candidate.tone === "critical"
    ) {
      return false;
    }

    const currentTimestamp = Date.parse(current.timing.updatedAt);
    const candidateTimestamp = Date.parse(candidate.timestamp);
    if (Number.isNaN(currentTimestamp) || Number.isNaN(candidateTimestamp)) {
      return false;
    }

    return candidateTimestamp - currentTimestamp <= DEFAULTS.statusBurstWindowMs;
  }

  private isActionableEpisode(candidate: InteractionCandidate): boolean {
    return (
      !candidate.blocking
      && candidate.episodeState === "actionable"
      && (candidate.episodeEvidenceScore ?? 0) >= DEFAULTS.actionableEpisodeEvidenceThreshold
    );
  }
}
