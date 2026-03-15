import type { AttentionFrame, AttentionView } from "./frame.js";

import {
  createAttentionEvidenceContext,
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
    const reasons: string[] = [];
    const actionableEpisode = this.isActionableEpisode(candidate);
    const activeFrame = evidence.currentFrame;

    if (!activeFrame) {
      if (this.shouldBatchVisibleEpisode(candidate, evidence.attentionView)) {
        reasons.push("related episode work is already visible, so this interaction batches with it instead of interrupting");
        return {
          decision: this.batchedDecision(
            candidate,
            context.policyVerdict,
            evidence.attentionView,
            evidence.surfaceCapabilities,
          ),
          currentPriority: null,
          currentScore: null,
          reasons,
        };
      }

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

    if (activeFrame.interactionId === candidate.interactionId) {
      reasons.push("same interaction refreshes the existing frame");
      return {
        decision: { kind: "activate", candidate },
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (this.shouldBatchVisibleEpisode(candidate, evidence.attentionView)) {
      reasons.push("related episode work is already building in the queue, so this interaction stays bundled with it");
      return {
        decision: this.batchedDecision(
          candidate,
          context.policyVerdict,
          evidence.attentionView,
          evidence.surfaceCapabilities,
        ),
        currentPriority: null,
        currentScore: context.currentScore,
        reasons,
      };
    }

    const currentBlocking = isBlockingFrame(activeFrame);
    const currentEpisodeId = readFrameEpisodeId(activeFrame);
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
        decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
        currentPriority: null,
        currentScore: null,
        reasons,
      };
    }

    if (actionableEpisode) {
      if (currentBlocking || evidence.pressureForecast.overloadRisk === "high") {
        reasons.push(
          currentBlocking
            ? "the episode has become actionable, but current blocking work keeps it queued"
            : "the episode has become actionable, but predicted overload keeps it queued",
        );
        return {
          decision: { kind: "queue", candidate },
          currentPriority: priorityForFrame(activeFrame),
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
          currentPriority: priorityForFrame(activeFrame),
          currentScore: context.currentScore,
          reasons,
        };
      }

      if (context.policyVerdict.mayInterrupt) {
        reasons.push("the episode has accumulated enough evidence to compete for current focus");
        return {
          decision: { kind: "activate", candidate },
          currentPriority: priorityForFrame(activeFrame),
          currentScore: context.currentScore,
          reasons,
        };
      }

      reasons.push("the episode has become actionable, so it stays queued even though policy still prevents interrupting");
      return {
        decision: { kind: "queue", candidate },
        currentPriority: priorityForFrame(activeFrame),
        currentScore: context.currentScore,
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

    const currentPriority = priorityForFrame(activeFrame);
    const currentScore = context.currentScore;

    if (this.shouldDampenBurst(activeFrame, candidate)) {
      reasons.push("rapid successive updates from the same task stay bundled instead of stealing focus");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
        currentPriority,
        currentScore,
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

    if (
      currentScore !== null &&
      this.shouldEscalateDeferredTask(
        activeFrame,
        candidate,
        context.candidateScore,
        currentScore,
        evidence.taskSignalSummary,
      )
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
      && this.shouldWaitForContext(activeFrame, candidate, context.utility, context.candidateScore, currentScore)
    ) {
      reasons.push("memory suggests this interaction usually needs context, so it stays peripheral until it clearly outranks current work");
      return {
        decision: this.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
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

  clear(): AttentionPlanDecision {
    return { kind: "clear" };
  }

  private peripheralDecision(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    surfaceCapabilities?: AttentionSurfaceCapabilities,
  ): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
    const capabilities = surfaceCapabilities ?? baseAttentionSurfaceCapabilities;
    if (policyVerdict.minimumPresentation === "ambient" && this.canRemainAmbient(candidate, capabilities)) {
      return { kind: "ambient", candidate };
    }

    return { kind: "queue", candidate };
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

  private canRemainAmbient(
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

  private shouldBatchVisibleEpisode(
    candidate: AttentionCandidate,
    attentionView: AttentionView | undefined,
  ): boolean {
    if (!candidate.episodeId || !attentionView) {
      return false;
    }

    if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    const visibleRelatedFrames = [attentionView.active, ...attentionView.queued, ...attentionView.ambient]
      .filter((frame): frame is AttentionFrame => frame !== null)
      .filter((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

    if (visibleRelatedFrames.length === 0) {
      return false;
    }

    return candidate.episodeState === "batched" || (candidate.episodeSize ?? 1) >= 2 || visibleRelatedFrames.length >= 2;
  }

  private shouldEscalateDeferredTask(
    current: AttentionFrame,
    candidate: AttentionCandidate,
    candidateScore: number,
    currentScore: number,
    taskSummary: AttentionSignalSummary | undefined,
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
    current: AttentionFrame,
    candidate: AttentionCandidate,
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

  private shouldDampenBurst(current: AttentionFrame, candidate: AttentionCandidate): boolean {
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

  private isActionableEpisode(candidate: AttentionCandidate): boolean {
    return (
      !candidate.blocking
      && candidate.episodeState === "actionable"
      && (candidate.episodeEvidenceScore ?? 0) >= DEFAULTS.actionableEpisodeEvidenceThreshold
    );
  }

  private resolveEvidenceContext(
    current: AttentionFrame | null,
    context: AttentionPlanningContext,
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

    return createAttentionEvidenceContext({
      currentFrame: current,
      ...(context.currentTaskView !== undefined ? { currentTaskView: context.currentTaskView } : {}),
      ...(context.currentEpisode !== undefined ? { currentEpisode: context.currentEpisode } : {}),
      ...(context.attentionView !== undefined ? { attentionView: context.attentionView } : {}),
      ...(context.taskSignalSummary !== undefined ? { taskSignalSummary: context.taskSignalSummary } : {}),
      ...(context.globalSignalSummary !== undefined ? { globalSignalSummary: context.globalSignalSummary } : {}),
      ...(context.taskAttentionState !== undefined ? { taskAttentionState: context.taskAttentionState } : {}),
      ...(context.globalAttentionState !== undefined ? { globalAttentionState: context.globalAttentionState } : {}),
      ...(context.pressureForecast !== undefined ? { pressureForecast: context.pressureForecast } : {}),
      ...(context.surfaceCapabilities !== undefined ? { surfaceCapabilities: context.surfaceCapabilities } : {}),
      ...(context.taskSummary !== undefined ? { taskSignalSummary: context.taskSummary } : {}),
    });
  }

  private isEvidenceContext(context: AttentionPlanningContext): context is AttentionPlanningContext & AttentionEvidenceContext {
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
      && "surfaceCapabilities" in context
    );
  }
}
