import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { ApertureTrace } from "./trace.js";

export type TraceSnapshot = {
  timestamp: string;
  event: ApertureEvent;
  taskSummary: AttentionSignalSummary;
  globalSummary: AttentionSignalSummary;
  taskAttentionState: AttentionState;
  globalAttentionState: AttentionState;
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  current: AttentionFrame | null;
  taskView: AttentionTaskView;
  attentionView: AttentionView;
};

type CandidateTraceInput = {
  original: AttentionCandidate;
  adjusted: AttentionCandidate;
  explanation: AttentionDecisionExplanation;
  result: AttentionFrame | null;
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
      policyRules: {
        gateEvaluations: explanation.policyGateEvaluations,
        criterion: explanation.criterion,
        criterionEvaluations: explanation.policyCriterionEvaluations,
      },
      utility: {
        candidate: explanation.utility,
        currentScore: explanation.currentScore,
        currentPriority: explanation.currentPriority,
      },
      planner: {
        kind: explanation.decision.kind,
        reasons: explanation.reasons,
        continuityEvaluations: explanation.continuityEvaluations,
      },
      coordination: {
        kind: explanation.decision.kind,
        candidateScore: explanation.candidateScore,
        currentScore: explanation.currentScore,
        currentPriority: explanation.currentPriority,
        criterion: explanation.criterion,
        ambiguity: explanation.ambiguity,
        reasons: explanation.reasons,
        continuityEvaluations: explanation.continuityEvaluations,
      },
      pressureForecast: explanation.pressureForecast,
      attentionBurden: explanation.attentionBurden,
      result,
    };
  }
}

function buildEpisodeSummary(candidate: AttentionCandidate): EpisodeSummary | null {
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
