import { priorityForFrame } from "../frame-score.js";
import { JUDGMENT_DEFAULTS } from "../judgment-defaults.js";
import {
  noopContinuityRule,
  overrideContinuityRule,
  type ContinuityRule,
} from "./continuity-rule.js";

const INTERRUPT_CLASS = {
  STATUS_ONLY: 0,
  NON_STATUS: 1,
  CRITICAL_CONSEQUENCE: 2,
  BLOCKING_OR_REQUIRED: 3,
} as const;

export const evaluateConflictingInterruptContinuityRule: ContinuityRule = (input) => {
  const activeFrame = input.evidence.currentFrame;
  const { candidate, context, evidence, helpers, routed, plannerDefaults } = input;
  if (!activeFrame || routed.decision.kind !== "activate" || context.currentScore === null) {
    return noopContinuityRule("conflicting_interrupt");
  }

  const currentInterruptClass = interruptClassForFrame(activeFrame);
  const candidateInterruptClass = interruptClassForCandidate(candidate, context.policyVerdict);
  if (
    currentInterruptClass === INTERRUPT_CLASS.STATUS_ONLY ||
    candidateInterruptClass === INTERRUPT_CLASS.STATUS_ONLY
  ) {
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
    plannerDefaults?.conflictingInterruptMargin ??
    JUDGMENT_DEFAULTS.queuePlanner.conflictingInterruptMargin;
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
    [
      "equally interruptive work needs a clear advantage before it can replace the current interrupt",
    ],
  );
};

function interruptClassForFrame(frame: {
  tone: string;
  consequence: string;
  mode: string;
  responseSpec?: { kind: string };
}): number {
  if (frame.mode !== "status" && frame.responseSpec?.kind !== "none") {
    return INTERRUPT_CLASS.BLOCKING_OR_REQUIRED;
  }

  if (frame.tone === "critical" || frame.consequence === "high") {
    return INTERRUPT_CLASS.CRITICAL_CONSEQUENCE;
  }

  if (frame.mode !== "status") {
    return INTERRUPT_CLASS.NON_STATUS;
  }

  return INTERRUPT_CLASS.STATUS_ONLY;
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
    minimumLane: "ambient" | "next" | "now";
  },
): number {
  if (
    candidate.blocking ||
    policyVerdict.requiresOperatorResponse ||
    policyVerdict.minimumLane === "now"
  ) {
    return INTERRUPT_CLASS.BLOCKING_OR_REQUIRED;
  }

  if (candidate.tone === "critical" || candidate.consequence === "high") {
    return INTERRUPT_CLASS.CRITICAL_CONSEQUENCE;
  }

  if (candidate.mode !== "status") {
    return INTERRUPT_CLASS.NON_STATUS;
  }

  return INTERRUPT_CLASS.STATUS_ONLY;
}
