import {
  noopPolicyGateRule,
  verdictPolicyGateRule,
  type PolicyGateRule,
} from "./policy-gate-rule.js";
import {
  hasActionableBlockedLikeStatusSemantics,
  hasObservationalStatusConflictSemantics,
} from "../judgment-input.js";
import { isSoftenedFailureStatusCandidate } from "./peripheral-status-candidate.js";

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

  const requiresOperatorResponse = candidate.responseSpec.kind !== "none";
  if (requiresOperatorResponse) {
    if (!isSoftenedFailureStatusCandidate(candidate)) {
      return verdictPolicyGateRule("peripheral_status", {
        autoApprove: false,
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumLane: "ambient",
        minimumLaneIsSticky: false,
        rationale: hasObservationalStatusConflictSemantics(candidate)
          ? ["observational status-conflict work should preserve peripheral routing"]
          : ["non-critical status work should start in the periphery"],
      });
    }

    return verdictPolicyGateRule("peripheral_status", {
      autoApprove: false,
      mayInterrupt: false,
      requiresOperatorResponse: false,
      minimumLane: "next",
      minimumLaneIsSticky: false,
      rationale: ["non-critical status work that requires acknowledgement should stay visible"],
    });
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
