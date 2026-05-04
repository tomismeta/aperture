import {
  inferConfiguredPolicyToolFamily,
  matchPolicyRule,
  readAttentionLane,
} from "./configured-policy-support.js";
import {
  noopPolicyGateRule,
  verdictPolicyGateRule,
  type PolicyGateRule,
} from "./policy-gate-rule.js";

export const evaluateConfiguredPolicyGateRule: PolicyGateRule = (input) => {
  const { candidate, policyConfig, apertureProfile } = input;
  const toolFamily = inferConfiguredPolicyToolFamily(candidate);
  const toolOverride = toolFamily ? apertureProfile?.overrides?.tools?.[toolFamily] : undefined;
  const policyRule = matchPolicyRule(policyConfig, candidate);
  const requireContextExpansion =
    toolOverride?.requireContextExpansion === true || policyRule?.requireContextExpansion === true;
  const autoApprove =
    policyRule?.autoApprove === true &&
    candidate.mode === "approval" &&
    candidate.responseSpec.kind === "approval" &&
    !requireContextExpansion;

  const minimumLane =
    readAttentionLane(toolOverride?.minimumLane ?? toolOverride?.defaultPresentation) ??
    readAttentionLane(policyRule?.minimumLane) ??
    (requireContextExpansion ? "now" : undefined);
  const mayInterrupt = policyRule?.mayInterrupt;
  const requiresOperatorResponse =
    !autoApprove && (candidate.blocking || minimumLane === "now" || requireContextExpansion);

  if (minimumLane === undefined && mayInterrupt === undefined && !toolOverride && !autoApprove) {
    return noopPolicyGateRule("configured_policy");
  }

  const rationale: string[] = [];
  if (toolFamily && toolOverride) {
    rationale.push(`user override applies for ${toolFamily} interactions`);
  }
  if (policyRule) {
    rationale.push("configured judgment policy applies to this interaction");
  }

  if (autoApprove) {
    rationale.push("configured judgment policy auto-approves this bounded approval");
    return verdictPolicyGateRule("configured_policy", {
      autoApprove: true,
      mayInterrupt: false,
      requiresOperatorResponse: false,
      minimumLane: "ambient",
      minimumLaneIsSticky: true,
      rationale,
    });
  }

  if (requiresOperatorResponse) {
    rationale.push("operator-response work cannot remain passive without auto-resolution");
    return verdictPolicyGateRule("configured_policy", {
      autoApprove: false,
      mayInterrupt: true,
      requiresOperatorResponse: true,
      minimumLane: "now",
      minimumLaneIsSticky: false,
      rationale,
    });
  }

  return verdictPolicyGateRule("configured_policy", {
    autoApprove: false,
    mayInterrupt: mayInterrupt ?? false,
    requiresOperatorResponse,
    minimumLane: minimumLane ?? (candidate.blocking ? "now" : "next"),
    minimumLaneIsSticky: minimumLane !== undefined || mayInterrupt === false,
    rationale,
  });
};
