import { noopPolicyGateRule, verdictPolicyGateRule, type PolicyGateRule } from "./policy-gate-rule.js";

export const evaluateBackgroundPolicyGateRule: PolicyGateRule = (input) => {
  if (input.candidate.priority !== "background") {
    return noopPolicyGateRule("background");
  }

  return verdictPolicyGateRule(
    "background",
    {
      autoApprove: false,
      mayInterrupt: false,
      requiresOperatorResponse: false,
      minimumPresentation: "ambient",
      minimumPresentationIsSticky: true,
      rationale: ["background work should remain peripheral by default"],
    },
  );
};
