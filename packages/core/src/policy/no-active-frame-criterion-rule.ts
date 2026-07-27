import { findVisibleEpisodeFrames, isCandidateInActionableEpisode } from "../episode-tracker.js";
import { hasActionableBlockedLikeStatusSemantics } from "../judgment-input.js";

import {
  ambiguousPeripheralCriterionVerdict,
  clearCriterionVerdict,
  noopPolicyCriterionRule,
  verdictPolicyCriterionRule,
  type PolicyCriterionRule,
} from "./policy-criterion-rule.js";

export const evaluateNoActiveFrameCriterionRule: PolicyCriterionRule = (input) => {
  const { candidate, evidence, candidateScore, criterion, peripheralResolution } = input;
  if (evidence.currentFrame) {
    return noopPolicyCriterionRule("no_active_frame");
  }

  if (isCandidateInActionableEpisode(candidate)) {
    return noopPolicyCriterionRule("no_active_frame");
  }

  if (
    candidate.episodeId !== undefined &&
    findVisibleEpisodeFrames(evidence.attentionView, candidate.episodeId, {
      excludedInteractionId: candidate.interactionId,
    }).length > 0
  ) {
    return noopPolicyCriterionRule("no_active_frame");
  }

  if (hasActionableBlockedLikeStatusSemantics(candidate)) {
    return verdictPolicyCriterionRule(
      "no_active_frame",
      clearCriterionVerdict(criterion, [
        "blocked-like status semantics are concrete enough to fill an empty attention slot",
      ]),
    );
  }

  if (candidateScore >= criterion.activationThreshold) {
    return verdictPolicyCriterionRule("no_active_frame", clearCriterionVerdict(criterion));
  }

  return verdictPolicyCriterionRule(
    "no_active_frame",
    ambiguousPeripheralCriterionVerdict(
      criterion,
      peripheralResolution,
      {
        kind: "interrupt",
        reason: "low_signal",
        resolution: peripheralResolution,
      },
      ["uncertain interruptive work stays peripheral until its signal is stronger"],
    ),
  );
};
