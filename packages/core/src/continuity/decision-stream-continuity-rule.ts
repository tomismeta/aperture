import { inferToolFamily, sourceKey } from "../interaction-taxonomy.js";
import { priorityForFrame } from "../frame-score.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateDecisionStreamContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers, routed, plannerDefaults } = input;
  if (!activeFrame || routed.decision.kind !== "activate" || context.currentScore === null) {
    return noopContinuityRule("decision_stream_continuity");
  }

  if (candidate.consequence === "high" || candidate.tone === "critical") {
    return noopContinuityRule("decision_stream_continuity");
  }

  if (activeFrame.consequence === "high" || activeFrame.tone === "critical") {
    return noopContinuityRule("decision_stream_continuity");
  }

  if (isSameDecisionStream(activeFrame, candidate)) {
    return noopContinuityRule("decision_stream_continuity");
  }

  const streamContinuityMargin =
    plannerDefaults?.streamContinuityMargin
    ?? JUDGMENT_DEFAULTS.queuePlanner.streamContinuityMargin;
  if (streamContinuityMargin <= 0) {
    return noopContinuityRule("decision_stream_continuity");
  }

  if (context.candidateScore >= context.currentScore + streamContinuityMargin) {
    return noopContinuityRule("decision_stream_continuity");
  }

  const scoreGap = context.candidateScore - context.currentScore;

  return overrideContinuityRule(
    "decision_stream_continuity",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    [
      `the current decision stream stays active until cross-stream work clears the ${streamContinuityMargin}-point margin (gap: ${scoreGap})`,
    ],
  );
};

function isSameDecisionStream(
  activeFrame: {
    taskId: string;
    source?: { kind?: string; id: string };
    title: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
  candidate: {
    taskId: string;
    source?: { kind?: string; id: string };
    toolFamily?: string;
    title: string;
    summary?: string;
    context?: {
      items?: Array<{
        id: string;
        label: string;
        value?: string;
      }>;
    };
  },
): boolean {
  const activeSourceKey = sourceKey(activeFrame.source);
  const candidateSourceKey = sourceKey(candidate.source);
  if (
    activeSourceKey
    && candidateSourceKey
    && activeSourceKey !== candidateSourceKey
  ) {
    return false;
  }

  if (activeSourceKey && candidateSourceKey && activeSourceKey === candidateSourceKey) {
    return true;
  }

  const activeToolFamily = inferToolFamily(activeFrame);
  const candidateToolFamily = inferToolFamily(candidate);
  if (
    activeToolFamily
    && candidateToolFamily
    && activeToolFamily !== candidateToolFamily
  ) {
    return false;
  }

  if (activeToolFamily && candidateToolFamily && activeToolFamily === candidateToolFamily) {
    return true;
  }

  if (activeFrame.taskId === candidate.taskId) {
    return true;
  }

  return false;
}
