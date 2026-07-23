import {
  ambiguousPeripheralCriterionVerdict,
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";
import { isCandidateInActionableEpisode } from "../episode-tracker.js";

export const evaluateSmallScoreGapCriterionRule: PolicyCriterionRule = (input) => {
  const { candidate, candidateScore, currentScore, criterion, peripheralResolution } = input;

  if (isCandidateInActionableEpisode(candidate)) {
    return noopPolicyCriterionRule("small_score_gap");
  }

  if (currentScore === null || candidateScore <= currentScore) {
    return verdictPolicyCriterionRule("small_score_gap", clearCriterionVerdict(criterion));
  }

  if (candidateScore >= currentScore + criterion.promotionMargin) {
    return verdictPolicyCriterionRule("small_score_gap", clearCriterionVerdict(criterion));
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
