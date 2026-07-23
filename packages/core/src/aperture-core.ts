import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionResponse } from "./frame-response.js";
import type { AttentionSignal } from "./interaction-signal.js";

import { buildAttentionView } from "./attention-view.js";
import { AttentionAdjustments } from "./attention-adjustments.js";
import type { AttentionEvidenceContext, AttentionOperatorPresence } from "./attention-evidence.js";
import { deriveAttentionState, type AttentionState } from "./attention-state.js";
import { EpisodeTracker } from "./episode-tracker.js";
import { EventEvaluator } from "./event-evaluator.js";
import { FramePlanner } from "./frame-planner.js";
import { JudgmentCoordinator, type AttentionDecisionExplanation } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { AttentionSignalStore, type AttentionSignalStoreStats } from "./attention-signal-store.js";
import type { PolicyConfig } from "./policy-config.js";
import { distillMemoryProfile } from "./memory-aggregator.js";
import { selectPeripheralBucket } from "./attention-planner.js";
import { ApertureCoreAttentionEvidence } from "./aperture-core-attention-evidence.js";
import { ApertureCoreFrameLifecycle } from "./aperture-core-frame-lifecycle.js";
import { ProfileStore, type MemoryProfile, type ApertureProfile } from "./profile-store.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { AttentionSurfaceCapabilities } from "./surface-capabilities.js";
import { TaskViewStore } from "./task-view-store.js";
import type { ApertureTrace as InternalApertureTrace } from "./trace-types.js";
import { APERTURE_INTERNAL_TRACE_SUBSCRIBE, type InternalTraceListener } from "./internal-trace.js";
import { TraceRecorder } from "./trace-recorder.js";
import { buildTraceEventTransition } from "./trace-event-transition.js";
import { OperatorEngagementController, sameAttentionView } from "./aperture-core-engagement.js";
import {
  ApertureCoreListeners,
  type ApertureCoreListenerHealthSnapshot,
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
import { buildObservationSignal } from "./aperture-core-signals.js";
import {
  buildApertureCoordinator,
  cloneSurfaceCapabilities,
  normalizeApertureCoreRuntimeSetup,
} from "./aperture-core-runtime-setup.js";
import type { PreparedPublishedEvent, PublishOptions } from "./aperture-core-event-preparation.js";
import {
  assertValidEvent,
  assertValidFrameResponse,
  assertValidSignal,
  assertValidSourceEvent,
} from "./aperture-core-validation.js";
import { APERTURE_INTERNAL_READ_HEALTH } from "./internal-health.js";
import { createCoreClock, type CoreClock } from "./time.js";
import type { EpisodeTrackerStats } from "./episode-tracker.js";
import type { TaskViewStoreStats } from "./task-view-store.js";

export type {
  AttentionFrameListener,
  AttentionTaskViewListener,
  AttentionViewListener,
  AttentionResponseListener,
  AttentionSignalListener,
  AttentionTraceListener,
} from "./aperture-core-listeners.js";

export type ApertureCoreOptions = {
  apertureProfile?: ApertureProfile;
  memoryProfile?: MemoryProfile;
  policyConfig?: PolicyConfig;
  profileStore?: ProfileStore;
  markdownRootDir?: string;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
  operatorPresence?: AttentionOperatorPresence;
  responseExpiryMs?: number;
  /** Optional wall-clock override for deterministic replay and testing. */
  timeSource?: () => number;
};

export type { PublishOptions } from "./aperture-core-event-preparation.js";

export type ApertureCoreHealthSnapshot = {
  attentionState: AttentionState;
  operatorPresence: AttentionOperatorPresence;
  responseExpiryMs: number | null;
  surfaceCapabilities: AttentionSurfaceCapabilities;
  listeners: ApertureCoreListenerHealthSnapshot;
  stores: {
    taskViews: TaskViewStoreStats;
    signals: AttentionSignalStoreStats;
    episodes: EpisodeTrackerStats;
  };
};

export class ApertureCore {
  private readonly listeners = new ApertureCoreListeners();
  private readonly taskViews = new TaskViewStore();
  private readonly heuristics = new AttentionAdjustments();
  private readonly evaluation = new EventEvaluator();
  private readonly traceRecorder = new TraceRecorder();
  private coordinator: JudgmentCoordinator;
  private readonly planner = new FramePlanner();
  private readonly attentionEvidence: ApertureCoreAttentionEvidence;
  private readonly frameLifecycle: ApertureCoreFrameLifecycle;
  private readonly profileStore: ProfileStore | undefined;
  private readonly markdownRootDir: string | undefined;
  private baseMemoryProfile: MemoryProfile;
  private apertureProfile: ApertureProfile | undefined;
  private policyConfig: PolicyConfig | undefined;
  private surfaceCapabilities: AttentionSurfaceCapabilities;
  private operatorPresence: AttentionOperatorPresence;
  private readonly responseExpiryMs: number | undefined;
  private readonly clock: CoreClock;
  private readonly signals: AttentionSignalStore;
  private readonly episodes: EpisodeTracker;
  private readonly operatorEngagement: OperatorEngagementController;
  private reloadInFlight: Promise<boolean> | null = null;

  constructor(options: ApertureCoreOptions = {}) {
    const runtime = normalizeApertureCoreRuntimeSetup(options);
    this.markdownRootDir = options.markdownRootDir;
    this.profileStore = options.profileStore;
    this.apertureProfile = runtime.apertureProfile;
    this.policyConfig = runtime.policyConfig;
    this.surfaceCapabilities = runtime.surfaceCapabilities;
    this.operatorPresence = runtime.operatorPresence;
    this.responseExpiryMs = runtime.responseExpiryMs;
    this.clock = createCoreClock(runtime.timeSource);
    this.signals = new AttentionSignalStore({ clock: this.clock });
    this.episodes = new EpisodeTracker({ clock: this.clock });
    this.operatorEngagement = new OperatorEngagementController(runtime.timeSource);
    this.baseMemoryProfile = runtime.baseMemoryProfile;
    this.coordinator = buildApertureCoordinator(runtime);
    this.attentionEvidence = new ApertureCoreAttentionEvidence({
      signals: this.signals,
      episodes: this.episodes,
      clock: this.clock,
      getTaskView: (taskId) => this.getTaskView(taskId),
      getAttentionView: () => this.getAttentionView(),
      getOperatorPresence: () => this.getOperatorPresence(),
      getSurfaceCapabilities: () => this.getSurfaceCapabilities(),
    });
    this.frameLifecycle = new ApertureCoreFrameLifecycle({
      taskViews: this.taskViews,
      planner: this.planner,
      episodes: this.episodes,
      clock: this.clock,
      responseExpiryMs: this.responseExpiryMs,
      getAttentionView: () => this.getAttentionView(),
      recordSignal: (signal) => this.recordSignal(signal),
      clearOperatorEngagement: (taskId, interactionId) =>
        this.operatorEngagement.clear(taskId, interactionId),
      notifyFrame: (taskId, frame) => this.listeners.emitFrame(taskId, frame),
      notifyTaskView: (taskId, taskView) => this.listeners.emitTaskView(taskId, taskView),
      notifyAttentionView: () => this.listeners.emitAttentionView(this.getAttentionView()),
      emitResponse: (response) => this.listeners.emitResponse(response),
    });
  }

  static async fromMarkdown(rootDir: string): Promise<ApertureCore> {
    const { profileStore, markdownRootDir, apertureProfile, memoryProfile, policyConfig } =
      await loadMarkdownRuntimeState(rootDir);

    return new ApertureCore({
      apertureProfile,
      memoryProfile,
      policyConfig,
      profileStore,
      markdownRootDir,
    });
  }

  async reloadMarkdown(): Promise<boolean> {
    if (!this.profileStore || !this.markdownRootDir) {
      return false;
    }

    if (this.reloadInFlight) {
      return this.reloadInFlight;
    }

    this.reloadInFlight = this.performMarkdownReload();
    try {
      return await this.reloadInFlight;
    } finally {
      this.reloadInFlight = null;
    }
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
    const eventTransition = buildTraceEventTransition(
      transitionKind,
      originalEvent,
      finalizedEvent,
    );
    const current = this.getFrame(finalizedEvent.taskId);
    const evidence = this.attentionEvidence.assemble(finalizedEvent.taskId, current);
    const taskSummary = evidence.taskSignalSummary;
    const globalSummary = evidence.globalSignalSummary;
    const preAttentionView = evidence.attentionView;
    const evaluation = this.evaluation.evaluate(finalizedEvent);

    switch (evaluation.kind) {
      case "noop": {
        this.notifyTrace(
          this.traceRecorder.recordNoop(
            buildPublishTraceSnapshot({
              timestamp: this.nowIso(),
              event: finalizedEvent,
              eventTransition,
              evidence,
              taskView: evidence.currentTaskView,
              attentionView: preAttentionView,
            }),
          ),
        );
        return null;
      }
      case "clear": {
        const result = this.frameLifecycle.applyClear(finalizedEvent.taskId);
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(
          this.traceRecorder.recordClear(
            buildPublishTraceSnapshot({
              timestamp: this.nowIso(),
              event: finalizedEvent,
              eventTransition,
              evidence,
              taskView: this.getTaskView(finalizedEvent.taskId),
              attentionView: postAttentionView,
            }),
            finalizedEvent.taskId,
          ),
        );
        return result;
      }
      case "candidate": {
        const candidate = this.prepareCandidateForJudgment(
          evaluation.candidate,
          taskSummary,
          globalSummary,
        );
        const explanation = this.explainCandidateDecision(
          finalizedEvent.taskId,
          candidate,
          evidence,
        );
        const result = this.applyCandidateDecision(explanation, evidence, preAttentionView);
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(
          this.traceRecorder.recordCandidate(
            buildPublishTraceSnapshot({
              timestamp: this.nowIso(),
              event: finalizedEvent,
              eventTransition,
              evidence,
              taskView: this.getTaskView(finalizedEvent.taskId),
              attentionView: postAttentionView,
            }),
            {
              original: evaluation.candidate,
              adjusted: candidate,
              explanation,
              result,
            },
          ),
        );
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
    return this.episodes.assign(this.heuristics.apply(candidate, taskSummary, globalSummary));
  }

  private explainCandidateDecision(
    taskId: string,
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
  ): AttentionDecisionExplanation {
    const candidateEvidence = this.attentionEvidence.augmentContinuitySignalSummary(
      taskId,
      candidate,
      evidence,
    );
    return this.coordinator.explain(evidence.currentFrame, candidate, candidateEvidence);
  }

  private applyCandidateDecision(
    explanation: AttentionDecisionExplanation,
    evidence: AttentionEvidenceContext,
    preAttentionView: AttentionView,
  ): AttentionFrame | null {
    switch (explanation.decision.kind) {
      case "auto_approve":
        return this.frameLifecycle.applyAutoResponse(
          explanation.decision.candidate,
          explanation.decision.response,
        );
      case "ambient":
        return this.frameLifecycle.materializePeripheralFrame(
          explanation.decision.candidate,
          "ambient",
          preAttentionView,
        );
      case "queue":
        return this.frameLifecycle.materializePeripheralFrame(
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

    if (this.frameLifecycle.shouldRetireSupersededEpisodeFrames(candidate, preAttentionView)) {
      return this.frameLifecycle.commitFrame(
        this.frameLifecycle.applyResponseExpiry(
          this.planner.plan(candidate, evidence.currentFrame),
        ),
        this.frameLifecycle.findSupersededEpisodeFrames(candidate, preAttentionView),
      );
    }

    const existingPeripheralFrame = candidate.episodeId
      ? this.frameLifecycle.findPeripheralEpisodeFrame(candidate.episodeId, preAttentionView)
      : null;

    if (
      existingPeripheralFrame &&
      this.frameLifecycle.shouldPromotePeripheralEpisodeFrame(explanation)
    ) {
      return this.frameLifecycle.promotePeripheralEpisodeFrame(
        candidate,
        existingPeripheralFrame.frame,
      );
    }

    return existingPeripheralFrame
      ? this.frameLifecycle.materializePeripheralFrame(
          candidate,
          selectPeripheralBucket(candidate, explanation.policy, evidence.surfaceCapabilities),
          preAttentionView,
        )
      : this.frameLifecycle.commitFrame(
          this.frameLifecycle.applyResponseExpiry(
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
    this.frameLifecycle.submit(response);
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

  [APERTURE_INTERNAL_READ_HEALTH](): ApertureCoreHealthSnapshot {
    return {
      attentionState: this.getAttentionState(),
      operatorPresence: this.getOperatorPresence(),
      responseExpiryMs: this.responseExpiryMs ?? null,
      surfaceCapabilities: this.getSurfaceCapabilities(),
      listeners: this.listeners.getHealthSnapshot(),
      stores: {
        taskViews: this.taskViews.stats(),
        signals: this.signals.stats(),
        episodes: this.episodes.stats(),
      },
    };
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
    if (!this.frameLifecycle.findFrameByInteractionId(taskId, interactionId)) {
      return;
    }

    const previousAttentionView = this.getAttentionView();
    this.operatorEngagement.engage(taskId, interactionId, options, () => {
      const livePreviousAttentionView = this.getAttentionView();
      this.operatorEngagement.clear(taskId, interactionId);
      const nextAttentionView = this.getAttentionView();
      if (!sameAttentionView(livePreviousAttentionView, nextAttentionView)) {
        this.notifyAttentionView();
      }
    });
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
      apertureProfile: this.apertureProfile,
      baseMemoryProfile: this.baseMemoryProfile,
      policyConfig: this.policyConfig,
    });
    return snapshot;
  }

  markViewed(taskId: string, interactionId: string, options: { surface?: string } = {}): void {
    const frame = this.frameLifecycle.findFrame(taskId, interactionId);
    this.recordSignal(
      buildObservationSignal("viewed", taskId, interactionId, this.nowIso(), frame, options),
    );
  }

  markTimedOut(
    taskId: string,
    interactionId: string,
    options: { surface?: string; timeoutMs?: number } = {},
  ): void {
    const frame = this.frameLifecycle.findFrame(taskId, interactionId);
    this.recordSignal(
      buildObservationSignal("timed_out", taskId, interactionId, this.nowIso(), frame, options),
    );
  }

  markContextExpanded(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.frameLifecycle.findFrame(taskId, interactionId);
    this.recordSignal(
      buildObservationSignal(
        "context_expanded",
        taskId,
        interactionId,
        this.nowIso(),
        frame,
        options,
      ),
    );
  }

  markContextSkipped(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.frameLifecycle.findFrame(taskId, interactionId);
    this.recordSignal(
      buildObservationSignal(
        "context_skipped",
        taskId,
        interactionId,
        this.nowIso(),
        frame,
        options,
      ),
    );
  }

  recordSignal(signal: AttentionSignal): void {
    assertValidSignal(signal);
    this.signals.record(signal);
    this.listeners.emitSignal(signal);
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
    return this.operatorEngagement.readFocusedInteractionId(
      (taskId, interactionId) =>
        this.frameLifecycle.findFrameByInteractionId(taskId, interactionId) !== null,
    );
  }

  private notifyTrace(trace: InternalApertureTrace): void {
    this.listeners.emitTrace(trace);
  }

  private nowIso(): string {
    return this.clock.nowIso();
  }

  private async performMarkdownReload(): Promise<boolean> {
    const { apertureProfile, memoryProfile, policyConfig } = await reloadMarkdownRuntimeState({
      profileStore: this.profileStore!,
      markdownRootDir: this.markdownRootDir!,
      apertureProfile: this.apertureProfile,
      memoryProfile: this.baseMemoryProfile,
      policyConfig: this.policyConfig,
    });

    const nextCoordinator = buildApertureCoordinator({
      apertureProfile,
      baseMemoryProfile: memoryProfile,
      policyConfig,
    });

    this.apertureProfile = apertureProfile;
    this.baseMemoryProfile = memoryProfile;
    this.policyConfig = policyConfig;
    this.coordinator = nextCoordinator;
    return true;
  }
}
