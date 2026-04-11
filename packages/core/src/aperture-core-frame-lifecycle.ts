import {
  EpisodeTracker,
  isDormantEpisodeState,
  readFrameEpisodeId,
  readFrameEpisodeState,
} from "./episode-tracker.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionResponse } from "./frame-response.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionSignal } from "./interaction-signal.js";
import { signalMetadataForFrame } from "./memory-aggregator.js";
import { hasSemanticRelationKind } from "./semantic-relations.js";
import { TaskViewStore } from "./task-view-store.js";
import type { CoreClock } from "./time.js";
import { FramePlanner } from "./frame-planner.js";
import {
  buildAttentionTransitionSignals,
  buildAutoResponseSignal,
  buildDeferredSignal,
  buildResponseSignal,
} from "./aperture-core-signals.js";

type ApertureCoreFrameRuntime = {
  taskViews: TaskViewStore;
  planner: FramePlanner;
  episodes: EpisodeTracker;
  clock: CoreClock;
  responseExpiryMs: number | undefined;
  getAttentionView(): AttentionView;
  recordSignal(signal: AttentionSignal): void;
  clearOperatorEngagement(taskId?: string, interactionId?: string): void;
  notifyFrame(taskId: string, frame: AttentionFrame | null): void;
  notifyTaskView(taskId: string, taskView: AttentionTaskView): void;
  notifyAttentionView(): void;
  emitResponse(response: AttentionResponse): void;
};

export class ApertureCoreFrameLifecycle {
  private readonly runtime: ApertureCoreFrameRuntime;

  constructor(runtime: ApertureCoreFrameRuntime) {
    this.runtime = runtime;
  }

  commitFrame(frame: AttentionFrame, retiredFrames: AttentionFrame[] = []): AttentionFrame {
    const previousAttentionView = this.runtime.getAttentionView();
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
      if (retiredFrame.taskId !== frame.taskId) {
        this.runtime.notifyFrame(retiredFrame.taskId, retiredTaskView.now);
        this.runtime.notifyTaskView(retiredFrame.taskId, retiredTaskView);
      }
    }

