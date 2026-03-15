import { isBlockingFrame, priorityForFrame } from "../frame-score.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateDeferralEscalationContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence } = input;
  if (!activeFrame || context.currentScore === null) {
    return noopContinuityRule("deferral_escalation");
  }

  if (candidate.blocking || candidate.priority === "background" || isBlockingFrame(activeFrame)) {
    return noopContinuityRule("deferral_escalation");
  }

  const taskSummary = evidence.taskSignalSummary;
  const repeatedlyDeferred =
    taskSummary.counts.deferred >= JUDGMENT_DEFAULTS.queuePlanner.deferredEscalationThreshold;
  const repeatedlyReturned =
    taskSummary.counts.returned >= JUDGMENT_DEFAULTS.queuePlanner.returnedEscalationThreshold;
  if (!repeatedlyDeferred && !repeatedlyReturned) {
    return noopContinuityRule("deferral_escalation");
  }

  if (context.candidateScore < context.currentScore - JUDGMENT_DEFAULTS.queuePlanner.escalationScoreSlack) {
    return noopContinuityRule("deferral_escalation");
  }

  return overrideContinuityRule(
    "deferral_escalation",
    { kind: "activate", candidate },
    priorityForFrame(activeFrame),
    context.currentScore,
    ["repeated deferral makes this task more deserving of current focus"],
  );
};
