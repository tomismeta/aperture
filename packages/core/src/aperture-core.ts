import type {
  ApertureEvent,
} from "./events.js";
import type { SourceEvent } from "./source-event.js";
import type {
  AttentionFrame,
  AttentionTaskView,
  AttentionView,
} from "./frame.js";
import type { AttentionResponse } from "./frame-response.js";
import type { AttentionSignal } from "./interaction-signal.js";

import { buildAttentionView } from "./attention-view.js";
import { AttentionAdjustments } from "./attention-adjustments.js";
import type {
  AttentionEvidenceContext,
  AttentionOperatorPresence,
} from "./attention-evidence.js";
import {
  buildAttentionEvidenceInput,
  resolveAttentionEvidenceContext,
} from "./attention-evidence.js";
import { deriveAttentionState, type AttentionState } from "./attention-state.js";
import { EpisodeTracker, isDormantEpisodeState, readFrameEpisodeId, readFrameEpisodeState } from "./episode-tracker.js";
import { EventEvaluator } from "./event-evaluator.js";
import { FramePlanner } from "./frame-planner.js";
import { JudgmentCoordinator, type AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { AttentionSignalStore, summarizeAttentionSignals } from "./attention-signal-store.js";
import type { JudgmentConfig } from "./judgment-config.js";
import { signalMetadataForCandidate, signalMetadataForFrame } from "./memory-aggregator.js";
import { distillMemoryProfile } from "./memory-aggregator.js";
import { hasSemanticRelationKind } from "./semantic-relations.js";
import { selectPeripheralBucket } from "./attention-planner.js";
import { ProfileStore, type MemoryProfile, type UserProfile } from "./profile-store.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { AttentionSurfaceCapabilities } from "./surface-capabilities.js";
import { TaskViewStore } from "./task-view-store.js";
import type { ApertureTrace as InternalApertureTrace } from "./trace-types.js";
import {
  APERTURE_INTERNAL_TRACE_SUBSCRIBE,
  type InternalTraceListener,
} from "./internal-trace.js";
import { TraceRecorder } from "./trace-recorder.js";
import { buildTraceEventTransition } from "./trace-event-transition.js";
import {
  ApertureCoreListeners,
  type AttentionFrameListener,
  type AttentionTaskViewListener,
  type AttentionViewListener,
  type AttentionResponseListener,
  type AttentionSignalListener,
  type AttentionTraceListener,
} from "./aperture-core-listeners.js";
import {
  preparePublishedEvent,
  preparePublishedSourceEvent,
} from "./aperture-core-event-preparation.js";
import {
  checkpointMarkdownMemoryProfile,
  loadMarkdownRuntimeState,
  reloadMarkdownRuntimeState,
} from "./aperture-core-markdown-state.js";
import { buildPublishTraceSnapshot } from "./aperture-core-publish-trace.js";
import {
  buildAttentionTransitionSignals,
  buildAutoResponseSignal,
  buildDeferredSignal,
  buildObservationSignal,
  buildResponseSignal,
} from "./aperture-core-signals.js";
import {
  buildApertureCoordinator,
  cloneSurfaceCapabilities,
  normalizeApertureCoreRuntimeSetup,
} from "./aperture-core-runtime-setup.js";
import type {
  PreparedPublishedEvent,
  PublishOptions,
} from "./aperture-core-event-preparation.js";
import {
  assertValidEvent,
  assertValidFrameResponse,
  assertValidSignal,
  assertValidSourceEvent,
} from "./aperture-core-validation.js";

export type {
  AttentionFrameListener,
  AttentionTaskViewListener,
  AttentionViewListener,
  AttentionResponseListener,
  AttentionSignalListener,
  AttentionTraceListener,
} from "./aperture-core-listeners.js";

export type ApertureCoreOptions = {
  userProfile?: UserProfile;
  memoryProfile?: MemoryProfile;
  judgmentConfig?: JudgmentConfig;
  profileStore?: ProfileStore;
  markdownRootDir?: string;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
  operatorPresence?: AttentionOperatorPresence;
  responseExpiryMs?: number;
  /** Optional wall-clock override for deterministic replay and testing. */
  timeSource?: () => number;
};

export type { PublishOptions } from "./aperture-core-event-preparation.js";

type OperatorEngagement = {
  taskId: string;
  interactionId: string;
  expiresAtMs: number;
};

export class ApertureCore {
  private readonly listeners = new ApertureCoreListeners();
  private readonly taskViews = new TaskViewStore();
  private readonly signals = new AttentionSignalStore();
  private readonly episodes = new EpisodeTracker();
  private readonly heuristics = new AttentionAdjustments();
  private readonly evaluation = new EventEvaluator();
  private readonly traceRecorder = new TraceRecorder();
  private coordinator: JudgmentCoordinator;
  private readonly planner = new FramePlanner();
  private readonly profileStore: ProfileStore | undefined;
  private readonly markdownRootDir: string | undefined;
  private baseMemoryProfile: MemoryProfile;
  private userProfile: UserProfile | undefined;
  private judgmentConfig: JudgmentConfig | undefined;
  private surfaceCapabilities: AttentionSurfaceCapabilities;
  private operatorPresence: AttentionOperatorPresence;
  private readonly responseExpiryMs: number | undefined;
  private readonly timeSource: () => number;
  private operatorEngagement: OperatorEngagement | null = null;
  private operatorEngagementTimer: NodeJS.Timeout | null = null;

  constructor(options: ApertureCoreOptions = {}) {
    const runtime = normalizeApertureCoreRuntimeSetup(options);
    this.markdownRootDir = options.markdownRootDir;
    this.profileStore = options.profileStore;
    this.userProfile = runtime.userProfile;
    this.judgmentConfig = runtime.judgmentConfig;
    this.surfaceCapabilities = runtime.surfaceCapabilities;
    this.operatorPresence = runtime.operatorPresence;
    this.responseExpiryMs = runtime.responseExpiryMs;
    this.timeSource = runtime.timeSource;
    this.baseMemoryProfile = runtime.baseMemoryProfile;
    this.coordinator = buildApertureCoordinator(runtime);
  }

  static async fromMarkdown(rootDir: string): Promise<ApertureCore> {
    const {
      profileStore,
      markdownRootDir,
      userProfile,
      memoryProfile,
      judgmentConfig,
    } = await loadMarkdownRuntimeState(rootDir);

    return new ApertureCore({
      userProfile,
      memoryProfile,
      judgmentConfig,
      profileStore,
      markdownRootDir,
    });
  }

  async reloadMarkdown(): Promise<boolean> {
    if (!this.profileStore || !this.markdownRootDir) {
      return false;
    }

    const { userProfile, memoryProfile, judgmentConfig } = await reloadMarkdownRuntimeState({
      profileStore: this.profileStore,
      markdownRootDir: this.markdownRootDir,
      userProfile: this.userProfile,
      memoryProfile: this.baseMemoryProfile,
      judgmentConfig: this.judgmentConfig,
    });

    this.userProfile = userProfile;
    this.baseMemoryProfile = memoryProfile;
    this.judgmentConfig = judgmentConfig;
    this.coordinator = buildApertureCoordinator({
      userProfile: this.userProfile,
      baseMemoryProfile: this.baseMemoryProfile,
      judgmentConfig: this.judgmentConfig,
    });
    return true;
  }

  publishSourceEvent(event: SourceEvent): AttentionFrame | null {
    assertValidSourceEvent(event);
    return this.publishPreparedEvent(preparePublishedSourceEvent(event));
  }

  publish(event: ApertureEvent, options: PublishOptions = {}): AttentionFrame | null {
    // Live event flow:
    // `SourceEvent/ApertureEvent -> finalized event -> EventEvaluator
    // -> AttentionCandidate -> AttentionJudgmentInput-aware judgment ->
    // AttentionFrame/AttentionView + trace`
    assertValidEvent(event);
    return this.publishPreparedEvent(preparePublishedEvent(event, options));
  }

  private publishPreparedEvent(preparedEvent: PreparedPublishedEvent): AttentionFrame | null {
    const { finalizedEvent, originalEvent, transitionKind } = preparedEvent;
    const eventTransition = buildTraceEventTransition(transitionKind, originalEvent, finalizedEvent);
    const current = this.getFrame(finalizedEvent.taskId);
    const evidence = this.assembleAttentionEvidenceContext(finalizedEvent.taskId, current);
    const taskSummary = evidence.taskSignalSummary;
    const globalSummary = evidence.globalSignalSummary;
    const taskAttentionState = evidence.taskAttentionState;
    const globalAttentionState = evidence.globalAttentionState;
    const preAttentionView = evidence.attentionView;
    const pressureForecast = evidence.pressureForecast;
    const attentionBurden = evidence.attentionBurden;
    const evaluation = this.evaluation.evaluate(finalizedEvent);

    switch (evaluation.kind) {
      case "noop": {
        this.notifyTrace(this.traceRecorder.recordNoop(buildPublishTraceSnapshot({
          timestamp: this.nowIso(),
          event: finalizedEvent,
          eventTransition,
          evidence,
          taskView: evidence.currentTaskView,
          attentionView: preAttentionView,
        })));
        return null;
      }
      case "clear": {
        const result = this.applyClear(finalizedEvent.taskId);
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(this.traceRecorder.recordClear(buildPublishTraceSnapshot({
          timestamp: this.nowIso(),
          event: finalizedEvent,
          eventTransition,
          evidence,
          taskView: this.getTaskView(finalizedEvent.taskId),
          attentionView: postAttentionView,
        }), finalizedEvent.taskId));
        return result;
      }
      case "candidate": {
        const candidate = this.prepareCandidateForJudgment(
          evaluation.candidate,
          taskSummary,
          globalSummary,
        );
        const explanation = this.explainCandidateDecision(finalizedEvent.taskId, candidate, evidence);
        const result = this.applyCandidateDecision(
          finalizedEvent.taskId,
          explanation,
          evidence,
          preAttentionView,
        );
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(this.traceRecorder.recordCandidate(buildPublishTraceSnapshot({
          timestamp: this.nowIso(),
          event: finalizedEvent,
          eventTransition,
          evidence,
          taskView: this.getTaskView(finalizedEvent.taskId),
          attentionView: postAttentionView,
        }), {
          original: evaluation.candidate,
          adjusted: candidate,
          explanation,
          result,
        }));
        return result;
      }
    }
  }

  private prepareCandidateForJudgment(
    candidate: AttentionCandidate,
    taskSummary: AttentionSignalSummary,
    globalSummary: AttentionSignalSummary,
  ): AttentionCandidate {
    // Candidate preparation is one additive path:
    // raw candidate -> in-session adjustments -> episode assignment.
    return this.episodes.assign(this.heuristics.apply(
      candidate,
      taskSummary,
      globalSummary,
    ));
  }

  private explainCandidateDecision(
    taskId: string,
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
  ): AttentionDecisionExplanation {
    const candidateEvidence = this.augmentContinuitySignalSummary(taskId, candidate, evidence);
    return this.coordinator.explain(evidence.currentFrame, candidate, candidateEvidence);
  }

  private applyCandidateDecision(
    taskId: string,
    explanation: AttentionDecisionExplanation,
    evidence: AttentionEvidenceContext,
    preAttentionView: AttentionView,
  ): AttentionFrame | null {
    switch (explanation.decision.kind) {
      case "auto_approve":
        return this.applyAutoResponse(
          explanation.decision.candidate,
          explanation.decision.response,
        );
      case "clear":
        return this.applyClear(taskId);
      case "ambient":
        return this.materializePeripheralFrame(
          explanation.decision.candidate,
          "ambient",
          preAttentionView,
        );
      case "queue":
        return this.materializePeripheralFrame(
          explanation.decision.candidate,
          "queue",
          preAttentionView,
        );
      case "activate":
        return this.applyActivationDecision(explanation, evidence, preAttentionView);
    }
  }

  private applyActivationDecision(
    explanation: AttentionDecisionExplanation,
    evidence: AttentionEvidenceContext,
    preAttentionView: AttentionView,
  ): AttentionFrame | null {
    if (explanation.decision.kind !== "activate") {
      return null;
    }

    const candidate = explanation.decision.candidate;

    if (
      this.shouldRetireSupersededEpisodeFrames(
        candidate,
        preAttentionView,
      )
    ) {
      return this.commitFrame(
        this.applyResponseExpiry(
          this.planner.plan(candidate, evidence.currentFrame),
        ),
        this.findSupersededEpisodeFrames(
          candidate,
          preAttentionView,
        ),
      );
    }

    const existingPeripheralFrame = candidate.episodeId
      ? this.findPeripheralEpisodeFrame(candidate.episodeId, preAttentionView)
      : null;

    if (
      existingPeripheralFrame
      && this.shouldPromotePeripheralEpisodeFrame(explanation)
    ) {
      return this.promotePeripheralEpisodeFrame(
        candidate,
        existingPeripheralFrame.frame,
      );
    }

    return existingPeripheralFrame
      ? this.materializePeripheralFrame(
          candidate,
          selectPeripheralBucket(
            candidate,
            explanation.policy,
            evidence.surfaceCapabilities,
          ),
          preAttentionView,
        )
      : this.commitFrame(
          this.applyResponseExpiry(
            this.planner.plan(candidate, evidence.currentFrame),
          ),
        );
  }

  getFrame(taskId: string): AttentionFrame | null {
    return this.taskViews.get(taskId).now ?? null;
  }

  subscribe(taskId: string, listener: AttentionFrameListener): () => void {
    return this.listeners.subscribeFrame(taskId, listener, this.getFrame(taskId));
  }

  subscribeTaskView(taskId: string, listener: AttentionTaskViewListener): () => void {
    return this.listeners.subscribeTaskView(taskId, listener, this.getTaskView(taskId));
  }

  subscribeAttentionView(listener: AttentionViewListener): () => void {
    return this.listeners.subscribeAttentionView(listener, this.getAttentionView());
  }

  onResponse(listener: AttentionResponseListener): () => void {
    return this.listeners.onResponse(listener);
  }

  onSignal(listener: AttentionSignalListener): () => void {
    return this.listeners.onSignal(listener);
  }

  onTrace(listener: AttentionTraceListener): () => void {
    return this.listeners.onTrace(listener);
  }

  [APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener: InternalTraceListener): () => void {
    return this.listeners[APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener);
  }

  submit(response: AttentionResponse): void {
    assertValidFrameResponse(response);
    const current = this.findFrameByInteractionId(response.taskId, response.interactionId);
    if (!current) {
      return;
    }

    const expiredAt = this.readExpiredResponseTimestamp(current, this.nowIso());
    if (expiredAt) {
      throw new Error(
        `response for interaction ${response.interactionId} expired at ${expiredAt} and must be revalidated before submission`,
      );
    }

    const previousAttentionView = this.getAttentionView();
    const timestamp = this.nowIso();
    this.clearOperatorEngagement(response.taskId, response.interactionId);
    this.recordSignal(buildResponseSignal(current, response, timestamp));
    this.episodes.resolveInteraction(response.interactionId);

    const taskView = this.taskViews.resolve(response.taskId, response.interactionId);
    const newPrimary = taskView.now;
    const nextAttentionView = this.getAttentionView();
    this.recordAttentionTransition(previousAttentionView, nextAttentionView, timestamp);
    if (newPrimary) {
      this.notifyFrame(response.taskId, newPrimary);
    } else {
      this.notifyFrame(response.taskId, null);
    }
    this.notifyTaskView(response.taskId, taskView);
    this.notifyAttentionView();
    this.listeners.emitResponse(response);
  }

  getTaskView(taskId: string): AttentionTaskView {
    return this.taskViews.get(taskId);
  }

  getAttentionView(): AttentionView {
    return buildAttentionView(this.taskViews.values(), {
      globalAttentionState: this.getAttentionState(),
      operatorPresence: this.getOperatorPresence(),
      focusedInteractionId: this.readOperatorEngagementInteractionId(),
    });
  }

  getSignals(taskId?: string): AttentionSignal[] {
    return this.signals.list(taskId);
  }

  getSignalSummary(taskId?: string): AttentionSignalSummary {
    return this.signals.summarize(taskId);
  }

  getAttentionState(taskId?: string): AttentionState {
    return deriveAttentionState(this.signals.summarize(taskId));
  }

  getSurfaceCapabilities(): AttentionSurfaceCapabilities {
    return cloneSurfaceCapabilities(this.surfaceCapabilities);
  }

  getOperatorPresence(): AttentionOperatorPresence {
    return this.operatorPresence;
  }

  setOperatorPresence(presence: AttentionOperatorPresence): void {
    this.operatorPresence = presence;
  }

  engage(taskId: string, interactionId: string, options: { durationMs?: number } = {}): void {
    if (!this.findFrameByInteractionId(taskId, interactionId)) {
      return;
    }

    const previousAttentionView = this.getAttentionView();
    const durationMs = normalizeOperatorEngagementDuration(options.durationMs);
    this.operatorEngagement = {
      taskId,
      interactionId,
      expiresAtMs: Date.now() + durationMs,
    };
    this.scheduleOperatorEngagementExpiry(durationMs, taskId, interactionId);
    const nextAttentionView = this.getAttentionView();
    if (!sameAttentionView(previousAttentionView, nextAttentionView)) {
      this.notifyAttentionView();
    }
  }

  setSurfaceCapabilities(capabilities: AttentionSurfaceCapabilities): void {
    this.surfaceCapabilities = cloneSurfaceCapabilities(capabilities);
  }

  snapshotMemoryProfile(now: string = this.nowIso()): MemoryProfile {
    return distillMemoryProfile(this.baseMemoryProfile, this.signals.list(), now);
  }

  async checkpointMemory(now: string = this.nowIso()): Promise<MemoryProfile | null> {
    const snapshot = await checkpointMarkdownMemoryProfile({
      profileStore: this.profileStore,
      memoryProfile: this.baseMemoryProfile,
      signals: this.signals.list(),
      now,
    });
    if (!snapshot) {
      return null;
    }

    this.baseMemoryProfile = snapshot;
    this.coordinator = buildApertureCoordinator({
      userProfile: this.userProfile,
      baseMemoryProfile: this.baseMemoryProfile,
      judgmentConfig: this.judgmentConfig,
    });
    return snapshot;
  }

  markViewed(taskId: string, interactionId: string, options: { surface?: string } = {}): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal(buildObservationSignal(
      "viewed",
      taskId,
      interactionId,
      this.nowIso(),
      frame,
      options,
    ));
  }

  markTimedOut(
    taskId: string,
    interactionId: string,
    options: { surface?: string; timeoutMs?: number } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal(buildObservationSignal(
      "timed_out",
      taskId,
      interactionId,
      this.nowIso(),
      frame,
      options,
    ));
  }

  markContextExpanded(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal(buildObservationSignal(
      "context_expanded",
      taskId,
      interactionId,
      this.nowIso(),
      frame,
      options,
    ));
  }

  markContextSkipped(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal(buildObservationSignal(
      "context_skipped",
      taskId,
      interactionId,
      this.nowIso(),
      frame,
      options,
    ));
  }

  recordSignal(signal: AttentionSignal): void {
    assertValidSignal(signal);
    this.signals.record(signal);
    this.listeners.emitSignal(signal);
  }

  private commitFrame(frame: AttentionFrame, retiredFrames: AttentionFrame[] = []): AttentionFrame {
    const previousAttentionView = this.getAttentionView();
    const retiredKeys = new Set<string>();
    for (const retiredFrame of retiredFrames) {
      const key = `${retiredFrame.taskId}::${retiredFrame.interactionId}`;
      if (retiredKeys.has(key)) {
        continue;
      }
      retiredKeys.add(key);

      const retiredTaskView = this.taskViews.discard(
        retiredFrame.taskId,
        retiredFrame.interactionId,
      );
      if (retiredFrame.taskId !== frame.taskId) {
        this.notifyFrame(retiredFrame.taskId, retiredTaskView.now);
        this.notifyTaskView(retiredFrame.taskId, retiredTaskView);
      }
    }

    const taskView = this.taskViews.setNow(frame.taskId, frame);
    const nextAttentionView = this.getAttentionView();
    this.recordAttentionTransition(previousAttentionView, nextAttentionView, frame.timing.updatedAt);
    this.recordSignal({
      kind: "presented",
      taskId: frame.taskId,
      interactionId: frame.interactionId,
      timestamp: frame.timing.updatedAt,
      frameId: frame.id,
      ...(frame.source !== undefined ? { source: frame.source } : {}),
      metadata: signalMetadataForFrame(frame),
    });
    this.notifyFrame(frame.taskId, frame);
    this.notifyTaskView(frame.taskId, taskView);
    this.notifyAttentionView();
    return frame;
  }

  private assembleAttentionEvidenceContext(
    taskId: string,
    currentFrame: AttentionFrame | null,
  ): AttentionEvidenceContext {
    const taskSignalSummary = this.signals.summarize(taskId);
    const globalSignalSummary = this.signals.summarize();
    const taskAttentionState = deriveAttentionState(taskSignalSummary);
    const globalAttentionState = deriveAttentionState(globalSignalSummary);
    const currentTaskView = this.getTaskView(taskId);
    const attentionView = this.getAttentionView();
    const operatorPresence = this.getOperatorPresence();
    return resolveAttentionEvidenceContext(currentFrame, buildAttentionEvidenceInput({
      currentFrame,
      currentTaskView,
      currentEpisode: this.episodes.readFrameEpisode(currentFrame),
      attentionView,
      taskSignalSummary,
      continuitySignalSummary: taskSignalSummary,
      globalSignalSummary,
      taskAttentionState,
      globalAttentionState,
      surfaceCapabilities: this.getSurfaceCapabilities(),
      operatorPresence,
    }), this.timeSource());
  }

  private applyClear(taskId: string): null {
    const previousAttentionView = this.getAttentionView();
    const existingTaskView = this.taskViews.get(taskId);
    const hadAnyVisibleState =
      existingTaskView.now !== null
      || existingTaskView.next.length > 0
      || existingTaskView.ambient.length > 0;

    if (!hadAnyVisibleState) {
      return null;
    }

    for (const frame of [existingTaskView.now, ...existingTaskView.next, ...existingTaskView.ambient]) {
      if (!frame) {
        continue;
      }
      this.episodes.resolveInteraction(frame.interactionId);
    }

    this.clearOperatorEngagement(taskId);
    const taskView = this.taskViews.clear(taskId);
    const nextAttentionView = this.getAttentionView();
    this.recordAttentionTransition(previousAttentionView, nextAttentionView, this.nowIso());
    this.notifyFrame(taskId, null);
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return null;
  }

  private queueFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.taskViews.addNext(taskId, frame);
    this.recordSignal(buildDeferredSignal(frame, "next"));
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return taskView.now ?? frame;
  }

  private addAmbientFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.taskViews.addAmbient(taskId, frame);
    this.recordSignal(buildDeferredSignal(frame, "suppressed"));
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return taskView.now ?? frame;
  }

  private materializePeripheralFrame(
    candidate: AttentionCandidate,
    bucket: "queue" | "ambient",
    attentionView: AttentionView,
  ): AttentionFrame {
    const existing = candidate.episodeId ? this.findPeripheralEpisodeFrame(candidate.episodeId, attentionView) : null;
    if (!existing) {
      const planned = this.applyResponseExpiry(this.planner.plan(candidate, null));
      return bucket === "queue"
        ? this.queueFrame(candidate.taskId, planned)
        : this.addAmbientFrame(candidate.taskId, planned);
    }

    const nextBucket = existing.bucket === "queue" || bucket === "queue" ? "queue" : "ambient";
    const planned = this.applyResponseExpiry(this.planner.plan(candidate, existing.frame));
    const merged = {
      ...planned,
      id: existing.frame.id,
    };
    const previousTaskView = this.taskViews.discard(existing.frame.taskId, existing.frame.interactionId);
    this.notifyTaskView(existing.frame.taskId, previousTaskView);

    const nextTaskView =
      nextBucket === "queue"
        ? this.taskViews.addNext(merged.taskId, merged)
        : this.taskViews.addAmbient(merged.taskId, merged);
    this.recordSignal(buildDeferredSignal(
      merged,
      nextBucket === "queue" ? "next" : "suppressed",
      candidate,
    ));
    this.notifyTaskView(merged.taskId, nextTaskView);
    this.notifyAttentionView();
    return merged;
  }

  private promotePeripheralEpisodeFrame(
    candidate: AttentionCandidate,
    existingFrame: AttentionFrame,
  ): AttentionFrame {
    const planned = this.applyResponseExpiry(this.planner.plan(candidate, existingFrame));
    const promoted = {
      ...planned,
      id: existingFrame.id,
    };
    return this.commitFrame(promoted, [existingFrame]);
  }

  private findFrameByInteractionId(taskId: string, interactionId: string): AttentionFrame | null {
    return this.findFrame(taskId, interactionId);
  }

  private shouldRetireSupersededEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): boolean {
    return this.findSupersededEpisodeFrames(candidate, attentionView).length > 0;
  }

  private findSupersededEpisodeFrames(
    candidate: AttentionCandidate,
    attentionView: AttentionView,
  ): AttentionFrame[] {
    if (!candidate.episodeId || !hasSemanticRelationKind(candidate.relationHints, "supersedes")) {
      return [];
    }

    return [
      attentionView.now,
      ...attentionView.next,
      ...attentionView.ambient,
    ].filter((frame): frame is AttentionFrame =>
      frame !== null
      && frame.interactionId !== candidate.interactionId
      && readFrameEpisodeId(frame) === candidate.episodeId
      && !isDormantEpisodeState(readFrameEpisodeState(frame))
    );
  }

  private applyResponseExpiry(frame: AttentionFrame): AttentionFrame {
    if (this.responseExpiryMs === undefined || frame.responseSpec?.kind === "none") {
      return frame;
    }

    const updatedAt = Date.parse(frame.timing.updatedAt);
    if (Number.isNaN(updatedAt)) {
      return frame;
    }

    return {
      ...frame,
      timing: {
        ...frame.timing,
        expiresAt: new Date(updatedAt + this.responseExpiryMs).toISOString(),
      },
    };
  }

  private readExpiredResponseTimestamp(frame: AttentionFrame, now: string): string | null {
    const expiresAt = frame.timing.expiresAt;
    if (!expiresAt) {
      return null;
    }

    const expiresAtMs = Date.parse(expiresAt);
    const nowMs = Date.parse(now);
    if (Number.isNaN(expiresAtMs) || Number.isNaN(nowMs) || nowMs <= expiresAtMs) {
      return null;
    }

    return expiresAt;
  }

  private findPeripheralEpisodeFrame(
    episodeId: string,
    attentionView: AttentionView,
  ): { frame: AttentionFrame; bucket: "queue" | "ambient" } | null {
    const queued = attentionView.next.find((frame) =>
      readFrameEpisodeId(frame) === episodeId && !isDormantEpisodeState(readFrameEpisodeState(frame))
    );
    if (queued) {
      return { frame: queued, bucket: "queue" };
    }

    const ambient = attentionView.ambient.find((frame) =>
      readFrameEpisodeId(frame) === episodeId && !isDormantEpisodeState(readFrameEpisodeState(frame))
    );
    if (ambient) {
      return { frame: ambient, bucket: "ambient" };
    }

    return null;
  }

  private augmentContinuitySignalSummary(
    taskId: string,
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
  ): AttentionEvidenceContext {
    const continuitySignalSummary = this.resolveContinuitySignalSummary(taskId, candidate, evidence.taskSignalSummary);
    if (continuitySignalSummary === evidence.taskSignalSummary) {
      return evidence;
    }

    return {
      ...evidence,
      continuitySignalSummary,
    };
  }

  private resolveContinuitySignalSummary(
    taskId: string,
    candidate: AttentionCandidate,
    taskSignalSummary: AttentionSignalSummary,
  ): AttentionSignalSummary {
    if (!candidate.episodeId) {
      return taskSignalSummary;
    }

    const taskSignals = this.signals.list(taskId);
    const relatedEpisodeSignals = this.signals
      .list()
      .filter((signal) =>
        signal.taskId !== taskId && readSignalEpisodeId(signal) === candidate.episodeId
      );

    if (relatedEpisodeSignals.length === 0) {
      return taskSignalSummary;
    }

    return summarizeAttentionSignals(
      [...taskSignals, ...relatedEpisodeSignals].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp)
      ),
    );
  }

  private shouldPromotePeripheralEpisodeFrame(explanation: {
    continuityEvaluations?: Array<{ rule: string; kind: string; decision?: { kind: string } }>;
  }): boolean {
    return explanation.continuityEvaluations?.some((evaluation) =>
      evaluation.rule === "deferral_escalation"
      && evaluation.kind === "override"
      && evaluation.decision?.kind === "activate"
    ) ?? false;
  }

  private notifyFrame(taskId: string, frame: AttentionFrame | null): void {
    this.listeners.emitFrame(taskId, frame);
  }

  private notifyTaskView(taskId: string, taskView: AttentionTaskView): void {
    this.listeners.emitTaskView(taskId, taskView);
  }

  private notifyAttentionView(): void {
    this.listeners.emitAttentionView(this.getAttentionView());
  }

  private readOperatorEngagementInteractionId(): string | null {
    const engagement = this.operatorEngagement;
    if (!engagement) {
      return null;
    }

    if (engagement.expiresAtMs <= Date.now()) {
      this.clearOperatorEngagement();
      return null;
    }

    if (!this.findFrameByInteractionId(engagement.taskId, engagement.interactionId)) {
      this.clearOperatorEngagement();
      return null;
    }

    return engagement.interactionId;
  }

  private scheduleOperatorEngagementExpiry(
    durationMs: number,
    taskId: string,
    interactionId: string,
  ): void {
    this.clearOperatorEngagementTimer();
    this.operatorEngagementTimer = setTimeout(() => {
      if (
        this.operatorEngagement?.taskId !== taskId
        || this.operatorEngagement?.interactionId !== interactionId
      ) {
        return;
      }

      const previousAttentionView = this.getAttentionView();
      this.clearOperatorEngagement();
      const nextAttentionView = this.getAttentionView();
      if (!sameAttentionView(previousAttentionView, nextAttentionView)) {
        this.notifyAttentionView();
      }
    }, durationMs);
    this.operatorEngagementTimer.unref?.();
  }

  private clearOperatorEngagement(taskId?: string, interactionId?: string): void {
    const engagement = this.operatorEngagement;
    if (!engagement) {
      return;
    }

    if (taskId !== undefined && engagement.taskId !== taskId) {
      return;
    }

    if (interactionId !== undefined && engagement.interactionId !== interactionId) {
      return;
    }

    this.operatorEngagement = null;
    this.clearOperatorEngagementTimer();
  }

  private clearOperatorEngagementTimer(): void {
    if (this.operatorEngagementTimer) {
      clearTimeout(this.operatorEngagementTimer);
      this.operatorEngagementTimer = null;
    }
  }

  private notifyTrace(trace: InternalApertureTrace): void {
    this.listeners.emitTrace(trace);
  }

  private applyAutoResponse(candidate: AttentionCandidate, response: AttentionResponse): null {
    const timestamp = this.nowIso();
    this.recordSignal(buildAutoResponseSignal(candidate, response, timestamp));
    this.episodes.resolveInteraction(candidate.interactionId);
    this.listeners.emitResponse(response);
    return null;
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
      this.recordSignal(signal);
    }
  }

  private findFrame(taskId: string, interactionId: string): AttentionFrame | null {
    const taskView = this.taskViews.get(taskId);
    if (taskView.now?.interactionId === interactionId) {
      return taskView.now;
    }

    const queued = taskView.next.find((frame) => frame.interactionId === interactionId);
    if (queued) {
      return queued;
    }

    return taskView.ambient.find((frame) => frame.interactionId === interactionId) ?? null;
  }

  private nowIso(): string {
    return new Date(this.timeSource()).toISOString();
  }

}

function readSignalEpisodeId(signal: AttentionSignal): string | null {
  const episode = signal.metadata?.episode;
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    return null;
  }

  const id = (episode as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function sameFrame(left: AttentionFrame, right: AttentionFrame): boolean {
  return left.id === right.id || (left.taskId === right.taskId && left.interactionId === right.interactionId);
}

function normalizeOperatorEngagementDuration(durationMs: number | undefined): number {
  if (durationMs === undefined) {
    return 12_000;
  }

  return Math.max(25, Math.floor(durationMs));
}

function sameAttentionView(left: AttentionView, right: AttentionView): boolean {
  return left.now?.interactionId === right.now?.interactionId
    && sameInteractionOrder(left.next, right.next)
    && sameInteractionOrder(left.ambient, right.ambient);
}

function sameInteractionOrder(left: AttentionFrame[], right: AttentionFrame[]): boolean {
  return left.length === right.length
    && left.every((frame, index) => frame.interactionId === right[index]?.interactionId);
}
