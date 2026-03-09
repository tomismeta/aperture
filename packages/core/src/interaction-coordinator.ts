import type { Frame } from "./index.js";

import { isBlockingFrame, priorityForFrame, scoreCandidate, scoreFrame } from "./frame-score.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";

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
};

export class InteractionCoordinator {
  coordinate(current: Frame | null, candidate: InteractionCandidate): CoordinationDecision {
    return this.explain(current, candidate).decision;
  }

  explain(current: Frame | null, candidate: InteractionCandidate): CoordinationExplanation {
    if (!current) {
      return {
        decision: { kind: "activate", candidate },
        candidateScore: scoreCandidate(candidate),
        currentScore: null,
        currentPriority: null,
      };
    }

    if (current.interactionId === candidate.interactionId) {
      return {
        decision: { kind: "activate", candidate },
        candidateScore: scoreCandidate(candidate),
        currentScore: null,
        currentPriority: null,
      };
    }

    const currentBlocking = isBlockingFrame(current);
    if (currentBlocking && !candidate.blocking) {
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore: scoreCandidate(candidate),
        currentScore: null,
        currentPriority: null,
      };
    }

    if (!currentBlocking && candidate.blocking) {
      return {
        decision: { kind: "activate", candidate },
        candidateScore: scoreCandidate(candidate),
        currentScore: null,
        currentPriority: null,
      };
    }

    const currentPriority = priorityForFrame(current);
    const candidateScore = scoreCandidate(candidate);
    const currentScore = scoreFrame(current);

    if (candidateScore < currentScore) {
      return {
        decision:
          candidate.priority === "background"
            ? { kind: "ambient", candidate }
            : { kind: "queue", candidate },
        candidateScore,
        currentScore,
        currentPriority,
      };
    }

    if (candidateScore === currentScore) {
      const candidateTimestamp = Date.parse(candidate.timestamp);
      const currentTimestamp = Date.parse(current.timing.updatedAt);
      if (!Number.isNaN(candidateTimestamp) && !Number.isNaN(currentTimestamp) && candidateTimestamp < currentTimestamp) {
        return {
          decision:
            candidate.priority === "background"
              ? { kind: "ambient", candidate }
              : { kind: "queue", candidate },
          candidateScore,
          currentScore,
          currentPriority,
        };
      }
    }

    return {
      decision: { kind: "activate", candidate },
      candidateScore,
      currentScore,
      currentPriority,
    };
  }

  clear(): CoordinationDecision {
    return { kind: "clear" };
  }
}
