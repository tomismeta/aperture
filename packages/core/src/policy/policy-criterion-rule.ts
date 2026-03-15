import type { AttentionDecisionAmbiguity } from "../attention-ambiguity.js";
import type { AttentionEvidenceContext } from "../attention-evidence.js";
import type { AttentionCandidate } from "../interaction-candidate.js";
import type {
  AttentionInterruptCriterion,
  AttentionInterruptCriterionVerdict,
  AttentionPolicyVerdict,
} from "../attention-policy.js";

export type PolicyCriterionRuleInput = {
  candidate: AttentionCandidate;
  policyVerdict: AttentionPolicyVerdict;
  evidence: AttentionEvidenceContext;
  candidateScore: number;
  currentScore: number | null;
  criterion: AttentionInterruptCriterion;
  sourceTrustAdjustment: number;
  peripheralResolution: "queue" | "ambient";
};

export type PolicyCriterionRuleEvaluation =
  | {
      rule: string;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: string;
      kind: "adjust";
      criterion: AttentionInterruptCriterion;
      rationale: string[];
    }
  | {
      rule: string;
      kind: "verdict";
      verdict: AttentionInterruptCriterionVerdict;
      rationale: string[];
    };

export type PolicyCriterionRule = (input: PolicyCriterionRuleInput) => PolicyCriterionRuleEvaluation;

export function noopPolicyCriterionRule(
  rule: string,
  rationale: string[] = [],
): PolicyCriterionRuleEvaluation {
  return {
    rule,
    kind: "noop",
    rationale,
  };
}

export function verdictPolicyCriterionRule(
  rule: string,
  verdict: AttentionInterruptCriterionVerdict,
  rationale: string[] = verdict.rationale,
): PolicyCriterionRuleEvaluation {
  return {
    rule,
    kind: "verdict",
    verdict,
    rationale,
  };
}

export function adjustCriterionRule(
  rule: string,
  criterion: AttentionInterruptCriterion,
  rationale: string[],
): PolicyCriterionRuleEvaluation {
  return {
    rule,
    kind: "adjust",
    criterion,
    rationale,
  };
}

export function clearCriterionVerdict(
  criterion: AttentionInterruptCriterion,
): AttentionInterruptCriterionVerdict {
  return {
    criterion,
    peripheralResolution: null,
    ambiguity: null,
    rationale: [],
  };
}

export function ambiguousPeripheralCriterionVerdict(
  criterion: AttentionInterruptCriterion,
  peripheralResolution: "queue" | "ambient",
  ambiguity: AttentionDecisionAmbiguity,
  rationale: string[],
): AttentionInterruptCriterionVerdict {
  return {
    criterion,
    peripheralResolution,
    ambiguity,
    rationale,
  };
}
