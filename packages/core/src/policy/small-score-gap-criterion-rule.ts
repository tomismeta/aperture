import {
  ambiguousPeripheralCriterionVerdict,
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateSmallScoreGapCriterionRule: PolicyCriterionRule = (input) => {
  const {
    candidateScore,
    currentScore,
    criterion,
    peripheralResolution,
  } = input;

  if (currentScore === null || candidateScore <= currentScore) {
    return verdictPolicyCriterionRule(
      "small_score_gap",
      clearCriterionVerdict(criterion),
    );
  }

  if (candidateScore >= currentScore + criterion.promotionMargin) {
    return verdictPolicyCriterionRule(
      "small_score_gap",
      clearCriterionVerdict(criterion),
    );
  }

  return verdictPolicyCriterionRule(
    "small_score_gap",
    ambiguousPeripheralCriterionVerdict(
      criterion,
      peripheralResolution,
      {
        kind: "interrupt",
        reason: "small_score_gap",
        resolution: peripheralResolution,
      },
      ["small score gaps resolve to the periphery instead of stealing focus immediately"],
    ),
  );
};
