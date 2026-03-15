import {
  ambiguousPeripheralCriterionVerdict,
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

const TRUST_CRITERION_DIVISOR = 2;
const MAX_TRUST_CRITERION_OFFSET = 6;

export const evaluateSourceTrustCriterionRule: PolicyCriterionRule = (input) => {
  const {
    candidateScore,
    currentScore,
    criterion,
    peripheralResolution,
    sourceTrustAdjustment,
    evidence,
  } = input;

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

  if (!evidence.currentFrame) {
    if (candidateScore >= adjustedCriterion.activationThreshold) {
      return verdictPolicyCriterionRule(
        "source_trust",
        {
          ...clearCriterionVerdict(adjustedCriterion),
          rationale: [trustRationale],
        },
      );
    }

    return verdictPolicyCriterionRule(
      "source_trust",
      ambiguousPeripheralCriterionVerdict(
        adjustedCriterion,
        peripheralResolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution: peripheralResolution,
        },
        [trustRationale],
      ),
    );
  }

  if (currentScore === null || candidateScore <= currentScore) {
    return noopPolicyCriterionRule("source_trust");
  }

  if (candidateScore >= currentScore + adjustedCriterion.promotionMargin) {
    return verdictPolicyCriterionRule(
      "source_trust",
      {
        ...clearCriterionVerdict(adjustedCriterion),
        rationale: [trustRationale],
      },
    );
  }

  return verdictPolicyCriterionRule(
    "source_trust",
    ambiguousPeripheralCriterionVerdict(
      adjustedCriterion,
      peripheralResolution,
      {
        kind: "interrupt",
        reason: "small_score_gap",
        resolution: peripheralResolution,
      },
      [trustRationale],
    ),
  );
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
