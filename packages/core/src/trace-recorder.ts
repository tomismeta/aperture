import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionView, Frame, TaskView } from "./frame.js";
import type { JudgmentExplanation } from "./judgment-coordinator.js";
import type { InteractionCandidate } from "./interaction-candidate.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { SignalSummary } from "./signal-summary.js";
import type { ApertureTrace } from "./trace.js";

export type TraceSnapshot = {
  timestamp: string;
  event: ApertureEvent;
  taskSummary: SignalSummary;
  globalSummary: SignalSummary;
  taskAttentionState: AttentionState;
  globalAttentionState: AttentionState;
  pressureForecast: AttentionPressure;
  current: Frame | null;
  taskView: TaskView;
  attentionView: AttentionView;
};

type CandidateTraceInput = {
  original: InteractionCandidate;
  adjusted: InteractionCandidate;
  explanation: JudgmentExplanation;
  result: Frame | null;
};

export class TraceRecorder {
  recordNoop(snapshot: TraceSnapshot): ApertureTrace {
    return {
      ...snapshot,
      evaluation: { kind: "noop" },
    };
  }

  recordClear(snapshot: TraceSnapshot, taskId: string): ApertureTrace {
    return {
      ...snapshot,
      evaluation: { kind: "clear", taskId },
    };
  }

  recordCandidate(snapshot: TraceSnapshot, input: CandidateTraceInput): ApertureTrace {
    const { original, adjusted, explanation, result } = input;

    return {
      ...snapshot,
      evaluation: {
        kind: "candidate",
        original,
        adjusted,
      },
      heuristics: {
        scoreOffset: adjusted.attentionScoreOffset ?? 0,
        rationale: adjusted.attentionRationale ?? [],
      },
      episode: buildEpisodeSummary(adjusted),
      policy: explanation.policy,
      utility: {
        candidate: explanation.utility,
        currentScore: explanation.currentScore,
        currentPriority: explanation.currentPriority,
      },
      planner: {
        kind: explanation.decision.kind,
        reasons: explanation.reasons,
      },
      coordination: {
        kind: explanation.decision.kind,
        candidateScore: explanation.candidateScore,
        currentScore: explanation.currentScore,
        currentPriority: explanation.currentPriority,
        reasons: explanation.reasons,
      },
      pressureForecast: explanation.pressureForecast,
      result,
    };
  }
}

function buildEpisodeSummary(candidate: InteractionCandidate): EpisodeSummary | null {
  if (!candidate.episodeId) {
    return null;
  }

  return {
    id: candidate.episodeId,
    key: candidate.episodeKey ?? candidate.episodeId,
    state: candidate.episodeState ?? "emerging",
    size: candidate.episodeSize ?? 1,
    evidenceScore: candidate.episodeEvidenceScore ?? 0,
    evidenceReasons: candidate.episodeEvidenceReasons ?? [],
    lastInteractionId: candidate.interactionId,
    updatedAt: candidate.timestamp,
  };
}
