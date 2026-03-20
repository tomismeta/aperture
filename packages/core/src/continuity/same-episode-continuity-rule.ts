import { readFrameEpisodeId } from "../episode-tracker.js";
import { isBlockingFrame, priorityForFrame } from "../frame-score.js";
import { hasSemanticRelationKind } from "../semantic-relations.js";
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
      priorityForFrame(activeFrame),
      context.currentScore,
      ["the active episode has progressed into an interruptive step"],
    );
  }

  if (candidate.blocking && hasSemanticRelationKind(candidate.relationHints, "supersedes")) {
    return overrideContinuityRule(
      "same_episode",
      { kind: "activate", candidate },
      priorityForFrame(activeFrame),
      context.currentScore,
      ["the active episode has advanced to a superseding step"],
    );
  }

  return overrideContinuityRule(
    "same_episode",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    ["related work stays bundled with the active episode"],
  );
};
