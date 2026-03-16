import { verdictPolicyGateRule, type PolicyGateRule } from "./policy-gate-rule.js";

export const evaluateInterruptiveDefaultPolicyGateRule: PolicyGateRule = () => verdictPolicyGateRule(
  "interruptive_default",
  {
    autoApprove: false,
    mayInterrupt: true,
    requiresOperatorResponse: false,
    minimumPresentation: "queue",
    minimumPresentationIsSticky: false,
    rationale: ["urgent non-blocking work may compete for interruptive attention"],
  },
);
