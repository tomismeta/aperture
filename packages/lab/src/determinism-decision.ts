import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import type { ReplayDecisionSnapshot } from "./scenario.js";

export type NormalizedDecision = {
  stepIndex: number;
  stepLabel?: string;
  evaluationKind: "candidate" | "clear" | "noop";
  decisionKind?: string;
  decisionRecordProjectionVersion?: number;
  decisionRecordRoute?: string;
  plannedLane?: string;
  resultLane?: string;
  interactionId?: string;
  episodeId?: string | null;
  episodeKey?: string | null;
  episodeState?: string;
  episodeSize?: number;
  episodeEvidenceScore?: number;
  episodeEvidenceReasons: string[];
  episodeObsolete: boolean;
  decisionRecordCurrentFrameId?: string | null;
  decisionRecordCurrentEpisodeId?: string | null;
  decisionRecordOperatorPresence?: string;
  decisionRecordCandidateScore?: number;
  decisionRecordValueComponents: Record<string, number>;
  decisionRecordReasons: string[];
  decisionRecordReasonCodes: string[];
  decisionRecordFingerprint?: string;
  semanticConfidence?: string;
  semanticAbstained?: boolean;
  semanticInfluence: string[];
  semanticImpactDecisionBearing: string[];
  semanticImpactExplanatory: string[];
  ambiguity?: { reason: string; resolution: string } | null;
};

export function normalizeDecision(decision: ReplayDecisionSnapshot): NormalizedDecision {
  return {
    stepIndex: decision.stepIndex,
    ...(decision.stepLabel ? { stepLabel: decision.stepLabel } : {}),
    evaluationKind: decision.evaluationKind,
    ...(decision.decisionKind ? { decisionKind: decision.decisionKind } : {}),
    ...(decision.decisionRecordProjectionVersion !== undefined
      ? { decisionRecordProjectionVersion: decision.decisionRecordProjectionVersion }
      : {}),
    ...(decision.decisionRecordRoute ? { decisionRecordRoute: decision.decisionRecordRoute } : {}),
    ...(decision.plannedLane ? { plannedLane: decision.plannedLane } : {}),
    ...(decision.resultLane ? { resultLane: decision.resultLane } : {}),
    ...(decision.interactionId ? { interactionId: decision.interactionId } : {}),
    ...(decision.episodeId !== undefined ? { episodeId: decision.episodeId } : {}),
    ...(decision.episodeKey !== undefined ? { episodeKey: decision.episodeKey } : {}),
    ...(decision.episodeState ? { episodeState: decision.episodeState } : {}),
    ...(decision.episodeSize !== undefined ? { episodeSize: decision.episodeSize } : {}),
    ...(decision.episodeEvidenceScore !== undefined
      ? { episodeEvidenceScore: decision.episodeEvidenceScore }
      : {}),
    episodeEvidenceReasons: decision.episodeEvidenceReasons ?? [],
    episodeObsolete: decision.episodeObsolete === true,
    ...(decision.decisionRecordCurrentFrameId !== undefined
      ? { decisionRecordCurrentFrameId: decision.decisionRecordCurrentFrameId }
      : {}),
    ...(decision.decisionRecordCurrentEpisodeId !== undefined
      ? { decisionRecordCurrentEpisodeId: decision.decisionRecordCurrentEpisodeId }
      : {}),
    ...(decision.decisionRecordOperatorPresence
      ? { decisionRecordOperatorPresence: decision.decisionRecordOperatorPresence }
      : {}),
    ...(decision.decisionRecordCandidateScore !== undefined
      ? { decisionRecordCandidateScore: decision.decisionRecordCandidateScore }
      : {}),
    decisionRecordValueComponents: normalizeNumberMap(decision.decisionRecordValueComponents ?? {}),
    decisionRecordReasons: decision.decisionRecordReasons ?? [],
    decisionRecordReasonCodes: decision.decisionRecordReasonCodes ?? [],
    ...(decision.decisionRecordFingerprint
      ? { decisionRecordFingerprint: decision.decisionRecordFingerprint }
      : {}),
    ...(decision.semanticConfidence ? { semanticConfidence: decision.semanticConfidence } : {}),
    ...(decision.semanticAbstained === true ? { semanticAbstained: true } : {}),
    semanticInfluence: decision.semanticInfluence ?? [],
    semanticImpactDecisionBearing: decision.semanticImpactDecisionBearing ?? [],
    semanticImpactExplanatory: decision.semanticImpactExplanatory ?? [],
    ...(decision.ambiguity
      ? {
          ambiguity: {
            reason: decision.ambiguity.reason,
            resolution: decision.ambiguity.resolution,
          },
        }
      : {}),
  };
}

function normalizeNumberMap(value: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort(([left], [right]) => compareKernelCanonicalKey(left, right)),
  );
}
