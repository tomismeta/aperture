import {
  noopPolicyGateRule,
  verdictPolicyGateRule,
  type PolicyGateRule,
} from "./policy-gate-rule.js";
import { hasActionableBlockedLikeStatusSemantics } from "../judgment-input.js";

export const evaluateBackgroundPolicyGateRule: PolicyGateRule = (input) => {
  if (input.candidate.priority !== "background") {
    return noopPolicyGateRule("background");
  }

  if (hasActionableBlockedLikeStatusSemantics(input.candidate)) {
    return noopPolicyGateRule("background", [
      "blocked-like status semantics are concrete enough to compete with ordinary attention rules",
    ]);
  }

  return verdictPolicyGateRule("background", {
    autoApprove: false,
    mayInterrupt: false,
    requiresOperatorResponse: false,
    minimumLane: "ambient",
    minimumLaneIsSticky: true,
    rationale: ["background work should remain peripheral by default"],
  });
};
