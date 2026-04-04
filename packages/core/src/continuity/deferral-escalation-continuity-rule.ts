import { isBlockingFrame, priorityForFrame, scoreAttentionFrame } from "../frame-score.js";
import type { AttentionSignalSummary } from "../signal-summary.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateDeferralEscalationContinuityRule: ContinuityRule = (input) => {
  const { candidate, context, evidence } = input;
  const activeFrame = evidence.attentionView.now ?? evidence.currentFrame;
  if (!activeFrame) {
    return noopContinuityRule("deferral_escalation");
  }

  const currentScore =
    activeFrame === evidence.currentFrame
      ? context.currentScore
      : scoreAttentionFrame(activeFrame, { now: candidate.timestamp });
  if (currentScore === null) {
    return noopContinuityRule("deferral_escalation");
  }

  if (candidate.blocking || candidate.priority === "background" || isBlockingFrame(activeFrame)) {
    return noopContinuityRule("deferral_escalation");
  }

  if (!hasResurfacingPressure(evidence.continuitySignalSummary)) {
    return noopContinuityRule("deferral_escalation");
  }

  if (context.candidateScore < currentScore - JUDGMENT_DEFAULTS.queuePlanner.escalationScoreSlack) {
    return noopContinuityRule("deferral_escalation");
  }

  return overrideContinuityRule(
    "deferral_escalation",
    { kind: "activate", candidate },
    priorityForFrame(activeFrame),
    currentScore,
    ["repeated deferral or resurfacing makes this task more deserving of current focus"],
  );
};

export function hasResurfacingPressure(summary: AttentionSignalSummary): boolean {
  return (
    summary.counts.deferred >= JUDGMENT_DEFAULTS.queuePlanner.deferredEscalationThreshold
    || summary.counts.returned >= JUDGMENT_DEFAULTS.queuePlanner.returnedEscalationThreshold
  );
}
