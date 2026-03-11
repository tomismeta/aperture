import type { AttentionView, Frame } from "./index.js";

import { isBlockingFrame, priorityForFrame, scoreCandidate, scoreFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import type { SignalSummary } from "./signal-summary.js";

export type CoordinationDecision =
  | { kind: "activate"; candidate: InteractionCandidate }
  | { kind: "queue"; candidate: InteractionCandidate }
  | { kind: "ambient"; candidate: InteractionCandidate }
  | { kind: "keep"; frame: Frame | null }
  | { kind: "clear" };

export type CoordinationExplanation = {
  decision: CoordinationDecision;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: InteractionPriority | null;
  reasons: string[];
};

export type CoordinationContext = {
  attentionView?: AttentionView;
  taskSummary?: SignalSummary;
  globalSummary?: SignalSummary;
};

export class InteractionCoordinator {
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
    const reasons: string[] = [];
    const candidateScore = scoreCandidate(candidate);

    if (!current) {
      return {
        decision: { kind: "activate", candidate },
        candidateScore,
        currentScore: null,
        currentPriority: null,
        reasons,
      };
    }

    if (current.interactionId === candidate.interactionId) {
      reasons.push("same interaction refreshes the existing frame");
      return {
        decision: { kind: "activate", candidate },
        candidateScore,
        currentScore: null,
        currentPriority: null,
        reasons,
      };
    }

    const currentBlocking = isBlockingFrame(current);
    if (currentBlocking && !candidate.blocking) {
      reasons.push("blocking work keeps non-blocking updates in the periphery");
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore,
        currentScore: null,
        currentPriority: null,
        reasons,
      };
    }

    if (!currentBlocking && candidate.blocking) {
      reasons.push("blocking work interrupts non-blocking activity");
      return {
        decision: { kind: "activate", candidate },
        candidateScore,
        currentScore: null,
        currentPriority: null,
        reasons,
      };
    }

    const currentPriority = priorityForFrame(current);
    const currentScore = scoreFrame(current, { now: candidate.timestamp });

    if (this.shouldDampenBurst(current, candidate)) {
      reasons.push("rapid successive updates from the same task stay bundled instead of stealing focus");
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore,
        currentScore,
        currentPriority,
        reasons,
      };
    }

    if (this.shouldSuppressForBacklog(candidate, context.attentionView, candidate.timestamp)) {
      reasons.push("existing urgent backlog keeps lower-value status work queued");
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore,
        currentScore,
        currentPriority,
        reasons,
      };
    }

    if (this.shouldEscalateDeferredTask(current, candidate, candidateScore, currentScore, context.taskSummary)) {
      reasons.push("repeated deferral makes this task more deserving of current focus");
      return {
        decision: { kind: "activate", candidate },
        candidateScore,
        currentScore,
        currentPriority,
        reasons,
      };
    }

    if (candidateScore < currentScore) {
      reasons.push("current work still outranks the new candidate");
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore,
        currentScore,
        currentPriority,
        reasons,
      };
    }

    if (candidateScore === currentScore) {
      const candidateTimestamp = Date.parse(candidate.timestamp);
      const currentTimestamp = Date.parse(current.timing.updatedAt);
      if (!Number.isNaN(candidateTimestamp) && !Number.isNaN(currentTimestamp) && candidateTimestamp < currentTimestamp) {
        reasons.push("older work yields when scores tie");
        return {
          decision:
            candidate.priority === "background"
              ? { kind: "ambient", candidate }
              : { kind: "queue", candidate },
          candidateScore,
          currentScore,
          currentPriority,
          reasons,
        };
      }
    }

    reasons.push("new work outranks the current frame");
    return {
      decision: { kind: "activate", candidate },
      candidateScore,
      currentScore,
      currentPriority,
      reasons,
    };
  }

  clear(): CoordinationDecision {
    return { kind: "clear" };
  }

  private shouldSuppressForBacklog(
    candidate: InteractionCandidate,
    attentionView: AttentionView | undefined,
    now: string,
  ): boolean {
    if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
      return false;
    }

    if (!attentionView) {
      return false;
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
        return Number.isNaN(ageMs) ? true : ageMs <= 90_000;
      }).length;

    return urgentBacklog >= 2;
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

    const repeatedlyDeferred = taskSummary.counts.deferred >= 3;
    const repeatedlyReturned = taskSummary.counts.returned >= 2;

    if (!repeatedlyDeferred && !repeatedlyReturned) {
      return false;
    }

    return candidateScore >= currentScore - 10;
  }

  private shouldDampenBurst(current: Frame, candidate: InteractionCandidate): boolean {
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

    return candidateTimestamp - currentTimestamp <= 60_000;
  }
}
