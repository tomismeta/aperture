import type { AttentionCandidate } from "../interaction-candidate.js";
import type { AttentionSurfaceCapabilities } from "../surface-capabilities.js";
import { findVisibleEpisodeFrames, isCandidateInActionableEpisode } from "../episode-tracker.js";
import type { AttentionView } from "../frame.js";
import { hasCandidateSemanticUncertainty } from "../judgment-input.js";

import {
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  preservedPeripheralCriterionVerdict,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateInterruptEligibilityCriterionRule: PolicyCriterionRule = (input) => {
  const { candidate, policyVerdict, criterion, peripheralResolution, evidence } = input;

  if (!policyVerdict.mayInterrupt && policyVerdict.minimumLaneIsSticky) {
    return verdictPolicyCriterionRule(
      "interrupt_eligibility",
      preservedPeripheralCriterionVerdict(
        criterion,
        readPreservedPeripheralResolution(
          candidate,
          peripheralResolution,
          evidence.surfaceCapabilities,
        ),
      ),
    );
  }

  if (
    candidate.blocking ||
    (isCandidateInActionableEpisode(candidate) &&
      !hasCandidateSemanticUncertainty(candidate) &&
      !hasVisibleRelatedEpisode(candidate, evidence.attentionView)) ||
    policyVerdict.autoApprove ||
    policyVerdict.requiresOperatorResponse ||
    policyVerdict.minimumLane === "now"
  ) {
    return verdictPolicyCriterionRule("interrupt_eligibility", clearCriterionVerdict(criterion));
  }

  return noopPolicyCriterionRule("interrupt_eligibility");
};

function hasVisibleRelatedEpisode(
  candidate: AttentionCandidate,
  attentionView: AttentionView,
): boolean {
  return (
    candidate.episodeId !== undefined &&
    findVisibleEpisodeFrames(attentionView, candidate.episodeId, {
      excludedInteractionId: candidate.interactionId,
    }).length > 0
  );
}

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
      return (candidate.responseSpec.selectionMode === "multiple"
        ? surfaceCapabilities.responses.supportsMultipleChoice
        : surfaceCapabilities.responses.supportsSingleChoice) &&
        (!candidate.responseSpec.allowTextResponse ||
          surfaceCapabilities.responses.supportsTextResponse)
        ? "ambient"
        : "queue";
    case "form":
      return surfaceCapabilities.responses.supportsForm ? "ambient" : "queue";
  }
}
