import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateSameInteractionContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  if (!activeFrame || activeFrame.interactionId !== input.candidate.interactionId) {
    return noopContinuityRule("same_interaction");
  }

  return overrideContinuityRule(
    "same_interaction",
    { kind: "activate", candidate: input.candidate },
    null,
    null,
    ["same interaction refreshes the existing frame"],
  );
};
