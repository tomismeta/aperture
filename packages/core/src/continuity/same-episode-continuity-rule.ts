import { readFrameEpisodeId } from "../episode-tracker.js";
import { isBlockingFrame } from "../frame-score.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateSameEpisodeContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers } = input;
  if (!activeFrame || !candidate.episodeId) {
    return noopContinuityRule("same_episode");
  }

  const currentEpisodeId = readFrameEpisodeId(activeFrame);
  if (!currentEpisodeId || currentEpisodeId !== candidate.episodeId) {
    return noopContinuityRule("same_episode");
  }

  if (candidate.blocking && !isBlockingFrame(activeFrame)) {
    return overrideContinuityRule(
      "same_episode",
      { kind: "activate", candidate },
      null,
      null,
      ["the active episode has progressed into an interruptive step"],
    );
  }

  return overrideContinuityRule(
    "same_episode",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    null,
    null,
    ["related work stays bundled with the active episode"],
  );
};
