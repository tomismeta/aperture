import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import {
  isCandidateSemanticAbstained,
  readCandidateSemanticConfidence,
  readCandidateSemanticEvidence,
  readCandidateSemanticOntology,
} from "./judgment-input.js";
import type { AttentionPressure } from "./attention-pressure.js";
import { projectSemanticOntologyDiagnostic } from "./semantic-ontology.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { ApertureTrace, TraceSemanticSummary } from "./trace-types.js";

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
        resultLane: findResultLane(snapshot.attentionView, adjusted.taskId, adjusted.interactionId, explanation.decision.kind),
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

  const ontology = readCandidateSemanticOntology(adjusted) ?? projectSemanticOntologyDiagnostic(event, semantic);
  const semanticEvidence = readCandidateSemanticEvidence(adjusted);

  return {
    intentFrame: semantic.intentFrame,
    ...(semantic.activityClass !== undefined ? { activityClass: semantic.activityClass } : {}),
    ...(semantic.toolFamily !== undefined ? { toolFamily: semantic.toolFamily } : {}),
    ...(semantic.consequence !== undefined ? { consequence: semantic.consequence } : {}),
    ...(semanticEvidence?.confidence !== undefined ? { confidence: semanticEvidence.confidence } : {}),
    ...(semanticEvidence?.abstained === true ? { abstained: true } : {}),
    ontology,
    ...(semantic.whyNow !== undefined ? { whyNow: semantic.whyNow } : {}),
    relationHints: semantic.relationHints,
    factors: semantic.factors,
    reasons: semantic.reasons,
    influence: buildSemanticInfluence(event, adjusted),
    impact: buildSemanticImpact(event, adjusted),
    ...(semantic.provenance !== undefined ? { provenance: semantic.provenance } : {}),
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

  const ontology = readCandidateSemanticOntology(adjusted) ?? projectSemanticOntologyDiagnostic(event, semantic);
  const semanticEvidence = readCandidateSemanticEvidence(adjusted);

  const influence: string[] = [];

  if (event.type === "task.updated") {
    influence.push("task status stayed authoritative for candidate routing; semantic details still affected context, continuity, ambiguity handling, and ontology diagnostics");

    if ("activityClass" in event && event.activityClass === semantic.activityClass && semantic.activityClass !== undefined) {
      influence.push("activity class enriched canonical status facts");
    }

    if (event.toolFamily === semantic.toolFamily && semantic.toolFamily !== undefined) {
      influence.push("tool family enriched canonical status facts without changing the route");
    }

    if (semantic.relationHints.length > 0) {
      influence.push("relation hints informed continuity handling");
    }

    if (ontology.blocking !== "non_blocking" && !adjusted.blocking) {
      influence.push(
        ontology.blocking === "blocking"
          ? "semantic blocking marked the waiting status as blocked-like for peripheral routing while status handling stayed non-blocking"
          : "semantic waiting stayed diagnostic because status updates still route as non-blocking candidates",
      );
    }

    if (isCandidateSemanticAbstained(adjusted)) {
      influence.push("semantic abstention can keep non-blocking status work peripheral until clearer evidence arrives");
    } else if (readCandidateSemanticConfidence(adjusted) === "low") {
      influence.push("low semantic confidence can keep non-blocking status work peripheral until the signal is clearer");
    }

    return influence;
  }

  if (event.type === "human.input.requested") {
    if ("activityClass" in event && event.activityClass === semantic.activityClass && semantic.activityClass !== undefined) {
      influence.push("activity class was projected into the canonical request");
    }

    if (event.consequence === semantic.consequence && semantic.consequence !== undefined) {
      influence.push("semantic consequence set the canonical human-input consequence");
    }

    if (semantic.toolFamily !== undefined) {
      if (event.request.kind === "approval") {
        influence.push("tool family remained decision-bearing on the approval path");
      } else {
        influence.push("tool family stayed context-only on the question/form path");
      }
    }

    if (semantic.relationHints.length > 0) {
      influence.push("relation hints informed continuity handling");
    }

    if (isCandidateSemanticAbstained(adjusted)) {
      influence.push(
        adjusted.blocking
          ? "semantic abstention stayed visible but did not downgrade blocking work"
          : "semantic abstention constrained non-blocking routing",
      );
    } else if (readCandidateSemanticConfidence(adjusted) === "low") {
      influence.push(
        adjusted.blocking
          ? "semantic low confidence stayed visible but did not downgrade blocking work"
          : "low semantic confidence constrained non-blocking routing",
      );
    }

    if (influence.length === 0) {
      influence.push("semantic interpretation mostly stayed context-only beyond the explicit request");
    }

    return influence;
  }

  influence.push("semantic interpretation was recorded for explanation only");
  return influence;
}

