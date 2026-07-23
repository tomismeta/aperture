import { findVisibleEpisodeFrames, isLiveEpisodeFrame } from "../episode-tracker.js";
import { hasResurfacingPressure } from "./deferral-escalation-continuity-rule.js";
import {
  noopContinuityRule,
  overrideContinuityRule,
  type ContinuityRule,
} from "./continuity-rule.js";

export const evaluateVisibleEpisodeContinuityRule: ContinuityRule = (input) => {
  const { candidate, context, evidence, helpers } = input;
  if (!candidate.episodeId) {
    return noopContinuityRule("visible_episode");
  }

  if (
    candidate.blocking ||
    (candidate.mode !== "status" &&
      (candidate.tone === "critical" || candidate.consequence === "high"))
  ) {
    return noopContinuityRule("visible_episode");
  }

  const visibleRelatedFrames = findVisibleEpisodeFrames(
    evidence.attentionView,
    candidate.episodeId,
    { excludedInteractionId: candidate.interactionId },
  );
  const hasRelatedNowFrame =
    evidence.attentionView.now !== null &&
    isLiveEpisodeFrame(evidence.attentionView.now, candidate.episodeId, candidate.interactionId);

  if (
    candidate.mode === "status" &&
    (candidate.tone === "critical" || candidate.consequence === "high") &&
    !hasRelatedNowFrame
  ) {
    return noopContinuityRule("visible_episode");
  }

  if (
    visibleRelatedFrames.length === 0 ||
    !(
      candidate.episodeState === "batched" ||
      (candidate.episodeSize ?? 1) >= 2 ||
      visibleRelatedFrames.length >= 2
    )
  ) {
    return noopContinuityRule("visible_episode");
  }

  if (hasResurfacingPressure(evidence.continuitySignalSummary)) {
    return noopContinuityRule("visible_episode");
  }

  return overrideContinuityRule(
    "visible_episode",
    helpers.batchedDecision(
      candidate,
      context.policyVerdict,
      evidence.attentionView,
      evidence.surfaceCapabilities,
    ),
    null,
    evidence.currentFrame ? context.currentScore : null,
    [
      evidence.currentFrame
        ? "related episode work is already building in the queue, so this interaction stays bundled with it"
        : "related episode work is already visible, so this interaction batches with it instead of interrupting",
    ],
  );
};
