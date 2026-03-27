import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { ApertureTrace, TraceSemanticSummary } from "./trace.js";

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
    const semantic = buildSemanticSummary(snapshot.event, adjusted);

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
      ...(semantic !== undefined ? { semantic } : {}),
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
        resultBucket: findResultBucket(snapshot.attentionView, adjusted.taskId, adjusted.interactionId, explanation.decision.kind),
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

function buildSemanticSummary(
  event: ApertureTrace["event"],
  adjusted: AttentionCandidate,
): TraceSemanticSummary | undefined {
  const semantic = event.semantic;
  if (!semantic) {
    return undefined;
  }

  return {
    intentFrame: semantic.intentFrame,
    ...(semantic.activityClass !== undefined ? { activityClass: semantic.activityClass } : {}),
    ...(semantic.toolFamily !== undefined ? { toolFamily: semantic.toolFamily } : {}),
    ...(semantic.consequence !== undefined ? { consequence: semantic.consequence } : {}),
    ...(semantic.confidence !== undefined ? { confidence: semantic.confidence } : {}),
    ...(semantic.abstained === true ? { abstained: true } : {}),
    ...(semantic.whyNow !== undefined ? { whyNow: semantic.whyNow } : {}),
    relationHints: semantic.relationHints,
    factors: semantic.factors,
    reasons: semantic.reasons,
    influence: buildSemanticInfluence(event, adjusted),
  };
}

function buildSemanticInfluence(
  event: ApertureTrace["event"],
  adjusted: AttentionCandidate,
): string[] {
  const semantic = event.semantic;
  if (!semantic) {
    return [];
  }

  const influence: string[] = [];

  if (event.type === "task.updated") {
    influence.push("task status remained authoritative; semantic details stayed bounded to explanation, continuity, and ambiguity handling");

    if (event.toolFamily === semantic.toolFamily && semantic.toolFamily !== undefined) {
      influence.push("tool family enriched the canonical status event without changing status routing");
    }

    if (semantic.relationHints.length > 0) {
      influence.push("relation hints were available to continuity handling");
    }

    if (semantic.abstained === true) {
      influence.push("semantic abstention can keep non-blocking status work peripheral until clearer evidence arrives");
    } else if (semantic.confidence === "low") {
      influence.push("low semantic confidence can keep non-blocking status work peripheral until the signal is clearer");
    }

    return influence;
  }

  if (event.type === "human.input.requested") {
    if (event.consequence === semantic.consequence && semantic.consequence !== undefined) {
      influence.push("semantic consequence shaped the canonical human-input consequence");
    }

    if (semantic.toolFamily !== undefined) {
      if (event.request.kind === "approval") {
        influence.push("tool family remained decision-bearing on the approval path");
      } else {
        influence.push("tool family stayed explanatory on the question/form path");
      }
    }

    if (semantic.relationHints.length > 0) {
      influence.push("relation hints were available to continuity handling");
    }

    if (semantic.abstained === true) {
      influence.push(
        adjusted.blocking
          ? "semantic abstention stayed visible but did not downgrade blocking work"
          : "semantic abstention constrained non-blocking routing",
      );
    } else if (semantic.confidence === "low") {
      influence.push(
        adjusted.blocking
          ? "semantic low confidence stayed visible but did not downgrade blocking work"
          : "low semantic confidence constrained non-blocking routing",
      );
    }

    if (influence.length === 0) {
      influence.push("semantic interpretation mainly stayed explanatory beyond the explicit request");
    }

    return influence;
  }

  influence.push("semantic interpretation was recorded for explanation only");
  return influence;
}
function findResultBucket(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
  decisionKind: AttentionDecisionExplanation["decision"]["kind"],
): "active" | "queued" | "ambient" | "none" {
  if (decisionKind === "auto_approve" || decisionKind === "clear") {
    return "none";
  }

  if (
    attentionView.active
    && attentionView.active.taskId === taskId
    && attentionView.active.interactionId === interactionId
  ) {
    return "active";
  }

  if (attentionView.queued.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId)) {
    return "queued";
  }

  if (attentionView.ambient.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId)) {
    return "ambient";
  }

  return "none";
}
