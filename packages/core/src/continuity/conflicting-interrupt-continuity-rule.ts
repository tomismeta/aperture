import { priorityForFrame } from "../frame-score.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import { noopContinuityRule, overrideContinuityRule, type ContinuityRule } from "./continuity-rule.js";

export const evaluateConflictingInterruptContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers, routed, plannerDefaults } = input;
  if (!activeFrame || routed.decision.kind !== "activate" || context.currentScore === null) {
    return noopContinuityRule("conflicting_interrupt");
  }

  const currentInterruptClass = interruptClassForFrame(activeFrame);
  const candidateInterruptClass = interruptClassForCandidate(candidate, context.policyVerdict);
  if (currentInterruptClass === 0 || candidateInterruptClass === 0) {
    return noopContinuityRule("conflicting_interrupt");
  }

  if (candidateInterruptClass > currentInterruptClass) {
    return noopContinuityRule("conflicting_interrupt");
  }

  if (candidateInterruptClass < currentInterruptClass) {
    return overrideContinuityRule(
      "conflicting_interrupt",
      helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
      priorityForFrame(activeFrame),
      context.currentScore,
      ["the current interrupt is more urgent, so the challenger waits instead of stealing focus"],
    );
  }

  const conflictingInterruptMargin =
    plannerDefaults?.conflictingInterruptMargin
    ?? JUDGMENT_DEFAULTS.queuePlanner.conflictingInterruptMargin;
  if (conflictingInterruptMargin <= 0) {
    return noopContinuityRule("conflicting_interrupt");
  }

  if (context.candidateScore >= context.currentScore + conflictingInterruptMargin) {
    return noopContinuityRule("conflicting_interrupt");
  }

  return overrideContinuityRule(
    "conflicting_interrupt",
    helpers.peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
    priorityForFrame(activeFrame),
    context.currentScore,
    ["equally interruptive work needs a clear advantage before it can replace the current interrupt"],
  );
};

function interruptClassForFrame(frame: {
  tone: string;
  consequence: string;
  mode: string;
  responseSpec?: { kind: string };
}): number {
  if (frame.mode !== "status" && frame.responseSpec?.kind !== "none") {
    return 3;
  }

  if (frame.tone === "critical" || frame.consequence === "high") {
    return 2;
  }

  if (frame.mode !== "status") {
    return 1;
  }

  return 0;
}

function interruptClassForCandidate(
  candidate: {
    blocking: boolean;
    mode: string;
    responseSpec: { kind: string };
    tone: string;
    consequence: string;
  },
  policyVerdict: {
    requiresOperatorResponse: boolean;
    minimumPresentation: "ambient" | "queue" | "active";
  },
): number {
  if (candidate.blocking || policyVerdict.requiresOperatorResponse || policyVerdict.minimumPresentation === "active") {
    return 3;
  }

  if (candidate.tone === "critical" || candidate.consequence === "high") {
    return 2;
  }

  if (candidate.mode !== "status" && candidate.responseSpec.kind !== "none") {
    return 1;
  }

  return 0;
}
