import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import {
  hasBlockedLikeStatusSemantics,
  hasRoutineObservationalStatusConflictSemantics,
  isCandidateSemanticAbstained,
  isCandidateSemanticLowConfidence,
  readCandidateObservation,
  readCandidateObservationalStatusConflictEvidence,
  readCandidateAttentionOntology,
  readCandidateSemanticConfidence,
  readCandidateSemanticEvidence,
} from "./judgment-input.js";
import type { NormalizedObservation } from "./normalized-observation.js";
import type { AttentionPressure } from "./attention-pressure.js";
import { projectAttentionOntologyDiagnostic } from "./semantic-ontology.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type {
  TraceCandidateTransition,
  TraceDecisionKind,
  TraceEventTransition,
  TraceFrameTransition,
  TraceObservationSummary,
} from "./trace-common.js";
import { diffTraceObjects } from "./trace-diff.js";
import type { ApertureTrace, TraceSemanticSummary } from "./trace-types.js";

export type TraceSnapshot = {
  timestamp: string;
  event: ApertureEvent;
  eventTransition: TraceEventTransition;
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
  suppressed?: boolean;
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
    const suppressed = input.suppressed === true;
    const semantic = buildSemanticSummary(snapshot.event, adjusted);
    const decisionRecord = explanation.record;
    const coordination = buildTraceCoordination(decisionRecord, snapshot, adjusted, suppressed);

    return {
      ...snapshot,
      evaluation: {
        kind: "candidate",
        original,
        adjusted,
      },
      candidateTransition: buildCandidateTransition(original, adjusted),
      frameTransition: buildFrameTransition(
        snapshot.current,
        suppressed ? snapshot.current : result,
      ),
      heuristics: {
        scoreOffset: adjusted.attentionScoreOffset ?? 0,
        rationale: adjusted.attentionRationale ?? [],
      },
      ...(semantic !== undefined ? { semantic } : {}),
      episode: buildEpisodeSummary(adjusted),
      decisionRecord,
      policy: decisionRecord.policy.verdict,
      policyRules: {
        gateEvaluations: decisionRecord.policy.gateEvaluations,
        criterion: decisionRecord.policy.criterion,
        criterionEvaluations: decisionRecord.policy.criterionEvaluations,
      },
      utility: {
        candidate: decisionRecord.value.breakdown,
        currentScore: decisionRecord.value.currentScore,
        currentPriority: decisionRecord.value.currentPriority,
      },
      planner: {
        kind: decisionRecord.planning.route,
        reasons: decisionRecord.planning.reasons,
        reasonCodes: decisionRecord.planning.reasonCodes,
        continuityEvaluations: decisionRecord.planning.continuityEvaluations,
      },
      coordination: {
        kind: coordination.kind,
        resultLane: coordination.resultLane,
        candidateScore: decisionRecord.value.claimScore,
        currentScore: decisionRecord.value.currentScore,
        currentPriority: decisionRecord.value.currentPriority,
        criterion: decisionRecord.policy.criterion,
        ambiguity: decisionRecord.planning.ambiguity,
        reasons: coordination.reasons,
        reasonCodes: coordination.reasonCodes,
        continuityEvaluations: coordination.continuityEvaluations,
      },
      pressureForecast: decisionRecord.evidenceSnapshot.pressureForecast,
      attentionBurden: decisionRecord.evidenceSnapshot.attentionBurden,
      result,
    };
  }
}

function buildTraceCoordination(
  decisionRecord: AttentionDecisionExplanation["record"],
  snapshot: TraceSnapshot,
  adjusted: AttentionCandidate,
  suppressed: boolean,
): {
  kind: TraceDecisionKind;
  resultLane: "now" | "next" | "ambient" | "none";
  reasons: string[];
  reasonCodes: AttentionDecisionExplanation["record"]["planning"]["reasonCodes"];
  continuityEvaluations: AttentionDecisionExplanation["record"]["planning"]["continuityEvaluations"];
} {
  if (suppressed) {
    return {
      kind: "suppressed",
      resultLane: "none",
      reasons: ["stale event-time candidate was suppressed by episode lifecycle"],
      reasonCodes: [],
      continuityEvaluations: [],
    };
  }

  return {
    kind: decisionRecord.planning.route,
    resultLane: findResultLane(
      snapshot.attentionView,
      adjusted.taskId,
      adjusted.interactionId,
      decisionRecord.planning.route,
    ),
    reasons: decisionRecord.planning.reasons,
    reasonCodes: decisionRecord.planning.reasonCodes,
    continuityEvaluations: decisionRecord.planning.continuityEvaluations,
  };
}

function buildCandidateTransition(
  original: AttentionCandidate,
  adjusted: AttentionCandidate,
): TraceCandidateTransition {
  return {
    changedFields: diffTraceObjects(original, adjusted),
  };
}

