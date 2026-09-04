import type { AttentionCandidate } from "../interaction-candidate.js";
import type { PolicyConfig } from "../policy-config.js";
import type { ApertureProfile } from "../profile-store.js";
import type { AttentionPolicyVerdict } from "../attention-policy.js";

export type PolicyGateRuleName =
  | "configured_policy"
  | "blocking"
  | "result_ready"
  | "background"
  | "peripheral_status"
  | "interruptive_default";

export type PolicyGateRuleInput = {
  candidate: AttentionCandidate;
  policyConfig?: PolicyConfig;
  apertureProfile?: ApertureProfile;
};

export type PolicyGateRuleEvaluation =
  | {
      rule: PolicyGateRuleName;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: PolicyGateRuleName;
      kind: "verdict";
      verdict: AttentionPolicyVerdict;
      rationale: string[];
    };

export type PolicyGateRule = (input: PolicyGateRuleInput) => PolicyGateRuleEvaluation;

export function noopPolicyGateRule(
  rule: PolicyGateRuleName,
  rationale: string[] = [],
): PolicyGateRuleEvaluation {
  return {
    rule,
    kind: "noop",
    rationale,
  };
}

export function verdictPolicyGateRule(
  rule: PolicyGateRuleName,
  verdict: AttentionPolicyVerdict,
  rationale: string[] = verdict.rationale,
): PolicyGateRuleEvaluation {
  return {
    rule,
    kind: "verdict",
    verdict,
    rationale,
  };
}
