import {
  isCandidateSemanticAbstained,
  readCandidateSemanticConfidence,
  readCandidateSemanticEvidence,
  readSemanticEvidenceStrength,
} from "../judgment-input.js";
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

  if (isCandidateSemanticAbstained(candidate)) {
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

  if (readCandidateSemanticConfidence(candidate) === "low") {
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

  if (readSemanticEvidenceStrength(candidate) === "weak") {
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
        ["inferred semantic evidence stays peripheral until stronger source-backed context arrives"],
      ),
    );
  }

  return noopPolicyCriterionRule(
    "semantic_uncertainty",
    readCandidateSemanticEvidence(candidate) !== null
      ? ["semantic evidence is strong enough to keep ordinary interrupt rules in play"]
      : [],
  );
};
