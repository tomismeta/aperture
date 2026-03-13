import type { Frame } from "./index.js";

import { deriveAttentionState } from "./attention-state.js";
import { deriveAttentionTrends } from "./attention-trends.js";
import type { InteractionCandidate } from "./interaction-candidate.js";
import type { SignalSummary } from "./signal-summary.js";

export class AttentionAdjustments {
  apply(
    candidate: InteractionCandidate,
    taskSummary: SignalSummary,
    globalSummary: SignalSummary = taskSummary,
  ): InteractionCandidate {
    const attentionScoreOffset = this.scoreOffset(candidate, taskSummary, globalSummary);
    const attentionRationale = this.rationale(candidate, taskSummary, globalSummary, attentionScoreOffset);

    return {
      ...candidate,
      ...(attentionScoreOffset !== 0 ? { attentionScoreOffset } : {}),
      ...(attentionRationale.length > 0 ? { attentionRationale } : {}),
    };
  }

  private scoreOffset(
    candidate: InteractionCandidate,
    taskSummary: SignalSummary,
    globalSummary: SignalSummary,
  ): number {
    let offset = 0;
    const attentionState = deriveAttentionState(taskSummary);
    const globalAttentionState = deriveAttentionState(globalSummary);
    const taskTrends = deriveAttentionTrends(taskSummary);
    const globalTrends = deriveAttentionTrends(globalSummary);

    if (candidate.mode === "status") {
      const isHighConsequenceStatus = candidate.consequence === "high" || candidate.tone === "critical";

      if (taskSummary.dismissalRate >= 0.5) {
        offset -= 15;
      }

      if (taskSummary.deferred.suppressed >= 2) {
        offset -= 10;
      }

      if (isHighConsequenceStatus) {
        offset += 20;
      }

      if (!isHighConsequenceStatus && attentionState === "overloaded") {
        offset -= 10;
      }

      if (!isHighConsequenceStatus && attentionState === "avoiding") {
        offset -= 10;
      }

      if (!isHighConsequenceStatus && attentionState !== "overloaded" && globalAttentionState === "overloaded") {
        offset -= 5;
      }

      if (!isHighConsequenceStatus && globalTrends.includes("fragmented_attention")) {
        offset -= 5;
      }
    }

    if (candidate.blocking && taskSummary.counts.contextExpanded >= 2) {
      offset += 10;
    }

    if (candidate.blocking && taskSummary.responseRate >= 0.75 && taskSummary.averageResponseLatencyMs !== null) {
      if (taskSummary.averageResponseLatencyMs <= 10_000) {
        offset += 5;
      }
    }

    if (candidate.blocking && attentionState === "hesitating") {
      offset += 5;
    }

    if (candidate.blocking && taskTrends.includes("defer_then_return")) {
      offset += 5;
    }

    return offset;
  }

  private rationale(
    candidate: InteractionCandidate,
    taskSummary: SignalSummary,
    globalSummary: SignalSummary,
    attentionScoreOffset: number,
  ): string[] {
    const reasons: string[] = [];
    const attentionState = deriveAttentionState(taskSummary);
    const globalAttentionState = deriveAttentionState(globalSummary);
    const taskTrends = deriveAttentionTrends(taskSummary);
    const globalTrends = deriveAttentionTrends(globalSummary);

    if (candidate.mode === "status" && taskSummary.dismissalRate >= 0.5) {
      reasons.push("status updates for this task are often dismissed");
    }

    if (candidate.mode === "status" && taskSummary.deferred.suppressed >= 2) {
      reasons.push("similar task updates have repeatedly remained ambient");
    }

    if (candidate.mode === "status" && (candidate.consequence === "high" || candidate.tone === "critical")) {
      reasons.push("high-consequence status should remain more visible");
    }

    if (
      candidate.mode === "status" &&
      candidate.consequence !== "high" &&
      candidate.tone !== "critical" &&
      attentionState === "overloaded"
    ) {
      reasons.push("recent task activity suggests attention is already saturated");
    }

    if (
      candidate.mode === "status" &&
      candidate.consequence !== "high" &&
      candidate.tone !== "critical" &&
      attentionState === "avoiding"
    ) {
      reasons.push("recent behavior suggests low-value updates should stay quiet");
    }

    if (
      candidate.mode === "status" &&
      candidate.consequence !== "high" &&
      candidate.tone !== "critical" &&
      attentionState !== "overloaded" &&
      globalAttentionState === "overloaded"
    ) {
      reasons.push("overall operator activity suggests attention is already saturated");
    }

    if (
      candidate.mode === "status" &&
      candidate.consequence !== "high" &&
      candidate.tone !== "critical" &&
      globalTrends.includes("fragmented_attention")
    ) {
      reasons.push("recent attention has already shifted repeatedly across work");
    }

    if (candidate.blocking && taskSummary.counts.contextExpanded >= 2) {
      reasons.push("this task often requires deeper context before action");
    }

    if (
      candidate.blocking &&
      taskSummary.responseRate >= 0.75 &&
      taskSummary.averageResponseLatencyMs !== null &&
      taskSummary.averageResponseLatencyMs <= 10_000
    ) {
      reasons.push("similar blocking interactions usually receive quick responses");
    }

    if (candidate.blocking && attentionState === "hesitating") {
      reasons.push("similar blocking interactions appear to require more deliberation");
    }

    if (candidate.blocking && taskTrends.includes("defer_then_return")) {
      reasons.push("similar interactions are often deferred and resumed later");
    }

    if (attentionScoreOffset === 0) {
      return [];
    }

    return reasons;
  }

  readFrameOffset(frame: Frame): number {
    const attention = frame.metadata?.attention;
    if (
      attention &&
      typeof attention === "object" &&
      "scoreOffset" in attention &&
      typeof attention.scoreOffset === "number"
    ) {
      return attention.scoreOffset;
    }

    return 0;
  }
}
