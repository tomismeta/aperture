import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { priorityForFrame } from "../frame-score.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateBurstDampeningContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers, plannerDefaults } = input;
  if (!activeFrame || plannerDefaults?.batchStatusBursts === false) {
    return noopContinuityRule("burst_dampening");
  }

  if (
    activeFrame.taskId !== candidate.taskId
    || activeFrame.mode !== "status"
    || candidate.mode !== "status"
    || candidate.blocking
    || candidate.consequence === "high"
    || candidate.tone === "critical"
  ) {
    return noopContinuityRule("burst_dampening");
  }

  const currentTimestamp = Date.parse(activeFrame.timing.updatedAt);
  const candidateTimestamp = Date.parse(candidate.timestamp);
  if (Number.isNaN(currentTimestamp) || Number.isNaN(candidateTimestamp)) {
    return noopContinuityRule("burst_dampening");
  }

  if (candidateTimestamp - currentTimestamp > JUDGMENT_DEFAULTS.queuePlanner.statusBurstWindowMs) {
    return noopContinuityRule("burst_dampening");
  }

  return overrideContinuityRule(
    "burst_dampening",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    ["rapid successive updates from the same task stay bundled instead of stealing focus"],
  );
};
