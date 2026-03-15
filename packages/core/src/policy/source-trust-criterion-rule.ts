import {
  adjustCriterionRule,
  noopPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

const TRUST_CRITERION_DIVISOR = 2;
const MAX_TRUST_CRITERION_OFFSET = 6;

export const evaluateSourceTrustCriterionRule: PolicyCriterionRule = (input) => {
  const { criterion, sourceTrustAdjustment } = input;

  const trustCriterionOffset = readTrustCriterionOffset(sourceTrustAdjustment);
  if (trustCriterionOffset === 0) {
    return noopPolicyCriterionRule("source_trust");
  }

  const adjustedCriterion = {
    activationThreshold: Math.max(0, criterion.activationThreshold - trustCriterionOffset),
    promotionMargin: Math.max(0, criterion.promotionMargin - trustCriterionOffset),
  };

  const trustRationale = trustCriterionOffset > 0
    ? "durable source trust lowers the interrupt bar for this source"
    : "low-trust source signals need a clearer margin before interrupting";

  return adjustCriterionRule("source_trust", adjustedCriterion, [trustRationale]);
};

function readTrustCriterionOffset(sourceTrustAdjustment: number): number {
  if (sourceTrustAdjustment === 0) {
    return 0;
  }

  return Math.max(
    -MAX_TRUST_CRITERION_OFFSET,
    Math.min(
      MAX_TRUST_CRITERION_OFFSET,
      Math.trunc(sourceTrustAdjustment / TRUST_CRITERION_DIVISOR),
    ),
  );
}
