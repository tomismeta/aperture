import type { AttentionCandidate } from "../interaction-candidate.js";
import type { JudgmentConfig } from "../judgment-config.js";
import type { UserProfile } from "../profile-store.js";
import type { AttentionPolicyVerdict } from "../attention-policy.js";

export type PolicyGateRuleInput = {
  candidate: AttentionCandidate;
  judgmentConfig?: JudgmentConfig;
  userProfile?: UserProfile;
};

export type PolicyGateRuleEvaluation =
  | {
      rule: string;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: string;
      kind: "verdict";
      verdict: AttentionPolicyVerdict;
      rationale: string[];
    };

export type PolicyGateRule = (input: PolicyGateRuleInput) => PolicyGateRuleEvaluation;

export function noopPolicyGateRule(rule: string, rationale: string[] = []): PolicyGateRuleEvaluation {
  return {
    rule,
    kind: "noop",
    rationale,
  };
}

export function verdictPolicyGateRule(
  rule: string,
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
