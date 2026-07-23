import type { ApertureTrace, CandidateApertureTrace } from "@tomismeta/aperture-core/internal";
import type {
  ReplayDecisionOperatorPresence,
  ReplayDecisionPlannedLane,
  ReplayDecisionRoute,
  ReplayDecisionValueComponents,
} from "./scenario.js";

type NonCandidateApertureTrace = Exclude<ApertureTrace, CandidateApertureTrace>;

export type ReplayDecisionRecordTraceProjection = {
  planning: {
    route: ReplayDecisionRoute;
    plannedLane: ReplayDecisionPlannedLane;
    reasons: string[];
    reasonCodes?: string[];
  };
  evidenceSnapshot: {
    operatorPresence: ReplayDecisionOperatorPresence;
    currentFrameId: string | null;
    currentEpisodeId: string | null;
  };
  value: {
    candidateScore: number;
    breakdown: {
      components: ReplayDecisionValueComponents;
    };
  };
};

export type ReplayCandidateTrace = Omit<CandidateApertureTrace, "decisionRecord"> &
  Partial<{
    decisionRecord: ReplayDecisionRecordTraceProjection;
  }>;

export type ReplayApertureTrace = NonCandidateApertureTrace | ReplayCandidateTrace;

export function isReplayCandidateTrace(trace: ReplayApertureTrace): trace is ReplayCandidateTrace {
  return trace.evaluation.kind === "candidate";
}
