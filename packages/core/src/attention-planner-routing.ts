import type { AttentionFrame, AttentionView } from "./frame.js";

import { findVisibleEpisodeFrames, isCandidateInActionableEpisode } from "./episode-tracker.js";
import { isBlockingFrame, priorityForFrame } from "./frame-score.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { PlannerDefaults } from "./policy-config.js";
import type { AttentionPolicyVerdict } from "./attention-policy.js";
import type { AttentionPressure } from "./attention-pressure.js";
import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
import { diffTimestamps } from "./time.js";
import type { AttentionValueBreakdown } from "./attention-value.js";
import {
  hasBlockedLikeStatusSemantics,
  resolvePeripheralResolutionFloor,
} from "./judgment-input.js";
import { hasSemanticRelationKind } from "./semantic-relations.js";
import { hasResurfacingPressure } from "./continuity/deferral-escalation-continuity-rule.js";
import type {
  AttentionPlanDecision,
  AttentionPlanningContext,
  AttentionPlanningExplanation,
} from "./attention-planner.js";
import type { AttentionEvidenceContext } from "./attention-evidence.js";

const DEFAULTS = JUDGMENT_DEFAULTS.queuePlanner;

export function routeCandidate(
  candidate: AttentionCandidate,
  context: AttentionPlanningContext,
  evidence: AttentionEvidenceContext,
  plannerDefaults: PlannerDefaults | undefined,
): AttentionPlanningExplanation {
  return evidence.currentFrame
    ? routeAgainstActiveFrame(evidence.currentFrame, candidate, context, evidence, plannerDefaults)
    : routeWithoutActiveFrame(candidate, context, evidence);
}

export function peripheralDecision(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  surfaceCapabilities?: AttentionSurfaceCapabilities,
): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
  return {
    kind: selectPeripheralBucket(candidate, policyVerdict, surfaceCapabilities),
    candidate,
  };
}

export function batchedDecision(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  attentionView: AttentionView | undefined,
  surfaceCapabilities?: AttentionSurfaceCapabilities,
): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
  if (hasVisibleInterruptiveEpisode(candidate, attentionView)) {
    return { kind: "queue", candidate };
  }

  return peripheralDecision(candidate, policyVerdict, surfaceCapabilities);
}

export function suppressedDecision(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  utility: AttentionValueBreakdown,
  surfaceCapabilities?: AttentionSurfaceCapabilities,
): Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }> {
  if (
    (utility.components.deferralAffinity > 0 || utility.components.consequenceCalibration > 0) &&
    policyVerdict.minimumLane !== "now"
  ) {
    return { kind: "queue", candidate };
  }

  return peripheralDecision(candidate, policyVerdict, surfaceCapabilities);
}

export function selectPeripheralBucket(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  surfaceCapabilities: AttentionSurfaceCapabilities = baseAttentionSurfaceCapabilities,
): "queue" | "ambient" {
  if (
    resolvePeripheralResolutionFloor(
      candidate,
      policyVerdict.minimumLane === "ambient" ? "ambient" : "queue",
    ) === "ambient" &&
    canRemainAmbientOnSurface(candidate, surfaceCapabilities)
  ) {
    return "ambient";
  }

  return "queue";
}

export function canRemainAmbientOnSurface(
  candidate: AttentionCandidate,
  surfaceCapabilities: AttentionSurfaceCapabilities,
): boolean {
  if (!surfaceCapabilities.topology.supportsAmbient) {
    return false;
  }

  switch (candidate.responseSpec.kind) {
    case "approval":
      return true;
    case "choice":
      return (
        (candidate.responseSpec.selectionMode === "multiple"
          ? surfaceCapabilities.responses.supportsMultipleChoice
          : surfaceCapabilities.responses.supportsSingleChoice) &&
        (!candidate.responseSpec.allowTextResponse ||
          surfaceCapabilities.responses.supportsTextResponse)
      );
    case "form":
      return surfaceCapabilities.responses.supportsForm;
    case "none":
      return true;
  }

  return false;
}

