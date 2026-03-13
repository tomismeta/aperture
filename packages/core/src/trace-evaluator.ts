import type { ApertureTrace } from "./trace.js";

type CandidateTrace = Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;
type CandidateDecision = CandidateTrace["coordination"]["kind"];

export type TraceEvaluationReport = {
  totalCandidates: number;
  activated: number;
  queued: number;
  ambient: number;
  actionableEpisodes: number;
  actionableSurfaced: number;
  actionableActivated: number;
  deferredThenActivated: number;
  suppressedThenActivated: number;
  mergedEpisodeUpdates: number;
};

export function evaluateTraceSession(traces: ApertureTrace[]): TraceEvaluationReport {
  const report: TraceEvaluationReport = {
    totalCandidates: 0,
    activated: 0,
    queued: 0,
    ambient: 0,
    actionableEpisodes: 0,
    actionableSurfaced: 0,
    actionableActivated: 0,
    deferredThenActivated: 0,
    suppressedThenActivated: 0,
    mergedEpisodeUpdates: 0,
  };

  const lastDecisionByEpisode = new Map<string, CandidateDecision>();
  const mergedFrameIdsByEpisode = new Map<string, Set<string>>();
  const activatedAfterDeferral = new Set<string>();
  const activatedAfterSuppression = new Set<string>();

  for (const trace of traces) {
    if (!isCandidateTrace(trace)) {
      continue;
    }

    report.totalCandidates += 1;
    incrementDecisionCount(report, trace.coordination.kind);

    const episode = trace.episode;
    if (!episode) {
      continue;
    }

    const actionableEpisode =
      !trace.evaluation.adjusted.blocking
      && episode.state === "actionable"
      && episode.evidenceScore >= 4;
    if (actionableEpisode) {
      report.actionableEpisodes += 1;
      if (trace.result) {
        report.actionableSurfaced += 1;
      }
      if (trace.coordination.kind === "activate") {
        report.actionableActivated += 1;
      }
    }

    const previousDecision = lastDecisionByEpisode.get(episode.id);
    if (trace.coordination.kind === "activate" && previousDecision && previousDecision !== "activate") {
      if (!activatedAfterDeferral.has(episode.id)) {
        activatedAfterDeferral.add(episode.id);
        report.deferredThenActivated += 1;
      }

      if (previousDecision === "ambient" && !activatedAfterSuppression.has(episode.id)) {
        activatedAfterSuppression.add(episode.id);
        report.suppressedThenActivated += 1;
      }
    }

    if (trace.result?.id) {
      const seenFrameIds = mergedFrameIdsByEpisode.get(episode.id) ?? new Set<string>();
      if (seenFrameIds.has(trace.result.id)) {
        report.mergedEpisodeUpdates += 1;
      }
      seenFrameIds.add(trace.result.id);
      mergedFrameIdsByEpisode.set(episode.id, seenFrameIds);
    }

    lastDecisionByEpisode.set(episode.id, trace.coordination.kind);
  }

  return report;
}

function isCandidateTrace(trace: ApertureTrace): trace is CandidateTrace {
  return trace.evaluation.kind === "candidate";
}

function incrementDecisionCount(report: TraceEvaluationReport, decision: CandidateDecision): void {
  switch (decision) {
    case "activate":
      report.activated += 1;
      break;
    case "queue":
      report.queued += 1;
      break;
    case "ambient":
      report.ambient += 1;
      break;
    case "keep":
    case "clear":
      break;
  }
}