function buildSemanticImpact(
  event: ApertureTrace["event"],
  adjusted: AttentionCandidate,
): TraceSemanticSummary["impact"] {
  const semantic = event.semantic;
  const decisionBearing = new Set<string>();
  const explanatory = new Set<string>();
  const semanticEvidence = readCandidateSemanticEvidence(adjusted);

  if (!semantic) {
    return {
      decisionBearing: [],
      explanatory: [],
    };
  }

  explanatory.add("intent");

  if (semantic.activityClass !== undefined) {
    explanatory.add("activity");
  }

  if (semantic.toolFamily !== undefined) {
    explanatory.add("tool");
  }

  if (semantic.consequence !== undefined) {
    explanatory.add("consequence");
  }

  if (semantic.whyNow !== undefined) {
    explanatory.add("why now");
  }

  if (semantic.relationHints.length > 0) {
    explanatory.add("relations");
  }

  if (semanticEvidence?.confidence !== undefined) {
    explanatory.add("confidence");
  }

  if (semanticEvidence?.abstained === true) {
    explanatory.add("abstention");
  }

  switch (event.type) {
    case "task.updated":
      if ("activityClass" in event && event.activityClass === semantic.activityClass && semantic.activityClass !== undefined) {
        promoteSemanticField(explanatory, decisionBearing, "activity", "activity (canonical)");
      }
      if (semantic.toolFamily !== undefined && event.toolFamily === semantic.toolFamily) {
        promoteSemanticField(explanatory, decisionBearing, "tool", "tool (bounded)");
      }
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(explanatory, decisionBearing, "relations", "relations (continuity)");
      }
      if (adjusted.judgmentInput.blockedLikeStatus) {
        promoteSemanticField(explanatory, decisionBearing, "intent", "blocking (peripheral routing)");
      }
      break;
    case "human.input.requested":
      if ("activityClass" in event && event.activityClass === semantic.activityClass && semantic.activityClass !== undefined) {
        promoteSemanticField(explanatory, decisionBearing, "activity", "activity (canonical)");
      }
      if (semantic.consequence !== undefined && event.consequence === semantic.consequence) {
        promoteSemanticField(explanatory, decisionBearing, "consequence", "consequence (canonical)");
      }
      if (semantic.toolFamily !== undefined && event.request.kind === "approval") {
        promoteSemanticField(explanatory, decisionBearing, "tool", "tool (approval path)");
      }
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(explanatory, decisionBearing, "relations", "relations (continuity)");
      }
      break;
    default:
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(explanatory, decisionBearing, "relations", "relations (continuity)");
      }
      break;
  }

  if (!adjusted.blocking && readCandidateSemanticConfidence(adjusted) === "low") {
    promoteSemanticField(explanatory, decisionBearing, "confidence", "confidence (ambiguity)");
  }

  if (!adjusted.blocking && isCandidateSemanticAbstained(adjusted)) {
    promoteSemanticField(explanatory, decisionBearing, "abstention", "abstention (ambiguity)");
  }

  return {
    decisionBearing: [...decisionBearing],
    explanatory: [...explanatory],
  };
}

function promoteSemanticField(
  explanatory: Set<string>,
  decisionBearing: Set<string>,
  fieldLabel: string,
  decisionLabel: string,
) {
  explanatory.delete(fieldLabel);
  decisionBearing.add(decisionLabel);
}

function findResultLane(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
  decisionKind: AttentionDecisionExplanation["decision"]["kind"],
): "now" | "next" | "ambient" | "none" {
  if (decisionKind === "auto_approve" || decisionKind === "clear") {
    return "none";
  }

  if (
    attentionView.now
    && attentionView.now.taskId === taskId
    && attentionView.now.interactionId === interactionId
  ) {
    return "now";
  }

  if (attentionView.next.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId)) {
    return "next";
  }

  if (attentionView.ambient.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId)) {
    return "ambient";
  }

  return "none";
}