function routeWithoutActiveFrame(
  candidate: AttentionCandidate,
  context: AttentionPlanningContext,
  evidence: AttentionEvidenceContext,
): AttentionPlanningExplanation {
  const reasons: string[] = [];
  const actionableEpisode = isActionableEpisode(candidate);

  if (actionableEpisode) {
    if (evidence.pressureForecast.overloadRisk === "high") {
      reasons.push(
        "the episode has become actionable, but predicted overload keeps it in next instead of surfacing it now",
      );
      return explainDecision({ kind: "queue", candidate }, reasons);
    }

    if (context.policyVerdict.mayInterrupt) {
      reasons.push("the episode has accumulated enough evidence to deserve interruptive attention");
      return explainDecision({ kind: "activate", candidate }, reasons);
    }

    reasons.push(
      "the episode has become actionable, so it stays visible even though policy still prevents interrupting",
    );
    return explainDecision({ kind: "queue", candidate }, reasons);
  }

  if (shouldPreemptForPressure(candidate, context.policyVerdict, evidence.pressureForecast)) {
    reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
    return explainDecision(
      suppressedDecision(
        candidate,
        context.policyVerdict,
        context.utility,
        evidence.surfaceCapabilities,
      ),
      reasons,
    );
  }

  if (!context.policyVerdict.mayInterrupt && context.policyVerdict.minimumLane === "ambient") {
    if (hasBlockedLikeStatusSemantics(candidate)) {
      reasons.push(
        "status routing stays non-blocking, but blocked-like semantics keep it visible in next",
      );
      return explainDecision({ kind: "queue", candidate }, reasons);
    }

    reasons.push("policy keeps this interaction ambient until stronger context arrives");
    return explainDecision(
      peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
      reasons,
    );
  }

  reasons.push("nothing is in now for this task");
  return explainDecision({ kind: "activate", candidate }, reasons);
}

function routeAgainstActiveFrame(
  activeFrame: AttentionFrame,
  candidate: AttentionCandidate,
  context: AttentionPlanningContext,
  evidence: AttentionEvidenceContext,
  plannerDefaults: PlannerDefaults | undefined,
): AttentionPlanningExplanation {
  const reasons: string[] = [];
  const actionableEpisode = isActionableEpisode(candidate);
  const currentBlocking = isBlockingFrame(activeFrame);
  const currentPriority = priorityForFrame(activeFrame);
  const currentScore = context.currentScore;

  if (actionableEpisode) {
    if (currentBlocking || evidence.pressureForecast.overloadRisk === "high") {
      reasons.push(
        currentBlocking
          ? "the episode has become actionable, but current blocking work keeps it in next"
          : "the episode has become actionable, but predicted overload keeps it in next",
      );
      return explainDecision({ kind: "queue", candidate }, reasons, currentPriority, currentScore);
    }

    if (
      currentScore !== null &&
      context.candidateScore < currentScore - DEFAULTS.actionableEpisodeScoreSlack
    ) {
      reasons.push(
        "actionable episode evidence keeps this work visible even though the current frame is still stronger",
      );
      return explainDecision({ kind: "queue", candidate }, reasons, currentPriority, currentScore);
    }

    if (context.policyVerdict.mayInterrupt) {
      reasons.push("the episode has accumulated enough evidence to compete for current focus");
      return explainDecision(
        { kind: "activate", candidate },
        reasons,
        currentPriority,
        currentScore,
      );
    }

    reasons.push(
      "the episode has become actionable, so it stays in next even though policy still prevents interrupting",
    );
    return explainDecision({ kind: "queue", candidate }, reasons, currentPriority, currentScore);
  }

  if (currentBlocking && !candidate.blocking) {
    if (hasResurfacingPressure(evidence.continuitySignalSummary)) {
      reasons.push(
        "blocking work keeps resurfacing backlog in next so it stays visible until focus can return",
      );
      return explainDecision({ kind: "queue", candidate }, reasons, currentPriority, currentScore);
    }

    reasons.push("blocking work keeps non-blocking updates in the periphery");
    return explainDecision(
      peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
      reasons,
    );
  }

  if (!currentBlocking && candidate.blocking) {
    reasons.push("blocking work interrupts non-blocking activity");
    return explainDecision({ kind: "activate", candidate }, reasons);
  }

  if (shouldPreemptForPressure(candidate, context.policyVerdict, evidence.pressureForecast)) {
    reasons.push("predicted overload keeps lower-value work peripheral before the queue spikes");
    return explainDecision(
      suppressedDecision(
        candidate,
        context.policyVerdict,
        context.utility,
        evidence.surfaceCapabilities,
      ),
      reasons,
      currentPriority,
      currentScore,
    );
  }

  if (
    shouldSuppressForBacklog(
      candidate,
      evidence.attentionView,
      context.referenceTimestamp ?? candidate.timestamp,
      plannerDefaults,
    )
  ) {
    if (hasResurfacingPressure(evidence.continuitySignalSummary)) {
      reasons.push("existing urgent backlog keeps resurfacing work in next so it remains visible");
      return explainDecision({ kind: "queue", candidate }, reasons, currentPriority, currentScore);
    }

    reasons.push(
      context.utility.components.deferralAffinity > 0
        ? "existing urgent backlog defers this work, but memory keeps it in next because it usually returns after deferral"
        : "existing urgent backlog keeps lower-value status work in next",
    );
    return explainDecision(
      suppressedDecision(
        candidate,
        context.policyVerdict,
        context.utility,
        evidence.surfaceCapabilities,
      ),
      reasons,
      currentPriority,
      currentScore,
    );
  }

  if (currentScore !== null && context.candidateScore < currentScore) {
    reasons.push("current work still outranks the new candidate");
    return explainDecision(
      peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
      reasons,
      currentPriority,
      currentScore,
    );
  }

  if (currentScore !== null && context.candidateScore === currentScore) {
    const freshnessDeltaMs = diffTimestamps(candidate.timestamp, activeFrame.timing.updatedAt);
    if (freshnessDeltaMs !== null && freshnessDeltaMs < 0) {
      reasons.push("older work yields when scores tie");
      return explainDecision(
        peripheralDecision(candidate, context.policyVerdict, evidence.surfaceCapabilities),
        reasons,
        currentPriority,
        currentScore,
      );
    }
  }

  reasons.push("new work outranks the current frame");
  return explainDecision({ kind: "activate", candidate }, reasons, currentPriority, currentScore);
}

