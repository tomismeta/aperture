import { verdictPolicyGateRule, type PolicyGateRule } from "./policy-gate-rule.js";

export const evaluateInterruptiveDefaultPolicyGateRule: PolicyGateRule = () => verdictPolicyGateRule(
  "interruptive_default",
  {
    autoApprove: false,
    mayInterrupt: true,
    requiresOperatorResponse: false,
    minimumPresentation: "queue",
    rationale: ["urgent non-blocking work may compete for interruptive attention"],
  },
);
