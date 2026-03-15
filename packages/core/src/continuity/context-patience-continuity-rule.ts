import { isBlockingFrame, priorityForFrame } from "../frame-score.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateContextPatienceContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers } = input;
  if (!activeFrame || context.currentScore === null) {
    return noopContinuityRule("context_patience");
  }

  if (candidate.blocking || isBlockingFrame(activeFrame)) {
    return noopContinuityRule("context_patience");
  }

  if (candidate.consequence === "high" || candidate.tone === "critical") {
    return noopContinuityRule("context_patience");
  }

  if (context.candidateScore <= context.currentScore) {
    return noopContinuityRule("context_patience");
  }

  const { contextCost } = context.utility.components;
  const margin =
    contextCost <= -6
      ? JUDGMENT_DEFAULTS.queuePlanner.highContextQueueMargin
      : contextCost <= -3
        ? JUDGMENT_DEFAULTS.queuePlanner.mediumContextQueueMargin
        : null;
  if (margin === null || context.candidateScore >= context.currentScore + margin) {
    return noopContinuityRule("context_patience");
  }

  return overrideContinuityRule(
    "context_patience",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    ["memory suggests this interaction usually needs context, so it stays peripheral until it clearly outranks current work"],
  );
};
