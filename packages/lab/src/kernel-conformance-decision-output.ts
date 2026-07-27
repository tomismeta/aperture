import {
  buildKernelDecisionRecordProjectionFromSnapshot,
  fingerprintKernelDecisionRecordProjection,
  type KernelDecisionRecordProjection,
} from "./kernel-decision-contract.js";
import type { ReplayDecisionSnapshot } from "./scenario.js";

export function buildDecisionOutput(decision: ReplayDecisionSnapshot): unknown {
  const projection = buildKernelDecisionRecordProjectionFromSnapshot(decision);

  return {
    stepIndex: decision.stepIndex,
    stepLabel: decision.stepLabel ?? null,
    evaluationKind: decision.evaluationKind,
    decisionKind: decision.decisionKind ?? null,
    realizedLane: decision.resultLane ?? null,
    interactionId: decision.interactionId ?? null,
    semanticConfidence: decision.semanticConfidence ?? null,
    semanticAbstained: decision.semanticAbstained === true,
    episode: {
      id: decision.episodeId ?? null,
      key: decision.episodeKey ?? null,
      state: decision.episodeState ?? null,
      size: decision.episodeSize ?? null,
      evidenceScore: decision.episodeEvidenceScore ?? null,
      evidenceReasons: decision.episodeEvidenceReasons ?? [],
      obsolete: decision.episodeObsolete === true,
    },
    ambiguity: decision.ambiguity ?? null,
    projection: projection === null ? null : buildProjectionOutput(projection),
    fingerprint: projection === null ? null : fingerprintKernelDecisionRecordProjection(projection),
  };
}

function buildProjectionOutput(projection: KernelDecisionRecordProjection): unknown {
  const shared = {
    schema: projection.schema,
    version: projection.version,
    route: projection.route,
    evidence: projection.evidence,
    value: projection.value,
    reasonCodes: projection.reasonCodes,
  };

  return "plannedLane" in projection
    ? { ...shared, plannedLane: projection.plannedLane, realizedLane: projection.realizedLane }
    : { ...shared, lane: projection.lane };
}
