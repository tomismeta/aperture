import type { AttentionCandidate } from "../interaction-candidate.js";
import type { AttentionSurfaceCapabilities } from "../surface-capabilities.js";

import {
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  preservedPeripheralCriterionVerdict,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateInterruptEligibilityCriterionRule: PolicyCriterionRule = (input) => {
  const {
    candidate,
    policyVerdict,
    criterion,
    peripheralResolution,
    evidence,
  } = input;

  if (!policyVerdict.mayInterrupt && policyVerdict.minimumPresentationIsSticky) {
    return verdictPolicyCriterionRule(
      "interrupt_eligibility",
      preservedPeripheralCriterionVerdict(
        criterion,
        readPreservedPeripheralResolution(candidate, peripheralResolution, evidence.surfaceCapabilities),
      ),
    );
  }

  if (
    candidate.blocking
    || candidate.episodeState === "actionable"
    || policyVerdict.autoApprove
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

function readPreservedPeripheralResolution(
  candidate: AttentionCandidate,
  peripheralResolution: "queue" | "ambient",
  surfaceCapabilities: AttentionSurfaceCapabilities,
): "queue" | "ambient" {
  if (peripheralResolution !== "ambient" || !surfaceCapabilities.topology.supportsAmbient) {
    return "queue";
  }

  switch (candidate.responseSpec.kind) {
    case "approval":
    case "acknowledge":
    case "none":
      return "ambient";
    case "choice":
      return (
        (candidate.responseSpec.selectionMode === "multiple"
          ? surfaceCapabilities.responses.supportsMultipleChoice
          : surfaceCapabilities.responses.supportsSingleChoice)
        && (!candidate.responseSpec.allowTextResponse || surfaceCapabilities.responses.supportsTextResponse)
      )
        ? "ambient"
        : "queue";
    case "form":
      return surfaceCapabilities.responses.supportsForm ? "ambient" : "queue";
  }
}