function explainDecision(
  decision: AttentionPlanDecision,
  reasons: string[],
  currentPriority: AttentionPlanningExplanation["currentPriority"] = null,
  currentScore: number | null = null,
): AttentionPlanningExplanation {
  return {
    decision,
    currentPriority,
    currentScore,
    reasons,
  };
}

function shouldSuppressForBacklog(
  candidate: AttentionCandidate,
  attentionView: AttentionView | undefined,
  now: string,
  plannerDefaults: PlannerDefaults | undefined,
): boolean {
  if (plannerDefaults?.deferLowValueDuringPressure === false) {
    return false;
  }

  if (candidate.blocking || candidate.consequence === "high" || candidate.tone === "critical") {
    return false;
  }

  if (!attentionView) {
    return false;
  }

  if (hasVisibleInterruptiveEpisode(candidate, attentionView)) {
    return true;
  }

  const urgentBacklog = [attentionView.now, ...attentionView.next]
    .filter((frame): frame is AttentionFrame => frame !== null)
    .filter((frame) => {
      if (frame.interactionId === candidate.interactionId) {
        return false;
      }
      return isBlockingFrame(frame) || frame.consequence === "high" || frame.tone === "critical";
    })
    .filter((frame) => {
      const ageMs = diffTimestamps(now, frame.timing.updatedAt);
      return ageMs === null ? true : ageMs <= DEFAULTS.urgentBacklogWindowMs;
    }).length;

  return urgentBacklog >= 2;
}

function shouldPreemptForPressure(
  candidate: AttentionCandidate,
  policyVerdict: AttentionPolicyVerdict,
  pressureForecast: AttentionPressure,
): boolean {
  if (pressureForecast.overloadRisk === "low") {
    return false;
  }

  if (
    candidate.blocking ||
    policyVerdict.requiresOperatorResponse ||
    policyVerdict.minimumLane === "now"
  ) {
    return false;
  }

  if (candidate.consequence === "high" || candidate.tone === "critical") {
    return false;
  }

  if (pressureForecast.overloadRisk === "high") {
    return true;
  }

  return (
    candidate.mode === "status" ||
    candidate.priority === "background" ||
    candidate.consequence === "low"
  );
}

function isActionableEpisode(candidate: AttentionCandidate): boolean {
  if (hasSemanticRelationKind(candidate.relationHints, "resolves")) {
    return false;
  }

  return (
    !candidate.blocking &&
    isCandidateInActionableEpisode(candidate) &&
    (candidate.episodeEvidenceScore ?? 0) >= DEFAULTS.actionableEpisodeEvidenceThreshold
  );
}

function hasVisibleInterruptiveEpisode(
  candidate: AttentionCandidate,
  attentionView: AttentionView | undefined,
): boolean {
  return (
    candidate.episodeId !== undefined &&
    findVisibleEpisodeFrames(attentionView, candidate.episodeId, {
      lanes: ["now", "next"],
      excludedInteractionId: candidate.interactionId,
    }).length > 0
  );
}
