import {
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateInterruptEligibilityCriterionRule: PolicyCriterionRule = (input) => {
  const { candidate, policyVerdict, criterion } = input;
  if (
    candidate.blocking
    || candidate.episodeState === "actionable"
    || policyVerdict.autoApprove
    || !policyVerdict.mayInterrupt
    || policyVerdict.requiresOperatorResponse
    || policyVerdict.minimumPresentation === "active"
  ) {
    return verdictPolicyCriterionRule(
      "interrupt_eligibility",
      clearCriterionVerdict(criterion),
    );
  }

  return noopPolicyCriterionRule("interrupt_eligibility");
};
