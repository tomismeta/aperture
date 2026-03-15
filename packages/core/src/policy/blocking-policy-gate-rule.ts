import { noopPolicyGateRule, verdictPolicyGateRule, type PolicyGateRule } from "./policy-gate-rule.js";

export const evaluateBlockingPolicyGateRule: PolicyGateRule = (input) => {
  if (!input.candidate.blocking) {
    return noopPolicyGateRule("blocking");
  }

  return verdictPolicyGateRule(
    "blocking",
    {
      autoApprove: false,
      mayInterrupt: true,
      requiresOperatorResponse: true,
      minimumPresentation: "active",
      rationale: ["blocking interactions require explicit operator attention"],
    },
  );
};
