import { inferToolFamily } from "../interaction-taxonomy.js";
import { matchPolicyRule, readAttentionPresentationFloor } from "./configured-policy-support.js";
import { noopPolicyGateRule, verdictPolicyGateRule, type PolicyGateRule } from "./policy-gate-rule.js";

export const evaluateConfiguredPolicyGateRule: PolicyGateRule = (input) => {
  const { candidate, judgmentConfig, userProfile } = input;
  const toolFamily = inferToolFamily(candidate);
  const toolOverride = toolFamily
    ? userProfile?.overrides?.tools?.[toolFamily]
    : undefined;
  const policyRule = matchPolicyRule(judgmentConfig, candidate);
  const requireContextExpansion =
    toolOverride?.requireContextExpansion === true
    || policyRule?.requireContextExpansion === true;
  const autoApprove =
    policyRule?.autoApprove === true
    && candidate.mode === "approval"
    && candidate.responseSpec.kind === "approval"
    && !requireContextExpansion;

  const minimumPresentation = readAttentionPresentationFloor(toolOverride?.defaultPresentation)
    ?? policyRule?.minimumPresentation
    ?? (requireContextExpansion ? "active" : undefined);
  const mayInterrupt = policyRule?.mayInterrupt;
  const requiresOperatorResponse =
    !autoApprove
    && (
      candidate.blocking
      || minimumPresentation === "active"
      || requireContextExpansion
    );

  if (
    minimumPresentation === undefined
    && mayInterrupt === undefined
    && !toolOverride
    && !autoApprove
  ) {
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
    return verdictPolicyGateRule(
      "configured_policy",
      {
        autoApprove: true,
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumPresentation: "ambient",
        rationale,
      },
    );
  }

  if (requiresOperatorResponse) {
    rationale.push("operator-response work cannot remain passive without auto-resolution");
    return verdictPolicyGateRule(
      "configured_policy",
      {
        autoApprove: false,
        mayInterrupt: true,
        requiresOperatorResponse: true,
        minimumPresentation: "active",
        rationale,
      },
    );
  }

  return verdictPolicyGateRule(
    "configured_policy",
    {
      autoApprove: false,
      mayInterrupt: mayInterrupt ?? false,
      requiresOperatorResponse,
      minimumPresentation: minimumPresentation ?? (candidate.blocking ? "active" : "queue"),
      rationale,
    },
  );
};
