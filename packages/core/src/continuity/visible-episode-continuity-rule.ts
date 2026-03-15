import type { AttentionFrame } from "../frame.js";
import { readFrameEpisodeId } from "../episode-tracker.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateVisibleEpisodeContinuityRule: ContinuityRule = (input) => {
  const { candidate, context, evidence, helpers } = input;
  if (!candidate.episodeId) {
    return noopContinuityRule("visible_episode");
  }

  if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
    return noopContinuityRule("visible_episode");
  }

  const visibleRelatedFrames = [
    evidence.attentionView.active,
    ...evidence.attentionView.queued,
    ...evidence.attentionView.ambient,
  ]
    .filter((frame): frame is AttentionFrame => frame !== null)
    .filter((frame) => frame.interactionId !== candidate.interactionId && readFrameEpisodeId(frame) === candidate.episodeId);

  if (
    visibleRelatedFrames.length === 0
    || !(candidate.episodeState === "batched" || (candidate.episodeSize ?? 1) >= 2 || visibleRelatedFrames.length >= 2)
  ) {
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
