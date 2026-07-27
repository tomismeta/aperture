import {
  noopPolicyGateRule,
  verdictPolicyGateRule,
  type PolicyGateRule,
} from "./policy-gate-rule.js";
import { hasActionableBlockedLikeStatusSemantics } from "../judgment-input.js";

export const evaluatePeripheralStatusPolicyGateRule: PolicyGateRule = (input) => {
  const { candidate } = input;
  if (
    candidate.mode !== "status" ||
    candidate.consequence === "high" ||
    candidate.tone === "critical" ||
    hasActionableBlockedLikeStatusSemantics(candidate)
  ) {
    return noopPolicyGateRule("peripheral_status");
  }

  return verdictPolicyGateRule("peripheral_status", {
    autoApprove: false,
    mayInterrupt: false,
    requiresOperatorResponse: false,
    minimumLane: "ambient",
    minimumLaneIsSticky: false,
    rationale: ["non-critical status work should start in the periphery"],
  });
};
