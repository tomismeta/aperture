import type { AttentionView, Frame } from "./index.js";

import { readFrameEpisodeId } from "./episode-store.js";
import { isBlockingFrame, priorityForFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import type { PlannerDefaults } from "./judgment-config.js";
import type { PolicyVerdict } from "./policy-gates.js";
import type { PressureForecast } from "./pressure-forecast.js";
import type { SignalSummary } from "./signal-summary.js";
import type { UtilityBreakdown } from "./utility-score.js";

// These thresholds are intentionally conservative for v1 so reviewable policy
// still dominates. We can move them into JUDGMENT.md once real usage shows
// which ones operators actually want to tune.
const STATUS_BURST_WINDOW_MS = 60_000;
const URGENT_BACKLOG_WINDOW_MS = 90_000;
const DEFERRED_ESCALATION_THRESHOLD = 3;
const RETURNED_ESCALATION_THRESHOLD = 2;
const ESCALATION_SCORE_SLACK = 10;
const HIGH_CONTEXT_QUEUE_MARGIN = 8;
const MEDIUM_CONTEXT_QUEUE_MARGIN = 4;

export type PlannedDecision =
  | { kind: "activate"; candidate: InteractionCandidate }
  | { kind: "queue"; candidate: InteractionCandidate }
  | { kind: "ambient"; candidate: InteractionCandidate }
  | { kind: "keep"; frame: Frame | null }
  | { kind: "clear" };

export type PlanningExplanation = {
  decision: PlannedDecision;
  currentPriority: InteractionPriority | null;
  currentScore: number | null;
  reasons: string[];
};

export type QueuePlanningContext = {
  attentionView: AttentionView | undefined;
  taskSummary: SignalSummary | undefined;
  policyVerdict: PolicyVerdict;
  utility: UtilityBreakdown;
  pressureForecast: PressureForecast;
  candidateScore: number;
  currentScore: number | null;
};

type QueuePlannerOptions = {
  plannerDefaults?: PlannerDefaults;
};

export class QueuePlanner {
  private readonly plannerDefaults: PlannerDefaults | undefined;

  constructor(options: QueuePlannerOptions = {}) {
    this.plannerDefaults = options.plannerDefaults;
  }

  explain(
    current: Frame | null,
    candidate: InteractionCandidate,
    context: QueuePlanningContext,
  ): PlanningExplanation {
    const reasons: string[] = [];

    if (!current) {
      if (this.shouldPreemptForPressure(candidate, context.policyVerdict, context.pressureForecast)) {
        reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
        return {
          decision: this.suppressedDecision(candidate, context.policyVerdict, context.utility),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

      if (this.shouldBatchVisibleEpisode(candidate, context.attentionView)) {
        reasons.push("related episode work is already visible, so this interaction batches with it instead of interrupting");
        return {
          decision: this.batchedDecision(candidate, context.policyVerdict, context.attentionView),
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
    policyVerdict: PolicyVerdict,
  ): Extract<PlannedDecision, { kind: "queue" | "ambient" }> {
    if (policyVerdict.minimumPresentation === "ambient") {
      return { kind: "ambient", candidate };
    }

    return { kind: "queue", candidate };
  }

  private batchedDecision(
    candidate: InteractionCandidate,
    policyVerdict: PolicyVerdict,
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
    policyVerdict: PolicyVerdict,
    utility: UtilityBreakdown,
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
        return Number.isNaN(ageMs) ? true : ageMs <= URGENT_BACKLOG_WINDOW_MS;
      }).length;

    return urgentBacklog >= 2;
  }

  private shouldPreemptForPressure(
    candidate: InteractionCandidate,
    policyVerdict: PolicyVerdict,
    pressureForecast: PressureForecast,
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

    const repeatedlyDeferred = taskSummary.counts.deferred >= DEFERRED_ESCALATION_THRESHOLD;
    const repeatedlyReturned = taskSummary.counts.returned >= RETURNED_ESCALATION_THRESHOLD;

    if (!repeatedlyDeferred && !repeatedlyReturned) {
      return false;
    }

    return candidateScore >= currentScore - ESCALATION_SCORE_SLACK;
  }

  private shouldWaitForContext(
    current: Frame,
    candidate: InteractionCandidate,
    utility: UtilityBreakdown,
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
      return candidateScore < currentScore + HIGH_CONTEXT_QUEUE_MARGIN;
    }

    if (utility.components.contextCost <= -3) {
      return candidateScore < currentScore + MEDIUM_CONTEXT_QUEUE_MARGIN;
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

    return candidateTimestamp - currentTimestamp <= STATUS_BURST_WINDOW_MS;
  }
}
