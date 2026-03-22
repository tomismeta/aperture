import { isCandidateTrace, type ApertureTrace, type CandidateApertureTrace } from "./trace.js";

type CandidateDecision = CandidateApertureTrace["coordination"]["kind"];

export type TraceEvaluationReport = {
  totalCandidates: number;
  autoApproved: number;
  activated: number;
  queued: number;
  ambient: number;
  ambiguousDecisions: number;
  ambiguousQueued: number;
  ambiguousAmbient: number;
  ambiguousLowConfidence: number;
  ambiguousAbstained: number;
  ambiguousQueuedThenActivated: number;
  ambiguousAmbientThenActivated: number;
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
    autoApproved: 0,
    activated: 0,
    queued: 0,
    ambient: 0,
    ambiguousDecisions: 0,
    ambiguousQueued: 0,
    ambiguousAmbient: 0,
    ambiguousLowConfidence: 0,
    ambiguousAbstained: 0,
    ambiguousQueuedThenActivated: 0,
    ambiguousAmbientThenActivated: 0,
    actionableEpisodes: 0,
    actionableSurfaced: 0,
    actionableActivated: 0,
    deferredThenActivated: 0,
    suppressedThenActivated: 0,
    mergedEpisodeUpdates: 0,
  };

  const lastDecisionByEpisode = new Map<string, CandidateDecision>();
  const pendingAmbiguityByKey = new Map<string, "queue" | "ambient">();
  const mergedFrameIdsByEpisode = new Map<string, Set<string>>();
  const activatedAfterDeferral = new Set<string>();
  const activatedAfterSuppression = new Set<string>();
  const activatedAfterAmbiguousQueue = new Set<string>();
  const activatedAfterAmbiguousAmbient = new Set<string>();

  for (const trace of traces) {
    if (!isCandidateTrace(trace)) {
      continue;
    }

    report.totalCandidates += 1;
    incrementDecisionCount(report, trace.coordination.kind);

    const ambiguityKey = trace.episode?.id ?? `${trace.evaluation.adjusted.taskId}:${trace.evaluation.adjusted.interactionId}`;
    if (trace.coordination.ambiguity) {
      report.ambiguousDecisions += 1;
      if (trace.coordination.ambiguity.resolution === "queue") {
        report.ambiguousQueued += 1;
      } else {
        report.ambiguousAmbient += 1;
      }
      if (trace.evaluation.adjusted.semanticConfidence === "low") {
        report.ambiguousLowConfidence += 1;
      }
      if (trace.evaluation.adjusted.semanticAbstained === true) {
        report.ambiguousAbstained += 1;
      }
      pendingAmbiguityByKey.set(ambiguityKey, trace.coordination.ambiguity.resolution);
    } else if (trace.coordination.kind === "activate") {
      const pendingResolution = pendingAmbiguityByKey.get(ambiguityKey);
      if (pendingResolution === "queue" && !activatedAfterAmbiguousQueue.has(ambiguityKey)) {
        activatedAfterAmbiguousQueue.add(ambiguityKey);
        report.ambiguousQueuedThenActivated += 1;
        pendingAmbiguityByKey.delete(ambiguityKey);
      } else if (pendingResolution === "ambient" && !activatedAfterAmbiguousAmbient.has(ambiguityKey)) {
        activatedAfterAmbiguousAmbient.add(ambiguityKey);
        report.ambiguousAmbientThenActivated += 1;
        pendingAmbiguityByKey.delete(ambiguityKey);
      }
    }

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

function incrementDecisionCount(report: TraceEvaluationReport, decision: CandidateDecision): void {
  switch (decision) {
    case "activate":
      report.activated += 1;
      break;
    case "auto_approve":
      report.autoApproved += 1;
      break;
    case "queue":
      report.queued += 1;
      break;
    case "ambient":
      report.ambient += 1;
      break;
    case "clear":
      break;
  }
}
