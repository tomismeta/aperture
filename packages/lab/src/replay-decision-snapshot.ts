import { isCandidateTrace, type ApertureTrace } from "@tomismeta/aperture-core/internal";

import {
  buildKernelDecisionRecordProjection,
  fingerprintKernelDecisionRecordProjection,
  readKernelDecisionRecordComponents,
  readKernelDecisionRecordScore,
} from "./kernel-decision-contract.js";
import type { ReplayDecisionSnapshot, ReplayObservationStep } from "./scenario.js";
import type { ReplayCandidateTrace } from "./replay-trace.js";

type ReplayDecisionSnapshotStep = { kind: ReplayObservationStep["kind"]; label?: string };

export function buildDecisionSnapshot(
  step: ReplayObservationStep,
  stepIndex: number,
  trace: ApertureTrace | undefined,
): ReplayDecisionSnapshot | null {
  if (!trace) {
    return null;
  }

  if (!isCandidateTrace(trace)) {
    return {
      stepIndex,
      stepKind: step.kind,
      ...(step.label ? { stepLabel: step.label } : {}),
      evaluationKind: trace.evaluation.kind,
      ...(trace.evaluation.kind === "clear" ? { decisionKind: "clear" } : {}),
    };
  }

  return buildCandidateDecisionSnapshot(step, stepIndex, trace);
}

export function buildCandidateDecisionSnapshot(
  step: ReplayDecisionSnapshotStep,
  stepIndex: number,
  trace: ReplayCandidateTrace,
): ReplayDecisionSnapshot {
  return {
    stepIndex,
    stepKind: step.kind,
    ...(step.label ? { stepLabel: step.label } : {}),
    evaluationKind: "candidate",
    decisionKind: trace.coordination.kind,
    resultLane: trace.coordination.resultLane,
    interactionId: trace.evaluation.adjusted.interactionId,
    ...buildDecisionSemanticSnapshot(trace),
    ...buildDecisionEpisodeSnapshot(trace),
    ...buildDecisionRecordSnapshot(trace),
    ...(trace.semantic?.influence !== undefined
      ? { semanticInfluence: trace.semantic.influence }
      : {}),
    ...(trace.semantic?.impact.decisionBearing !== undefined
      ? { semanticImpactDecisionBearing: trace.semantic.impact.decisionBearing }
      : {}),
    ...(trace.semantic?.impact.explanatory !== undefined
      ? { semanticImpactExplanatory: trace.semantic.impact.explanatory }
      : {}),
    ambiguity: trace.coordination.ambiguity,
  };
}

export function buildDecisionSemanticSnapshot(
  trace: ReplayCandidateTrace,
): Pick<ReplayDecisionSnapshot, "semanticConfidence" | "semanticAbstained"> {
  const adjusted = trace.evaluation.adjusted as {
    judgmentInput?: {
      semanticEvidence?: {
        confidence?: ReplayDecisionSnapshot["semanticConfidence"];
        abstained?: boolean;
      };
    };
    semanticConfidence?: ReplayDecisionSnapshot["semanticConfidence"];
    semanticAbstained?: boolean;
  };
  const semanticEvidence = adjusted.judgmentInput?.semanticEvidence;
  const confidence =
    semanticEvidence?.confidence ?? adjusted.semanticConfidence ?? trace.semantic?.confidence;
  const abstained =
    semanticEvidence?.abstained ?? adjusted.semanticAbstained ?? trace.semantic?.abstained;

  return {
    ...(confidence !== undefined ? { semanticConfidence: confidence } : {}),
    ...(abstained === true ? { semanticAbstained: true } : {}),
  };
}

export function buildDecisionEpisodeSnapshot(
  trace: ReplayCandidateTrace,
): Pick<
  ReplayDecisionSnapshot,
  | "episodeId"
  | "episodeKey"
  | "episodeState"
  | "episodeSize"
  | "episodeEvidenceScore"
  | "episodeEvidenceReasons"
  | "episodeObsolete"
> {
  const episode = trace.episode;

  return {
    episodeId: episode?.id ?? null,
    episodeKey: episode?.key ?? null,
    ...(episode?.state !== undefined ? { episodeState: episode.state } : {}),
    ...(episode?.size !== undefined ? { episodeSize: episode.size } : {}),
    ...(episode?.evidenceScore !== undefined
      ? { episodeEvidenceScore: episode.evidenceScore }
      : {}),
    ...(episode?.evidenceReasons !== undefined
      ? { episodeEvidenceReasons: episode.evidenceReasons }
      : {}),
    episodeObsolete: trace.evaluation.adjusted.episodeObsolete === true,
  };
}

export function buildDecisionRecordSnapshot(
  trace: ReplayCandidateTrace,
): Pick<
  ReplayDecisionSnapshot,
  | "decisionRecordProjectionVersion"
  | "decisionRecordRoute"
  | "plannedLane"
  | "decisionRecordCurrentFrameId"
  | "decisionRecordCurrentEpisodeId"
  | "decisionRecordOperatorPresence"
  | "decisionRecordCandidateScore"
  | "decisionRecordValueComponents"
  | "decisionRecordReasons"
  | "decisionRecordReasonCodes"
  | "decisionRecordFingerprint"
> {
  const record = trace.decisionRecord;
  if (!record) {
    return {};
  }

  const projection = buildKernelDecisionRecordProjection(record, {
    realizedLane: trace.coordination.resultLane,
  });
  const valueComponents =
    projection?.value.components ??
    readKernelDecisionRecordComponents(record.value.breakdown.components);
  const decisionRecordCandidateScore =
    projection?.value.candidateScore ?? readKernelDecisionRecordScore(record);
  if (decisionRecordCandidateScore === null || valueComponents === null) {
    return {};
  }

  return {
    ...(projection !== null
      ? {
          decisionRecordProjectionVersion: projection.version,
          decisionRecordReasonCodes: projection.reasonCodes,
          decisionRecordFingerprint: fingerprintKernelDecisionRecordProjection(projection),
        }
      : {}),
    decisionRecordRoute: projection?.route ?? record.planning.route,
    plannedLane: projection?.plannedLane ?? record.planning.plannedLane,
    decisionRecordCurrentFrameId:
      projection?.evidence.currentFrameId ?? record.evidenceSnapshot.currentFrameId,
    decisionRecordCurrentEpisodeId:
      projection?.evidence.currentEpisodeId ?? record.evidenceSnapshot.currentEpisodeId,
    decisionRecordOperatorPresence:
      projection?.evidence.operatorPresence ?? record.evidenceSnapshot.operatorPresence,
    decisionRecordCandidateScore,
    decisionRecordValueComponents: valueComponents,
    decisionRecordReasons: projection?.reasons ?? record.planning.reasons,
  };
}
