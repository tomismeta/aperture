import {
  ambiguousPeripheralCriterionVerdict,
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateNoActiveFrameCriterionRule: PolicyCriterionRule = (input) => {
  const { evidence, candidateScore, criterion, peripheralResolution } = input;
  if (evidence.currentFrame) {
    return noopPolicyCriterionRule("no_active_frame");
  }

  if (candidateScore >= criterion.activationThreshold) {
    return verdictPolicyCriterionRule(
      "no_active_frame",
      clearCriterionVerdict(criterion),
    );
  }

  return verdictPolicyCriterionRule(
    "no_active_frame",
    ambiguousPeripheralCriterionVerdict(
      criterion,
      peripheralResolution,
      {
        kind: "interrupt",
        reason: "low_signal",
        resolution: peripheralResolution,
      },
      ["uncertain interruptive work stays peripheral until its signal is stronger"],
    ),
  );
};
