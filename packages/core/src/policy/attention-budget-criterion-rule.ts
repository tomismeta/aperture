import { adjustCriterionRule, noopPolicyCriterionRule, type PolicyCriterionRule } from "./policy-criterion-rule.js";

export const evaluateAttentionBudgetCriterionRule: PolicyCriterionRule = (input) => {
  const { evidence, criterion } = input;
  const thresholdOffset = evidence.attentionBurden.thresholdOffset;
  if (thresholdOffset <= 0) {
    return noopPolicyCriterionRule("attention_budget");
  }

  return adjustCriterionRule(
    "attention_budget",
    {
      activationThreshold: criterion.activationThreshold + thresholdOffset,
      promotionMargin: criterion.promotionMargin + thresholdOffset,
    },
    ["sustained attention burden raises the interrupt bar until the operator load eases"],
  );
};