function buildFrameTransition(
  previous: AttentionFrame | null,
  result: AttentionFrame | null,
): TraceFrameTransition {
  return {
    changedFields: diffTraceObjects(previous, result),
  };
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

  const ontology =
    readCandidateAttentionOntology(adjusted) ?? projectAttentionOntologyDiagnostic(event, semantic);
  const observation = readCandidateObservation(adjusted);
  const semanticEvidence = readCandidateSemanticEvidence(adjusted);
  const observationalStatusConflict = readCandidateObservationalStatusConflictEvidence(adjusted);

  return {
    intentFrame: semantic.intentFrame,
    ...(semantic.activityClass !== undefined ? { activityClass: semantic.activityClass } : {}),
    ...(semantic.toolFamily !== undefined ? { toolFamily: semantic.toolFamily } : {}),
    ...(semantic.consequence !== undefined ? { consequence: semantic.consequence } : {}),
    ...(semanticEvidence?.confidence !== undefined
      ? { confidence: semanticEvidence.confidence }
      : {}),
    ...(semanticEvidence?.abstained === true ? { abstained: true } : {}),
    ...(observation !== null ? { observation: buildTraceObservationSummary(observation) } : {}),
    ...(observationalStatusConflict !== null ? { observationalStatusConflict } : {}),
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

function buildTraceObservationSummary(observation: NormalizedObservation): TraceObservationSummary {
  return {
    kind: observation.kind,
    polarity: observation.polarity,
    owner: observation.ownership.owner,
    ...(observation.ownership.toolFamily !== undefined
      ? { toolFamily: observation.ownership.toolFamily }
      : {}),
    subject: observation.subject,
    evidenceLoss: observation.evidenceLoss,
    evidenceStrength: observation.evidenceStrength,
    semanticAgreement: observation.semanticAgreement,
    ...(observation.diagnosticClass !== undefined
      ? { diagnosticClass: observation.diagnosticClass }
      : {}),
    ...(observation.recoveryHint !== undefined ? { recoveryHint: observation.recoveryHint } : {}),
    provenanceOrigin: observation.provenance.origin,
    provenanceAuthority: observation.provenance.authority,
    consequenceBaseline: observation.consequenceBaseline,
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

  const ontology =
    readCandidateAttentionOntology(adjusted) ?? projectAttentionOntologyDiagnostic(event, semantic);

  const influence: string[] = [];

  if (event.type === "task.updated") {
    if (hasRoutineObservationalStatusConflictSemantics(adjusted)) {
      influence.push(
        "engine-owned observational evidence resolved noisy failed-status routing as status handling",
      );
    } else {
      influence.push(
        "task status stayed authoritative for candidate routing; semantic details still affected context, continuity, ambiguity handling, and ontology diagnostics",
      );
    }

    if (
      "activityClass" in event &&
      event.activityClass === semantic.activityClass &&
      semantic.activityClass !== undefined
    ) {
      influence.push("activity class enriched canonical status facts");
    }

    if (event.toolFamily === semantic.toolFamily && semantic.toolFamily !== undefined) {
      influence.push(
        hasRoutineObservationalStatusConflictSemantics(adjusted)
          ? "tool family helped identify the observational status conflict"
          : "tool family enriched canonical status facts without changing the route",
      );
    }

    if (semantic.relationHints.length > 0) {
      influence.push("relation hints informed continuity handling");
    }

    if (ontology.blocking !== "non_blocking" && !adjusted.blocking) {
      influence.push(
        ontology.blocking === "blocking"
          ? "semantic blocking marked the status as blocked-like for judgment routing while status handling stayed non-blocking"
          : "semantic waiting stayed diagnostic because status updates still route as non-blocking candidates",
      );
    }

    if (isCandidateSemanticAbstained(adjusted)) {
      influence.push(
        "semantic abstention can keep non-blocking status work peripheral until clearer evidence arrives",
      );
    } else if (readCandidateSemanticConfidence(adjusted) === "low") {
      influence.push(
        "low semantic confidence can keep non-blocking status work peripheral until the signal is clearer",
      );
    }

    return influence;
  }

  if (event.type === "human.input.requested") {
    if (
      "activityClass" in event &&
      event.activityClass === semantic.activityClass &&
      semantic.activityClass !== undefined
    ) {
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
      influence.push(
        "semantic interpretation mostly stayed context-only beyond the explicit request",
      );
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
  const canonical = new Set<string>();
  const routing = new Set<string>();
  const continuity = new Set<string>();
  const ambiguity = new Set<string>();
  const contextOnly = new Set<string>();
  const observation = readCandidateObservation(adjusted);
  const semanticEvidence = readCandidateSemanticEvidence(adjusted);
  const routingAuthority = buildSemanticRoutingAuthority(event);

  if (!semantic) {
    return {
      routingAuthority,
      decisionBearing: [],
      explanatory: [],
      canonical: [],
      routing: [],
      continuity: [],
      ambiguity: [],
      contextOnly: [],
    };
  }

  contextOnly.add("intent");

  if (semantic.activityClass !== undefined) {
    contextOnly.add("activity");
  }

  if (semantic.toolFamily !== undefined) {
    contextOnly.add("tool");
  }

  if (semantic.consequence !== undefined) {
    contextOnly.add("consequence");
  }

  if (semantic.whyNow !== undefined) {
    contextOnly.add("why now");
  }

  if (semantic.relationHints.length > 0) {
    contextOnly.add("relations");
  }

  if (semanticEvidence?.confidence !== undefined) {
    contextOnly.add("confidence");
  }

  if (semanticEvidence?.abstained === true) {
    contextOnly.add("abstention");
  }

  if (observation !== null) {
    contextOnly.add("observation");
  }

  switch (event.type) {
    case "task.updated":
      if (
        "activityClass" in event &&
        event.activityClass === semantic.activityClass &&
        semantic.activityClass !== undefined
      ) {
        promoteSemanticField(contextOnly, canonical, "activity", "activity (canonical)");
      }
      if (semantic.toolFamily !== undefined && event.toolFamily === semantic.toolFamily) {
        promoteSemanticField(contextOnly, canonical, "tool", "tool (bounded)");
      }
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(contextOnly, continuity, "relations", "relations (continuity)");
      }
      if (hasBlockedLikeStatusSemantics(adjusted)) {
        promoteSemanticField(contextOnly, routing, "intent", "blocking (judgment routing)");
      }
      if (hasRoutineObservationalStatusConflictSemantics(adjusted)) {
        promoteSemanticField(
          contextOnly,
          routing,
          "observation",
          "observation (judgment contract)",
        );
        promoteSemanticField(
          contextOnly,
          routing,
          "consequence",
          "observational status conflict (judgment routing)",
        );
        promoteSemanticField(contextOnly, routing, "intent", "intent (status-conflict routing)");
        promoteSemanticField(
          contextOnly,
          routing,
          "activity",
          "activity (status-conflict routing)",
        );
        promoteSemanticField(contextOnly, routing, "tool", "tool (status-conflict routing)");
        promoteSemanticField(
          contextOnly,
          routing,
          "confidence",
          "confidence (status-conflict routing)",
        );
      }
      break;
    case "human.input.requested":
      if (
        "activityClass" in event &&
        event.activityClass === semantic.activityClass &&
        semantic.activityClass !== undefined
      ) {
        promoteSemanticField(contextOnly, canonical, "activity", "activity (canonical)");
      }
      if (semantic.consequence !== undefined && event.consequence === semantic.consequence) {
        promoteSemanticField(contextOnly, canonical, "consequence", "consequence (canonical)");
      }
      if (semantic.toolFamily !== undefined && event.request.kind === "approval") {
        promoteSemanticField(contextOnly, canonical, "tool", "tool (approval path)");
      }
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(contextOnly, continuity, "relations", "relations (continuity)");
      }
      break;
    default:
      if (semantic.relationHints.length > 0) {
        promoteSemanticField(contextOnly, continuity, "relations", "relations (continuity)");
      }
      break;
  }

  if (!adjusted.blocking && isCandidateSemanticLowConfidence(adjusted)) {
    promoteSemanticField(contextOnly, ambiguity, "confidence", "confidence (ambiguity)");
  }

  if (!adjusted.blocking && isCandidateSemanticAbstained(adjusted)) {
    promoteSemanticField(contextOnly, ambiguity, "abstention", "abstention (ambiguity)");
  }

  return {
    routingAuthority,
    decisionBearing: [...canonical, ...routing, ...continuity, ...ambiguity],
    explanatory: [...contextOnly],
    canonical: [...canonical],
    routing: [...routing],
    continuity: [...continuity],
    ambiguity: [...ambiguity],
    contextOnly: [...contextOnly],
  };
}

function buildSemanticRoutingAuthority(
  event: ApertureTrace["event"],
): TraceSemanticSummary["impact"]["routingAuthority"] {
  switch (event.type) {
    case "task.updated":
      return "status";
    case "human.input.requested":
      return "request";
    default:
      return "event";
  }
}

function promoteSemanticField(
  contextOnly: Set<string>,
  impactBucket: Set<string>,
  fieldLabel: string,
  decisionLabel: string,
) {
  contextOnly.delete(fieldLabel);
  impactBucket.add(decisionLabel);
}

function findResultLane(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
  decisionKind: AttentionDecisionExplanation["decision"]["kind"],
): "now" | "next" | "ambient" | "none" {
  if (decisionKind === "auto_approve") {
    return "none";
  }

  if (
    attentionView.now &&
    attentionView.now.taskId === taskId &&
    attentionView.now.interactionId === interactionId
  ) {
    return "now";
  }

  if (
    attentionView.next.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    )
  ) {
    return "next";
  }

  if (
    attentionView.ambient.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    )
  ) {
    return "ambient";
  }

  return "none";
}
