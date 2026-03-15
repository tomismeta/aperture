import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { priorityForFrame } from "../frame-score.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateMinimumDwellContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers, routed, plannerDefaults } = input;
  if (!activeFrame || routed.decision.kind !== "activate") {
    return noopContinuityRule("minimum_dwell");
  }

  if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
    return noopContinuityRule("minimum_dwell");
  }

  const minimumDwellMs = plannerDefaults?.minimumDwellMs ?? JUDGMENT_DEFAULTS.queuePlanner.minimumDwellMs;
  if (minimumDwellMs <= 0) {
    return noopContinuityRule("minimum_dwell");
  }

  const activeTimestamp = Date.parse(activeFrame.timing.updatedAt);
  const candidateTimestamp = Date.parse(candidate.timestamp);
  if (Number.isNaN(activeTimestamp) || Number.isNaN(candidateTimestamp)) {
    return noopContinuityRule("minimum_dwell");
  }

  if (candidateTimestamp - activeTimestamp >= minimumDwellMs) {
    return noopContinuityRule("minimum_dwell");
  }

  return overrideContinuityRule(
    "minimum_dwell",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    ["recently surfaced work keeps focus long enough to avoid a premature switch"],
  );
};