    const taskView = this.runtime.taskViews.setNow(frame.taskId, frame);
    const nextAttentionView = this.runtime.getAttentionView();
    this.recordAttentionTransition(
      previousAttentionView,
      nextAttentionView,
      frame.timing.updatedAt,
    );
    this.runtime.recordSignal({
      kind: "presented",
      taskId: frame.taskId,
      interactionId: frame.interactionId,
      timestamp: frame.timing.updatedAt,
      frameId: frame.id,
      ...(frame.source !== undefined ? { source: frame.source } : {}),
      metadata: signalMetadataForFrame(frame),
    });
    this.runtime.notifyFrame(frame.taskId, frame);
    this.runtime.notifyTaskView(frame.taskId, taskView);
    this.runtime.notifyAttentionView();
    return frame;
  }

  applyClear(taskId: string): null {
    const previousAttentionView = this.runtime.getAttentionView();
    const existingTaskView = this.runtime.taskViews.get(taskId);
    const hadAnyVisibleState =
      existingTaskView.now !== null ||
      existingTaskView.next.length > 0 ||
      existingTaskView.ambient.length > 0;

    if (!hadAnyVisibleState) {
      return null;
    }

    for (const frame of [
      existingTaskView.now,
      ...existingTaskView.next,
      ...existingTaskView.ambient,
    ]) {
      if (!frame) {
        continue;
      }
      this.runtime.episodes.resolveInteraction(frame.interactionId);
    }

    this.runtime.clearOperatorEngagement(taskId);
    const taskView = this.runtime.taskViews.clear(taskId);
    const nextAttentionView = this.runtime.getAttentionView();
    this.recordAttentionTransition(
      previousAttentionView,
      nextAttentionView,
      this.runtime.clock.nowIso(),
    );
    this.runtime.notifyFrame(taskId, null);
    this.runtime.notifyTaskView(taskId, taskView);
    this.runtime.notifyAttentionView();
    return null;
  }

  queueFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.runtime.taskViews.addNext(taskId, frame);
    this.runtime.recordSignal(buildDeferredSignal(frame, "next"));
    this.runtime.notifyTaskView(taskId, taskView);
    this.runtime.notifyAttentionView();
    return taskView.now ?? frame;
  }

  addAmbientFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.runtime.taskViews.addAmbient(taskId, frame);
    this.runtime.recordSignal(buildDeferredSignal(frame, "suppressed"));
    this.runtime.notifyTaskView(taskId, taskView);
    this.runtime.notifyAttentionView();
    return taskView.now ?? frame;
  }

  materializePeripheralFrame(
    candidate: AttentionCandidate,
    bucket: "queue" | "ambient",
    attentionView: AttentionView,
  ): AttentionFrame {
    const existing = candidate.episodeId
      ? this.findPeripheralEpisodeFrame(candidate.episodeId, attentionView)
      : null;
    if (!existing) {
      const planned = this.applyResponseExpiry(this.runtime.planner.plan(candidate, null));
      return bucket === "queue"
        ? this.queueFrame(candidate.taskId, planned)
        : this.addAmbientFrame(candidate.taskId, planned);
    }

    const nextBucket = existing.bucket === "queue" || bucket === "queue" ? "queue" : "ambient";
    const planned = this.applyResponseExpiry(this.runtime.planner.plan(candidate, existing.frame));
    const merged = {
      ...planned,
      id: existing.frame.id,
    };
    const previousTaskView = this.runtime.taskViews.discard(
      existing.frame.taskId,
      existing.frame.interactionId,
    );
    this.runtime.notifyTaskView(existing.frame.taskId, previousTaskView);

    const nextTaskView =
      nextBucket === "queue"
        ? this.runtime.taskViews.addNext(merged.taskId, merged)
        : this.runtime.taskViews.addAmbient(merged.taskId, merged);
    this.runtime.recordSignal(
      buildDeferredSignal(merged, nextBucket === "queue" ? "next" : "suppressed", candidate),
    );
    this.runtime.notifyTaskView(merged.taskId, nextTaskView);
    this.runtime.notifyAttentionView();
    return merged;
  }

  promotePeripheralEpisodeFrame(
    candidate: AttentionCandidate,
    existingFrame: AttentionFrame,
  ): AttentionFrame {
    const planned = this.applyResponseExpiry(this.runtime.planner.plan(candidate, existingFrame));
    const promoted = {
      ...planned,
      id: existingFrame.id,
    };
    return this.commitFrame(promoted, [existingFrame]);
  }

  submit(response: AttentionResponse): void {
    const current = this.findFrame(response.taskId, response.interactionId);
    if (!current) {
      return;
    }

    const expiredAt = this.readExpiredResponseTimestamp(current, this.runtime.clock.nowIso());
    if (expiredAt) {
      throw new Error(
        `response for interaction ${response.interactionId} expired at ${expiredAt} and must be revalidated before submission`,
      );
    }

    const previousAttentionView = this.runtime.getAttentionView();
    const timestamp = this.runtime.clock.nowIso();
    this.runtime.clearOperatorEngagement(response.taskId, response.interactionId);
    this.runtime.recordSignal(buildResponseSignal(current, response, timestamp));
    this.runtime.episodes.resolveInteraction(response.interactionId);

    const taskView = this.runtime.taskViews.resolve(response.taskId, response.interactionId);
    const nextAttentionView = this.runtime.getAttentionView();
    this.recordAttentionTransition(previousAttentionView, nextAttentionView, timestamp);
    this.runtime.notifyFrame(response.taskId, taskView.now ?? null);
    this.runtime.notifyTaskView(response.taskId, taskView);
    this.runtime.notifyAttentionView();
    this.runtime.emitResponse(response);
  }

  applyAutoResponse(candidate: AttentionCandidate, response: AttentionResponse): null {
    const timestamp = this.runtime.clock.nowIso();
    this.runtime.recordSignal(buildAutoResponseSignal(candidate, response, timestamp));
    this.runtime.episodes.resolveInteraction(candidate.interactionId);
    this.runtime.emitResponse(response);
    return null;
  }

  findFrameByInteractionId(taskId: string, interactionId: string): AttentionFrame | null {
    return this.findFrame(taskId, interactionId);
  }

  shouldRetireSupersededEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): boolean {
    return this.findSupersededEpisodeFrames(candidate, attentionView).length > 0;
  }

  findSupersededEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): AttentionFrame[] {
    if (!candidate.episodeId || !hasSemanticRelationKind(candidate.relationHints, "supersedes")) {
      return [];
    }

    return [attentionView.now, ...attentionView.next, ...attentionView.ambient].filter(
      (frame): frame is AttentionFrame =>
        frame !== null &&
        frame.interactionId !== candidate.interactionId &&
        readFrameEpisodeId(frame) === candidate.episodeId &&
        !isDormantEpisodeState(readFrameEpisodeState(frame)),
    );
  }

  applyResponseExpiry(frame: AttentionFrame): AttentionFrame {
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

  readExpiredResponseTimestamp(frame: AttentionFrame, now: string): string | null {
    const expiresAt = frame.timing.expiresAt;
    if (!expiresAt) {
      return null;
    }

    const expiresAtMs = this.runtime.clock.parse(expiresAt);
    const nowMs = this.runtime.clock.parse(now);
    if (expiresAtMs === null || nowMs === null || nowMs <= expiresAtMs) {
      return null;
    }

    return expiresAt;
  }

  findPeripheralEpisodeFrame(
    episodeId: string,
    attentionView: AttentionView,
  ): { frame: AttentionFrame; bucket: "queue" | "ambient" } | null {
    const queued = attentionView.next.find(
      (frame) =>
        readFrameEpisodeId(frame) === episodeId &&
        !isDormantEpisodeState(readFrameEpisodeState(frame)),
    );
    if (queued) {
      return { frame: queued, bucket: "queue" };
    }

    const ambient = attentionView.ambient.find(
      (frame) =>
        readFrameEpisodeId(frame) === episodeId &&
        !isDormantEpisodeState(readFrameEpisodeState(frame)),
    );
    if (ambient) {
      return { frame: ambient, bucket: "ambient" };
    }

    return null;
  }

  shouldPromotePeripheralEpisodeFrame(explanation: {
    continuityEvaluations?: Array<{ rule: string; kind: string; decision?: { kind: string } }>;
  }): boolean {
    return (
      explanation.continuityEvaluations?.some(
        (evaluation) =>
          evaluation.rule === "deferral_escalation" &&
          evaluation.kind === "override" &&
          evaluation.decision?.kind === "activate",
      ) ?? false
    );
  }

  findFrame(taskId: string, interactionId: string): AttentionFrame | null {
    const taskView = this.runtime.taskViews.get(taskId);
    if (taskView.now?.interactionId === interactionId) {
      return taskView.now;
    }

    const queued = taskView.next.find((frame) => frame.interactionId === interactionId);
    if (queued) {
      return queued;
    }

    return taskView.ambient.find((frame) => frame.interactionId === interactionId) ?? null;
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
