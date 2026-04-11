import type { AttentionFrame } from "../frame.js";
import {
  isDormantEpisodeState,
  readFrameEpisodeId,
  readFrameEpisodeState,
} from "../episode-tracker.js";

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

  if (
    candidate.episodeId !== undefined &&
    [evidence.attentionView.now, ...evidence.attentionView.next, ...evidence.attentionView.ambient]
      .filter((frame): frame is AttentionFrame => frame !== null)
      .some(
        (frame) =>
          frame.interactionId !== candidate.interactionId &&
          readFrameEpisodeId(frame) === candidate.episodeId &&
          !isDormantEpisodeState(readFrameEpisodeState(frame)),
      )
  ) {
    return noopPolicyCriterionRule("no_active_frame");
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
