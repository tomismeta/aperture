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
import { MemoryAccumulator } from "./memory-aggregator.js";
import { forecastAttentionPressure } from "./attention-pressure.js";
import { selectPeripheralBucket } from "./attention-planner.js";
import { ApertureCoreAttentionEvidence } from "./aperture-core-attention-evidence.js";
import { ApertureCoreFrameLifecycle } from "./aperture-core-frame-lifecycle.js";
import {
  ApertureCoreRelationLifecycle,
  findSupersededEpisodeFrames,
} from "./aperture-core-relation-lifecycle.js";
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

export type AttentionPressureSnapshot = {
  level: "steady" | "elevated" | "high";
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
  private readonly relationLifecycle: ApertureCoreRelationLifecycle;
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
  private persistenceTail: Promise<void> | null = null;
  private readonly memory = new MemoryAccumulator();

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
      getTaskView: (taskId) => this.readTaskView(taskId),
      getAttentionView: () => this.readAttentionView(),
      getOperatorPresence: () => this.getOperatorPresence(),
      getSurfaceCapabilities: () => this.getSurfaceCapabilities(),
    });
    const lifecycleRuntime = {
      taskViews: this.taskViews,
      planner: this.planner,
      episodes: this.episodes,
      clock: this.clock,
      responseExpiryMs: this.responseExpiryMs,
      getAttentionView: () => this.readAttentionView(),
      recordSignal: (signal: AttentionSignal) => this.recordOwnedSignal(signal),
      clearOperatorEngagement: (taskId: string | undefined, interactionId: string | undefined) =>
        this.operatorEngagement.clear(taskId, interactionId),
      notifyFrame: (taskId: string, frame: AttentionFrame | null) =>
        this.listeners.emitFrame(taskId, frame),
      notifyTaskView: (taskId: string, taskView: AttentionTaskView) =>
        this.listeners.emitTaskView(taskId, taskView),
      notifyAttentionView: () => this.listeners.emitAttentionView(this.readAttentionView()),
      emitResponse: (response: AttentionResponse) => this.listeners.emitResponse(response),
    };
    this.frameLifecycle = new ApertureCoreFrameLifecycle(lifecycleRuntime);
    this.relationLifecycle = new ApertureCoreRelationLifecycle(lifecycleRuntime);
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

    this.reloadInFlight = this.serializePersistence(() => this.performMarkdownReload());
    try {
      return await this.reloadInFlight;
    } finally {
      this.reloadInFlight = null;
    }
  }

  publishSourceEvent(event: SourceEvent): AttentionFrame | null {
    assertValidSourceEvent(event);
    return structuredClone(
      this.publishPreparedEvent(preparePublishedSourceEvent(structuredClone(event))),
    );
  }

  publish(event: ApertureEvent, options: PublishOptions = {}): AttentionFrame | null {
    // Live event flow:
    // `SourceEvent/ApertureEvent -> finalized event -> EventEvaluator
    // -> AttentionCandidate -> AttentionJudgmentInput-aware judgment ->
    // AttentionFrame/AttentionView + trace`
    assertValidEvent(event);
    return structuredClone(
      this.publishPreparedEvent(preparePublishedEvent(structuredClone(event), options)),
    );
  }

  private publishPreparedEvent(preparedEvent: PreparedPublishedEvent): AttentionFrame | null {
    const { finalizedEvent, originalEvent, transitionKind } = preparedEvent;
    const eventTransition = buildTraceEventTransition(
      transitionKind,
      originalEvent,
      finalizedEvent,
    );
    const current = this.readFrame(finalizedEvent.taskId);
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
        const postAttentionView = this.readAttentionView();
        this.notifyTrace(
          this.traceRecorder.recordClear(
            buildPublishTraceSnapshot({
              timestamp: this.nowIso(),
              event: finalizedEvent,
              eventTransition,
              evidence,
              taskView: this.readTaskView(finalizedEvent.taskId),
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
        const suppressed = shouldSuppressObsoleteEpisodeCandidate(explanation.decision.candidate);
        const result = this.applyCandidateDecision(explanation, evidence, preAttentionView);
        const postAttentionView = this.readAttentionView();
        this.notifyTrace(
          this.traceRecorder.recordCandidate(
            buildPublishTraceSnapshot({
              timestamp: this.nowIso(),
              event: finalizedEvent,
              eventTransition,
              evidence,
              taskView: this.readTaskView(finalizedEvent.taskId),
              attentionView: postAttentionView,
            }),
            {
              original: evaluation.candidate,
              adjusted: candidate,
              explanation,
              result,
              suppressed,
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
    if (shouldSuppressObsoleteEpisodeCandidate(explanation.decision.candidate)) {
      return null;
    }

    if (
      explanation.decision.kind !== "auto_approve" &&
      this.relationLifecycle.shouldRetireResolvedEpisodeFrames(
        explanation.decision.candidate,
        preAttentionView,
      )
    ) {
      return this.relationLifecycle.materializeResolvedEpisodeFrame(
        explanation.decision.candidate,
        preAttentionView,
      );
    }

    switch (explanation.decision.kind) {
      case "auto_approve":
        return this.frameLifecycle.applyAutoResponse(
          explanation.decision.candidate,
          explanation.decision.response,
        );
      case "ambient":
        return this.applyPeripheralDecision(explanation, "ambient", preAttentionView);
      case "queue":
        return this.applyPeripheralDecision(explanation, "queue", preAttentionView);
      case "activate":
        return this.applyActivationDecision(explanation, evidence, preAttentionView);
    }
  }

  private applyPeripheralDecision(
    explanation: AttentionDecisionExplanation,
    bucket: "queue" | "ambient",
    preAttentionView: AttentionView,
  ): AttentionFrame {
    const candidate = explanation.decision.candidate;
    const existingNowFrame = candidate.episodeId
      ? this.frameLifecycle.findNowEpisodeFrame(candidate.episodeId, preAttentionView)
      : null;
    if (
      bucket === "queue" &&
      existingNowFrame &&
      explanation.ambiguity === null &&
      hasVisibleStatusEpisodeRefreshOverride(explanation) &&
      shouldRefreshVisibleStatusEpisodeFrame(candidate, existingNowFrame)
    ) {
      return this.frameLifecycle.refreshVisibleEpisodeFrame(candidate, existingNowFrame);
    }

    return this.frameLifecycle.materializePeripheralFrame(candidate, bucket, preAttentionView);
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

    const supersededFrames = findSupersededEpisodeFrames(candidate, preAttentionView);
    if (supersededFrames.length > 0) {
      return this.frameLifecycle.commitFrame(
        this.frameLifecycle.applyResponseExpiry(
          this.planner.plan(candidate, evidence.currentFrame),
        ),
        supersededFrames,
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
    return structuredClone(this.readFrame(taskId));
  }

  subscribe(taskId: string, listener: AttentionFrameListener): () => void {
    return this.listeners.subscribeFrame(taskId, listener, this.readFrame(taskId));
  }

  subscribeTaskView(taskId: string, listener: AttentionTaskViewListener): () => void {
    return this.listeners.subscribeTaskView(taskId, listener, this.readTaskView(taskId));
  }

  subscribeAttentionView(listener: AttentionViewListener): () => void {
    return this.listeners.subscribeAttentionView(listener, this.readAttentionView());
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
    this.frameLifecycle.submit(structuredClone(response));
  }

  retract(taskId: string, interactionId: string): boolean {
    return this.frameLifecycle.retract(taskId, interactionId);
  }

  getTaskView(taskId: string): AttentionTaskView {
    return structuredClone(this.readTaskView(taskId));
  }

  getAttentionView(): AttentionView {
    return structuredClone(this.readAttentionView());
  }

  getSignals(taskId?: string): AttentionSignal[] {
    return structuredClone(this.signals.list(taskId));
  }

  getSignalSummary(taskId?: string): AttentionSignalSummary {
    return this.signals.summarize(taskId);
  }

  getAttentionState(taskId?: string): AttentionState {
    return deriveAttentionState(this.signals.summarize(taskId));
  }

  getAttentionPressure(): AttentionPressureSnapshot {
    const { level } = forecastAttentionPressure(
      this.signals.summarize(),
      this.readAttentionView(),
      this.clock.nowIso(),
    );
    return { level };
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
    if (!this.frameLifecycle.findFrame(taskId, interactionId)) {
      return;
    }

    const previousAttentionView = this.readAttentionView();
    this.operatorEngagement.engage(taskId, interactionId, options, (expiredInteractionId) => {
      const livePreviousAttentionView = this.readAttentionView(expiredInteractionId);
      const nextAttentionView = this.readAttentionView();
      if (!sameAttentionView(livePreviousAttentionView, nextAttentionView)) {
        this.notifyAttentionView();
      }
    });
    const nextAttentionView = this.readAttentionView();
    if (!sameAttentionView(previousAttentionView, nextAttentionView)) {
      this.notifyAttentionView();
    }
  }

  setSurfaceCapabilities(capabilities: AttentionSurfaceCapabilities): void {
    this.surfaceCapabilities = cloneSurfaceCapabilities(capabilities);
  }

  snapshotMemoryProfile(now: string = this.nowIso()): MemoryProfile {
    return this.memory.snapshot(this.baseMemoryProfile, now).profile;
  }

  async checkpointMemory(now: string = this.nowIso()): Promise<MemoryProfile | null> {
    if (!this.profileStore) {
      return null;
    }
    return this.serializePersistence(async () => {
      const { profile, accounting } = this.memory.snapshot(this.baseMemoryProfile, now);
      await this.profileStore!.saveMemoryProfile(structuredClone(profile));
      this.baseMemoryProfile = profile;
      this.memory.commit(accounting);
      this.coordinator = buildApertureCoordinator({
        apertureProfile: this.apertureProfile,
        baseMemoryProfile: profile,
        policyConfig: this.policyConfig,
      });
      return structuredClone(profile);
    });
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
    this.recordOwnedSignal(structuredClone(signal));
  }

  private recordOwnedSignal(signal: AttentionSignal): void {
    this.memory.record(signal);
    this.signals.record(signal);
    this.listeners.emitSignal(signal);
  }

  private readFrame(taskId: string): AttentionFrame | null {
    return this.taskViews.get(taskId).now;
  }

  private readTaskView(taskId: string): AttentionTaskView {
    return this.taskViews.get(taskId);
  }

  private readAttentionView(focusedInteractionId?: string): AttentionView {
    return buildAttentionView(this.taskViews.values(), {
      globalAttentionState: this.getAttentionState(),
      operatorPresence: this.operatorPresence,
      focusedInteractionId: focusedInteractionId ?? this.readOperatorEngagementInteractionId(),
    });
  }

  private serializePersistence<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.persistenceTail ? this.persistenceTail.then(operation) : operation();
    this.persistenceTail = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  private notifyFrame(taskId: string, frame: AttentionFrame | null): void {
    this.listeners.emitFrame(taskId, frame);
  }

  private notifyTaskView(taskId: string, taskView: AttentionTaskView): void {
    this.listeners.emitTaskView(taskId, taskView);
  }

  private notifyAttentionView(): void {
    this.listeners.emitAttentionView(this.readAttentionView());
  }

  private readOperatorEngagementInteractionId(): string | null {
    return this.operatorEngagement.readFocusedInteractionId(
      (taskId, interactionId) => this.frameLifecycle.findFrame(taskId, interactionId) !== null,
    );
  }

  private notifyTrace(trace: InternalApertureTrace): void {
    this.listeners.emitTrace(trace);
  }

  private nowIso(): string {
    return this.clock.nowIso();
  }

  private async performMarkdownReload(): Promise<boolean> {
    const { apertureProfile, memoryProfile, policyConfig } = structuredClone(
      await reloadMarkdownRuntimeState({
        profileStore: this.profileStore!,
        markdownRootDir: this.markdownRootDir!,
        apertureProfile: structuredClone(this.apertureProfile),
        memoryProfile: structuredClone(this.baseMemoryProfile),
        policyConfig: structuredClone(this.policyConfig),
      }),
    );

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

function shouldSuppressObsoleteEpisodeCandidate(candidate: AttentionCandidate): boolean {
  return candidate.episodeObsolete === true;
}

function shouldRefreshVisibleStatusEpisodeFrame(
  candidate: AttentionCandidate,
  existingFrame: AttentionFrame,
): boolean {
  return (
    candidate.mode === "status" &&
    existingFrame.mode === "status" &&
    isRefreshableStatusResponse(candidate.responseSpec.kind) &&
    isRefreshableStatusResponse(existingFrame.responseSpec?.kind)
  );
}

function isRefreshableStatusResponse(kind: string | undefined): boolean {
  return kind === "none" || kind === "acknowledge";
}

function hasVisibleStatusEpisodeRefreshOverride(
  explanation: AttentionDecisionExplanation,
): boolean {
  const winningOverride = explanation.continuityEvaluations.find(
    (evaluation) => evaluation.kind === "override",
  );
  return (
    winningOverride !== undefined &&
    (winningOverride.rule === "visible_episode" || winningOverride.rule === "same_episode") &&
    winningOverride.decision.kind === "queue"
  );
}
