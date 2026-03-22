import {
  ambiguousPeripheralCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateSemanticUncertaintyCriterionRule: PolicyCriterionRule = (input) => {
  const {
    candidate,
    criterion,
    peripheralResolution,
  } = input;

  if (candidate.blocking) {
    return noopPolicyCriterionRule("semantic_uncertainty");
  }

  if (candidate.semanticAbstained === true) {
    return verdictPolicyCriterionRule(
      "semantic_uncertainty",
      ambiguousPeripheralCriterionVerdict(
        criterion,
        peripheralResolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution: peripheralResolution,
        },
        ["semantic interpretation abstained, so non-blocking work stays peripheral until stronger explicit evidence arrives"],
      ),
    );
  }

  if (candidate.semanticConfidence === "low") {
    return verdictPolicyCriterionRule(
      "semantic_uncertainty",
      ambiguousPeripheralCriterionVerdict(
        criterion,
        peripheralResolution,
        {
          kind: "interrupt",
          reason: "low_signal",
          resolution: peripheralResolution,
        },
        ["low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer"],
      ),
    );
  }

  return noopPolicyCriterionRule(
    "semantic_uncertainty",
    candidate.semanticConfidence !== undefined ? ["semantic confidence is strong enough to keep ordinary interrupt rules in play"] : [],
  );
};
