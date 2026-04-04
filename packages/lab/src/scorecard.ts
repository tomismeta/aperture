import type { AttentionSignal } from "@tomismeta/aperture-core";
import { isCandidateTrace, type ApertureTrace } from "../../core/src/trace-types.js";
import { evaluateTraceSession, type TraceEvaluationReport } from "../../core/src/trace-evaluator.js";

import type { ReplayRunResult } from "./runner.js";
import type { AttentionFrame } from "@tomismeta/aperture-core";

export type ReplayScorecard = {
  trace: TraceEvaluationReport;
  buckets: {
    now: number;
    next: number;
    ambient: number;
  };
  explanation: ReplayExplanationSnapshot;
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
    finalNowInteractionId: string | null;
    finalNextCount: number;
    finalAmbientCount: number;
    finalNextInteractionIds: string[];
    finalAmbientInteractionIds: string[];
  };
};

export type ReplayExplanationSnapshot = {
  targetInteractionId: string | null;
  targetLane: "now" | "next" | "ambient" | "none";
  headline: string | null;
  whyNow: string | null;
  coordinationReasons: string[];
  plannerReasons: string[];
  policyRationale: string[];
  criterionRationale: string[];
  continuityRationale: string[];
  attentionRationale: string[];
};

export function scoreReplayRun(result: ReplayRunResult): ReplayScorecard {
  const finalView = result.views.at(-1)?.attentionView;

  return {
    trace: evaluateTraceSession(result.traces),
    buckets: countResultBuckets(result),
    explanation: buildExplanationSnapshot(result),
    signals: countSignals(result.signals),
    outcomes: {
      totalSteps: result.steps.length,
      surfacedFrames: result.steps.filter((step) => step.frame !== null).length,
      finalNowInteractionId: finalView?.now?.interactionId ?? null,
      finalNextCount: finalView?.next.length ?? 0,
      finalAmbientCount: finalView?.ambient.length ?? 0,
      finalNextInteractionIds: finalView?.next.map((frame) => frame.interactionId) ?? [],
      finalAmbientInteractionIds: finalView?.ambient.map((frame) => frame.interactionId) ?? [],
    },
  };
}

function buildExplanationSnapshot(result: ReplayRunResult): ReplayExplanationSnapshot {
  const finalView = result.views.at(-1)?.attentionView;
  const target =
    finalView?.now
    ?? finalView?.next[0]
    ?? finalView?.ambient[0]
    ?? null;

  if (!target) {
    return {
      targetInteractionId: null,
      targetLane: "none",
      headline: null,
      whyNow: null,
      coordinationReasons: [],
      plannerReasons: [],
      policyRationale: [],
      criterionRationale: [],
      continuityRationale: [],
      attentionRationale: [],
    };
  }

  const targetLane =
    finalView?.now?.interactionId === target.interactionId
      ? "now"
      : finalView?.next.some((frame) => frame.interactionId === target.interactionId)
        ? "next"
        : "ambient";

  const trace = [...result.traces]
    .reverse()
    .find((candidateTrace) => (
      isCandidateTrace(candidateTrace)
      && (
        candidateTrace.result?.interactionId === target.interactionId
        || candidateTrace.evaluation.adjusted.interactionId === target.interactionId
        || candidateTrace.evaluation.original.interactionId === target.interactionId
      )
    ));

  const candidateTrace = trace && isCandidateTrace(trace) ? trace : null;
  const continuityRationale = candidateTrace
    ? candidateTrace.coordination.continuityEvaluations
      .filter((evaluation) => evaluation.kind === "override")
      .flatMap((evaluation) => evaluation.rationale)
    : [];
  const attentionRationale = readAttentionRationale(target);
  const headline =
    target.provenance?.whyNow
    ?? continuityRationale[0]
    ?? candidateTrace?.coordination.reasons[0]
    ?? attentionRationale[0]
    ?? synthesizeHeadline(target.mode, target.consequence);

  return {
    targetInteractionId: target.interactionId,
    targetLane,
    headline,
    whyNow: target.provenance?.whyNow ?? null,
    coordinationReasons: candidateTrace?.coordination.reasons ?? [],
    plannerReasons: candidateTrace?.planner.reasons ?? [],
    policyRationale: candidateTrace?.policy.rationale ?? [],
    criterionRationale: candidateTrace?.policyRules.criterion?.rationale ?? [],
    continuityRationale,
    attentionRationale,
  };
}

function countResultBuckets(result: ReplayRunResult): ReplayScorecard["buckets"] {
  const counts: ReplayScorecard["buckets"] = {
    now: 0,
    next: 0,
    ambient: 0,
  };

  for (const trace of result.traces) {
    if (!isCandidateTrace(trace)) {
      continue;
    }

    switch (trace.coordination.resultLane) {
      case "now":
        counts.now += 1;
        break;
      case "next":
        counts.next += 1;
        break;
      case "ambient":
        counts.ambient += 1;
        break;
      case "none":
        break;
    }
  }

  return counts;
}


function readAttentionRationale(frame: AttentionFrame): string[] {
  const attention = frame.metadata?.attention;
  if (!attention || typeof attention !== "object" || !("rationale" in attention)) {
    return [];
  }

  const { rationale } = attention;
  if (!Array.isArray(rationale)) {
    return [];
  }

  return rationale.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function synthesizeHeadline(
  mode: "status" | "approval" | "choice" | "form",
  consequence: "low" | "medium" | "high",
): string | null {
  switch (mode) {
    case "approval":
      return consequence === "high"
        ? "High-risk action requires operator approval"
        : "Approval blocking agent progress";
    case "choice":
      return "Waiting for operator decision";
    case "form":
      return "Input needed to continue";
    case "status":
      return null;
  }
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
