import {
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateOperatorAbsenceCriterionRule: PolicyCriterionRule = (input) => {
  const { evidence, criterion, peripheralResolution } = input;
  if (evidence.operatorPresence !== "absent") {
    return noopPolicyCriterionRule("operator_absence");
  }

  return verdictPolicyCriterionRule(
    "operator_absence",
    {
      criterion,
      peripheralResolution,
      ambiguity: null,
      rationale: ["operator absence keeps interruptive work peripheral until active attention returns"],
    },
  );
};
