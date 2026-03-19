import { evaluateTraceSession, type AttentionSignal, type TraceEvaluationReport } from "@tomismeta/aperture-core";

import type { ReplayRunResult } from "./runner.js";

export type ReplayScorecard = {
  trace: TraceEvaluationReport;
  signals: {
    presented: number;
    responded: number;
    dismissed: number;
    deferred: number;
    timedOut: number;
    viewed: number;
    contextExpanded: number;
    contextSkipped: number;
  };
  outcomes: {
    totalSteps: number;
    surfacedFrames: number;
    finalActiveInteractionId: string | null;
    finalQueuedCount: number;
    finalAmbientCount: number;
  };
};

export function scoreReplayRun(result: ReplayRunResult): ReplayScorecard {
  const finalView = result.views.at(-1)?.attentionView;

  return {
    trace: evaluateTraceSession(result.traces),
    signals: countSignals(result.signals),
    outcomes: {
      totalSteps: result.steps.length,
      surfacedFrames: result.steps.filter((step) => step.frame !== null).length,
      finalActiveInteractionId: finalView?.active?.interactionId ?? null,
      finalQueuedCount: finalView?.queued.length ?? 0,
      finalAmbientCount: finalView?.ambient.length ?? 0,
    },
  };
}

function countSignals(signals: AttentionSignal[]): ReplayScorecard["signals"] {
  const counts: ReplayScorecard["signals"] = {
    presented: 0,
    responded: 0,
    dismissed: 0,
    deferred: 0,
    timedOut: 0,
    viewed: 0,
    contextExpanded: 0,
    contextSkipped: 0,
  };

  for (const signal of signals) {
    switch (signal.kind) {
      case "presented":
        counts.presented += 1;
        break;
      case "responded":
        counts.responded += 1;
        break;
      case "dismissed":
        counts.dismissed += 1;
        break;
      case "deferred":
        counts.deferred += 1;
        break;
      case "timed_out":
        counts.timedOut += 1;
        break;
      case "viewed":
        counts.viewed += 1;
        break;
      case "context_expanded":
        counts.contextExpanded += 1;
        break;
      case "context_skipped":
        counts.contextSkipped += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}
