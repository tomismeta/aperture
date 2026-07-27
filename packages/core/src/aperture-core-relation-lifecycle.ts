import { findVisibleEpisodeFrames } from "./episode-tracker.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionSignal } from "./interaction-signal.js";
import { hasSemanticRelationKind, readSemanticRelationTarget } from "./semantic-relations.js";
import { hasQualifiedResolvingRelation } from "./semantic-relation-judgment.js";
import type { SemanticRelationHint } from "./semantic-types.js";
import { buildAttentionTransitionSignals, buildDeferredSignal } from "./aperture-core-signals.js";
import type { FramePlanner } from "./frame-planner.js";
import type { TaskViewStore } from "./task-view-store.js";
import type { CoreClock } from "./time.js";

type ApertureCoreRelationRuntime = {
  taskViews: TaskViewStore;
  planner: FramePlanner;
  clock: CoreClock;
  responseExpiryMs: number | undefined;
  getAttentionView(): AttentionView;
  recordSignal(signal: AttentionSignal): void;
  clearOperatorEngagement(taskId?: string, interactionId?: string): void;
  notifyFrame(taskId: string, frame: AttentionFrame | null): void;
  notifyTaskView(taskId: string, taskView: AttentionTaskView): void;
  notifyAttentionView(): void;
};

export class ApertureCoreRelationLifecycle {
  private readonly runtime: ApertureCoreRelationRuntime;

  constructor(runtime: ApertureCoreRelationRuntime) {
    this.runtime = runtime;
  }

  shouldRetireResolvedEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): boolean {
    return this.findResolvedEpisodeFrames(candidate, attentionView).length > 0;
  }

  materializeResolvedEpisodeFrame(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): AttentionFrame {
    const retiredFrames = this.findResolvedEpisodeFrames(candidate, attentionView);
    const previousAttentionView = this.runtime.getAttentionView();
    this.retireVisibleFrames(retiredFrames);

    const planned = this.applyResponseExpiry(this.runtime.planner.plan(candidate, null));
    const taskView = this.runtime.taskViews.addAmbient(candidate.taskId, planned);
    const nextAttentionView = this.runtime.getAttentionView();
    this.recordAttentionTransition(previousAttentionView, nextAttentionView, candidate.timestamp);
    this.runtime.recordSignal(buildDeferredSignal(planned, "suppressed"));
    this.runtime.notifyTaskView(candidate.taskId, taskView);
    this.runtime.notifyAttentionView();
    return taskView.now ?? planned;
  }

  private findResolvedEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): AttentionFrame[] {
    return findResolvedEpisodeFrames(candidate, attentionView, this.runtime.clock);
  }

  private applyResponseExpiry(frame: AttentionFrame): AttentionFrame {
    if (this.runtime.responseExpiryMs === undefined || frame.responseSpec?.kind === "none") {
      return frame;
    }

    const expiresAt = this.runtime.clock.add(frame.timing.updatedAt, this.runtime.responseExpiryMs);
    if (expiresAt === null) {
      return frame;
    }

    return {
      ...frame,
      timing: {
        ...frame.timing,
        expiresAt,
      },
    };
  }

  private retireVisibleFrames(retiredFrames: AttentionFrame[]): void {
    const retiredKeys = new Set<string>();
    for (const retiredFrame of retiredFrames) {
      const key = `${retiredFrame.taskId}::${retiredFrame.interactionId}`;
      if (retiredKeys.has(key)) {
        continue;
      }
      retiredKeys.add(key);

      const retiredTaskView = this.runtime.taskViews.discard(
        retiredFrame.taskId,
        retiredFrame.interactionId,
      );
      this.runtime.clearOperatorEngagement(retiredFrame.taskId, retiredFrame.interactionId);
      this.runtime.notifyFrame(retiredFrame.taskId, retiredTaskView.now);
      this.runtime.notifyTaskView(retiredFrame.taskId, retiredTaskView);
    }
  }

  private recordAttentionTransition(
    previousAttentionView: AttentionView,
    nextAttentionView: AttentionView,
    timestamp: string,
  ): void {
    for (const signal of buildAttentionTransitionSignals(
      previousAttentionView,
      nextAttentionView,
      timestamp,
    )) {
      this.runtime.recordSignal(signal);
    }
  }
}

export function findSupersededEpisodeFrames(
  candidate: AttentionCandidate,
  attentionView: AttentionView,
): AttentionFrame[] {
  if (!candidate.episodeId || !hasSemanticRelationKind(candidate.relationHints, "supersedes")) {
    return [];
  }

  return findVisibleEpisodeFrames(attentionView, candidate.episodeId, {
    excludedInteractionId: candidate.interactionId,
  });
}

export function findResolvedEpisodeFrames(
  candidate: AttentionCandidate,
  attentionView: AttentionView,
  clock: CoreClock,
): AttentionFrame[] {
  if (!isQualifiedResolvingCandidate(candidate) || !candidate.episodeId) {
    return [];
  }

  const frames = findVisibleEpisodeFrames(attentionView, candidate.episodeId, {
    excludedInteractionId: candidate.interactionId,
  });
  if (frames.length === 0) {
    return [];
  }

  if (frames.some((frame) => isResolutionOlderThanFrame(candidate, frame, clock))) {
    return [];
  }

  return hasOnlyCoherentCrossTaskResolutionTarget(candidate, frames) ? frames : [];
}

function isQualifiedResolvingCandidate(candidate: AttentionCandidate): boolean {
  return hasQualifiedResolvingRelation(candidate);
}

function isResolutionOlderThanFrame(
  candidate: AttentionCandidate,
  frame: AttentionFrame,
  clock: CoreClock,
): boolean {
  const candidateMs = clock.parse(candidate.timestamp);
  const frameMs = clock.parse(frame.timing.updatedAt);
  if (candidateMs !== null && frameMs !== null) {
    return candidateMs < frameMs;
  }

  return candidate.timestamp < frame.timing.updatedAt;
}

function hasOnlyCoherentCrossTaskResolutionTarget(
  candidate: AttentionCandidate,
  frames: AttentionFrame[],
): boolean {
  if (frames.every((frame) => frame.taskId === candidate.taskId)) {
    return true;
  }

  const target = readSemanticRelationTarget(candidate.relationHints);
  if (!target) {
    return false;
  }

  return frames.every(
    (frame) => readSemanticRelationTarget(readFrameRelationHints(frame)) === target,
  );
}

function readFrameRelationHints(frame: AttentionFrame): SemanticRelationHint[] {
  const semantic = frame.metadata?.semantic;
  if (!semantic || typeof semantic !== "object" || !("relationHints" in semantic)) {
    return [];
  }

  const relationHints = (semantic as Record<string, unknown>).relationHints;
  if (!Array.isArray(relationHints)) {
    return [];
  }

  return relationHints.filter(isSemanticRelationHint);
}

function isSemanticRelationHint(value: unknown): value is SemanticRelationHint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const kind = (value as Record<string, unknown>).kind;
  return (
    kind === "same_issue" ||
    kind === "resolves" ||
    kind === "supersedes" ||
    kind === "repeats" ||
    kind === "escalates"
  );
}
