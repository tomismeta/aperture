import type {
  ApertureEvent,
  HumanInputRequest,
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
import { deriveAttentionState, type AttentionState } from "./attention-state.js";
import { EpisodeTracker, readFrameEpisodeId } from "./episode-tracker.js";
import { EventEvaluator } from "./event-evaluator.js";
import { FramePlanner } from "./frame-planner.js";
import { JudgmentCoordinator } from "./judgment-coordinator.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { AttentionSignalStore } from "./attention-signal-store.js";
import { loadJudgmentConfig, type JudgmentConfig } from "./judgment-config.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { distillMemoryProfile, signalMetadataForCandidate, signalMetadataForFrame } from "./memory-aggregator.js";
import { normalizeSourceEvent } from "./semantic-normalizer.js";
import { AttentionPolicy } from "./attention-policy.js";
import { forecastAttentionPressure } from "./attention-pressure.js";
import { ProfileStore, type MemoryProfile, type UserProfile } from "./profile-store.js";
import { AttentionPlanner } from "./attention-planner.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import {
  DEFAULT_ATTENTION_SURFACE_CAPABILITIES,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
import { TaskViewStore } from "./task-view-store.js";
import type { ApertureTrace } from "./trace.js";
import { TraceRecorder } from "./trace-recorder.js";
import { AttentionValue } from "./attention-value.js";

export type AttentionFrameListener = (frame: AttentionFrame | null) => void;
export type AttentionTaskViewListener = (taskView: AttentionTaskView) => void;
export type AttentionViewListener = (attentionView: AttentionView) => void;
export type AttentionResponseListener = (response: AttentionResponse) => void;
export type AttentionSignalListener = (signal: AttentionSignal) => void;
export type AttentionTraceListener = (trace: ApertureTrace) => void;

export type ApertureCoreOptions = {
  userProfile?: UserProfile;
  memoryProfile?: MemoryProfile;
  judgmentConfig?: JudgmentConfig;
  profileStore?: ProfileStore;
  markdownRootDir?: string;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
};

export class ApertureCore {
  private readonly frames = new Map<string, AttentionFrame>();
  private readonly frameListeners = new Map<string, Set<AttentionFrameListener>>();
  private readonly taskViewListeners = new Map<string, Set<AttentionTaskViewListener>>();
  private readonly attentionViewListeners = new Set<AttentionViewListener>();
  private readonly responseListeners = new Set<AttentionResponseListener>();
  private readonly signalListeners = new Set<AttentionSignalListener>();
  private readonly traceListeners = new Set<AttentionTraceListener>();
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

  constructor(options: ApertureCoreOptions = {}) {
    this.markdownRootDir = options.markdownRootDir;
    this.profileStore = options.profileStore;
    this.userProfile = options.userProfile;
    this.judgmentConfig = options.judgmentConfig;
    this.surfaceCapabilities = options.surfaceCapabilities
      ? {
          topology: { ...options.surfaceCapabilities.topology },
          responses: { ...options.surfaceCapabilities.responses },
        }
      : {
          topology: { ...DEFAULT_ATTENTION_SURFACE_CAPABILITIES.topology },
          responses: { ...DEFAULT_ATTENTION_SURFACE_CAPABILITIES.responses },
        };
    this.baseMemoryProfile = options.memoryProfile ?? {
      version: MARKDOWN_SCHEMA_VERSION,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
      sessionCount: 0,
    };
    this.coordinator = this.createCoordinator();
  }

  private createCoordinator(): JudgmentCoordinator {
    return new JudgmentCoordinator(
      new AttentionPolicy({
        ...(this.userProfile !== undefined ? { userProfile: this.userProfile } : {}),
        ...(this.judgmentConfig !== undefined ? { judgmentConfig: this.judgmentConfig } : {}),
      }),
      new AttentionValue({
        memoryProfile: this.baseMemoryProfile,
      }),
      new AttentionPlanner({
        ...(this.judgmentConfig?.plannerDefaults !== undefined
          ? { plannerDefaults: this.judgmentConfig.plannerDefaults }
          : {}),
      }),
      {
        ...(this.judgmentConfig?.ambiguityDefaults !== undefined
          ? { ambiguityDefaults: this.judgmentConfig.ambiguityDefaults }
          : {}),
      },
    );
  }

  static async fromMarkdown(rootDir: string): Promise<ApertureCore> {
    const profileStore = new ProfileStore(rootDir);
    const fallbackUser: UserProfile = {
      version: MARKDOWN_SCHEMA_VERSION,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
    };
    const fallbackMemory: MemoryProfile = {
      version: MARKDOWN_SCHEMA_VERSION,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
      sessionCount: 0,
    };
    const fallbackJudgment: JudgmentConfig = {
      version: MARKDOWN_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
    };

    const [userProfile, memoryProfile, judgmentConfig] = await Promise.all([
      profileStore.loadUserProfile(fallbackUser),
      profileStore.loadMemoryProfile(fallbackMemory),
      loadJudgmentConfig(rootDir, fallbackJudgment),
    ]);

    return new ApertureCore({
      userProfile,
      memoryProfile,
      judgmentConfig,
      profileStore,
      markdownRootDir: rootDir,
    });
  }

  async reloadMarkdown(): Promise<boolean> {
    if (!this.profileStore || !this.markdownRootDir) {
      return false;
    }

    const fallbackUser: UserProfile = this.userProfile ?? {
      version: MARKDOWN_SCHEMA_VERSION,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
    };
    const fallbackMemory: MemoryProfile = this.baseMemoryProfile;
    const fallbackJudgment: JudgmentConfig = this.judgmentConfig ?? {
      version: MARKDOWN_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
    };

    const [userProfile, memoryProfile, judgmentConfig] = await Promise.all([
      this.profileStore.loadUserProfile(fallbackUser),
      this.profileStore.loadMemoryProfile(fallbackMemory),
      loadJudgmentConfig(this.markdownRootDir, fallbackJudgment),
    ]);

    this.userProfile = userProfile;
    this.baseMemoryProfile = memoryProfile;
    this.judgmentConfig = judgmentConfig;
    this.coordinator = this.createCoordinator();
    return true;
  }

  publishSourceEvent(event: SourceEvent): AttentionFrame | null {
    this.assertValidSourceEvent(event);
    return this.publish(normalizeSourceEvent(event));
  }

  publish(event: ApertureEvent): AttentionFrame | null {
    this.assertValidEvent(event);
    const taskSummary = this.signals.summarize(event.taskId);
    const globalSummary = this.signals.summarize();
    const taskAttentionState = deriveAttentionState(taskSummary);
    const globalAttentionState = deriveAttentionState(globalSummary);
    const preAttentionView = this.getAttentionView();
    const pressureForecast = forecastAttentionPressure(globalSummary, preAttentionView);
    const evaluation = this.evaluation.evaluate(event);

    switch (evaluation.kind) {
      case "noop": {
        this.notifyTrace(this.traceRecorder.recordNoop({
          timestamp: new Date().toISOString(),
          event,
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          pressureForecast,
          current: this.getFrame(event.taskId),
          taskView: this.getTaskView(event.taskId),
          attentionView: preAttentionView,
        }));
        return null;
      }
      case "clear": {
        const current = this.getFrame(event.taskId);
        const result = this.applyClear(event.taskId);
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(this.traceRecorder.recordClear({
          timestamp: new Date().toISOString(),
          event,
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          pressureForecast,
          current,
          taskView: this.getTaskView(event.taskId),
          attentionView: postAttentionView,
        }, event.taskId));
        return result;
      }
      case "candidate": {
        const current = this.getFrame(event.taskId);
        const candidate = this.episodes.assign(this.heuristics.apply(
          evaluation.candidate,
          taskSummary,
          globalSummary,
        ));
        const explanation = this.coordinator.explain(current, candidate, {
          attentionView: preAttentionView,
          taskSummary,
          globalSummary,
          pressureForecast,
          surfaceCapabilities: this.surfaceCapabilities,
        });
        let result: AttentionFrame | null;
        switch (explanation.decision.kind) {
          case "auto_approve":
            result = this.applyAutoResponse(
              explanation.decision.candidate,
              explanation.decision.response,
            );
            break;
          case "keep":
            result = explanation.decision.frame;
            break;
          case "clear":
            result = this.applyClear(event.taskId);
            break;
          case "ambient":
            result = this.materializePeripheralFrame(
              explanation.decision.candidate,
              "ambient",
              preAttentionView,
            );
            break;
          case "queue":
            result = this.materializePeripheralFrame(
              explanation.decision.candidate,
              "queue",
              preAttentionView,
            );
            break;
          case "activate":
            result =
              explanation.decision.candidate.episodeId
              && this.findPeripheralEpisodeFrame(explanation.decision.candidate.episodeId, preAttentionView)
                ? this.materializePeripheralFrame(
                    explanation.decision.candidate,
                    this.preferredPeripheralBucket(explanation.decision.candidate),
                    preAttentionView,
                  )
                : this.commitFrame(this.planner.plan(explanation.decision.candidate, current));
            break;
        }
        const postAttentionView = this.getAttentionView();
        this.notifyTrace(this.traceRecorder.recordCandidate({
          timestamp: new Date().toISOString(),
          event,
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          pressureForecast,
          current,
          taskView: this.getTaskView(event.taskId),
          attentionView: postAttentionView,
        }, {
          original: evaluation.candidate,
          adjusted: candidate,
          explanation,
          result,
        }));
        return result;
      }
    }
  }

  getFrame(taskId: string): AttentionFrame | null {
    return this.frames.get(taskId) ?? null;
  }

  subscribe(taskId: string, listener: AttentionFrameListener): () => void {
    const listeners = this.frameListeners.get(taskId) ?? new Set<AttentionFrameListener>();
    listeners.add(listener);
    this.frameListeners.set(taskId, listeners);
    listener(this.getFrame(taskId));

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.frameListeners.delete(taskId);
      }
    };
  }

  subscribeTaskView(taskId: string, listener: AttentionTaskViewListener): () => void {
    const listeners = this.taskViewListeners.get(taskId) ?? new Set<AttentionTaskViewListener>();
    listeners.add(listener);
    this.taskViewListeners.set(taskId, listeners);
    listener(this.getTaskView(taskId));

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.taskViewListeners.delete(taskId);
      }
    };
  }

  subscribeAttentionView(listener: AttentionViewListener): () => void {
    this.attentionViewListeners.add(listener);
    listener(this.getAttentionView());
    return () => {
      this.attentionViewListeners.delete(listener);
    };
  }

  onResponse(listener: AttentionResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  onSignal(listener: AttentionSignalListener): () => void {
    this.signalListeners.add(listener);
    return () => {
      this.signalListeners.delete(listener);
    };
  }

  onTrace(listener: AttentionTraceListener): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  submit(response: AttentionResponse): void {
    this.assertValidFrameResponse(response);
    const current = this.findFrameByInteractionId(response.taskId, response.interactionId);
    if (!current) {
      return;
    }

    const timestamp = new Date().toISOString();
    this.recordSignal(this.signalForResponse(current, response, timestamp));
    this.episodes.resolveInteraction(response.interactionId);

    const previousTaskView = this.taskViews.get(response.taskId);
    const taskView = this.taskViews.resolve(response.taskId, response.interactionId);
    const newPrimary = taskView.active;
    if (newPrimary) {
      this.frames.set(response.taskId, newPrimary);
      this.recordAttentionShift(previousTaskView.active, newPrimary, timestamp);
      this.recordReturnSignal(previousTaskView, newPrimary, timestamp);
      this.notifyFrame(response.taskId, newPrimary);
    } else {
      this.frames.delete(response.taskId);
      this.notifyFrame(response.taskId, null);
    }
    this.notifyTaskView(response.taskId, taskView);
    this.notifyAttentionView();

    for (const listener of this.responseListeners) {
      listener(response);
    }
  }

  getTaskView(taskId: string): AttentionTaskView {
    return this.taskViews.get(taskId);
  }

  getAttentionView(): AttentionView {
    return buildAttentionView(this.taskViews.values(), {
      globalAttentionState: this.getAttentionState(),
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
    return {
      topology: { ...this.surfaceCapabilities.topology },
      responses: { ...this.surfaceCapabilities.responses },
    };
  }

  setSurfaceCapabilities(capabilities: AttentionSurfaceCapabilities): void {
    this.surfaceCapabilities = {
      topology: { ...capabilities.topology },
      responses: { ...capabilities.responses },
    };
  }

  snapshotMemoryProfile(now: string = new Date().toISOString()): MemoryProfile {
    return distillMemoryProfile(this.baseMemoryProfile, this.signals.list(), now);
  }

  async checkpointMemory(now: string = new Date().toISOString()): Promise<MemoryProfile | null> {
    if (!this.profileStore) {
      return null;
    }

    const snapshot = this.snapshotMemoryProfile(now);
    await this.profileStore.saveMemoryProfile(snapshot);
    this.baseMemoryProfile = snapshot;
    this.coordinator = this.createCoordinator();
    return snapshot;
  }

  markViewed(taskId: string, interactionId: string, options: { surface?: string } = {}): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal(this.observationSignal("viewed", taskId, interactionId, frame, options));
  }

  markTimedOut(
    taskId: string,
    interactionId: string,
    options: { surface?: string; timeoutMs?: number } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal({
      ...this.observationSignal("timed_out", taskId, interactionId, frame, options),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  markContextExpanded(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal({
      ...this.observationSignal("context_expanded", taskId, interactionId, frame, options),
      ...(options.section !== undefined ? { section: options.section } : {}),
    });
  }

  markContextSkipped(
    taskId: string,
    interactionId: string,
    options: { surface?: string; section?: string } = {},
  ): void {
    const frame = this.findFrame(taskId, interactionId);
    this.recordSignal({
      ...this.observationSignal("context_skipped", taskId, interactionId, frame, options),
      ...(options.section !== undefined ? { section: options.section } : {}),
    });
  }

  recordSignal(signal: AttentionSignal): void {
    this.assertValidSignal(signal);
    this.signals.record(signal);
    for (const listener of this.signalListeners) {
      listener(signal);
    }
  }

  private commitFrame(frame: AttentionFrame): AttentionFrame {
    const previousTaskView = this.taskViews.get(frame.taskId);
    const previousActive = previousTaskView.active;
    this.frames.set(frame.taskId, frame);
    const taskView = this.taskViews.setActive(frame.taskId, frame);
    this.recordAttentionShift(previousActive, frame, frame.timing.updatedAt);
    this.recordReturnSignal(previousTaskView, frame, frame.timing.updatedAt);
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

  private applyClear(taskId: string): null {
    const existingTaskView = this.taskViews.get(taskId);
    const hadAnyVisibleState =
      this.frames.has(taskId)
      || existingTaskView.active !== null
      || existingTaskView.queued.length > 0
      || existingTaskView.ambient.length > 0;

    if (!hadAnyVisibleState) {
      return null;
    }
    this.frames.delete(taskId);
    const taskView = this.taskViews.clear(taskId);
    this.notifyFrame(taskId, null);
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return null;
  }

  private queueFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.taskViews.enqueue(taskId, frame);
    this.recordDeferredSignal(frame, "queued");
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
  }

  private addAmbientFrame(taskId: string, frame: AttentionFrame): AttentionFrame {
    const taskView = this.taskViews.addAmbient(taskId, frame);
    this.recordDeferredSignal(frame, "suppressed");
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
  }

  private materializePeripheralFrame(
    candidate: AttentionCandidate,
    bucket: "queue" | "ambient",
    attentionView: AttentionView,
  ): AttentionFrame {
    const existing = candidate.episodeId ? this.findPeripheralEpisodeFrame(candidate.episodeId, attentionView) : null;
    if (!existing) {
      const planned = this.planner.plan(candidate, null);
      return bucket === "queue"
        ? this.queueFrame(candidate.taskId, planned)
        : this.addAmbientFrame(candidate.taskId, planned);
    }

    const nextBucket = existing.bucket === "queue" || bucket === "queue" ? "queue" : "ambient";
    const planned = this.planner.plan(candidate, existing.frame);
    const merged = {
      ...planned,
      id: existing.frame.id,
    };
    const previousTaskView = this.taskViews.discard(existing.frame.taskId, existing.frame.interactionId);
    this.notifyTaskView(existing.frame.taskId, previousTaskView);

    const nextTaskView =
      nextBucket === "queue"
        ? this.taskViews.enqueue(merged.taskId, merged)
        : this.taskViews.addAmbient(merged.taskId, merged);
    this.recordDeferredSignal(merged, nextBucket === "queue" ? "queued" : "suppressed", candidate);
    this.notifyTaskView(merged.taskId, nextTaskView);
    this.notifyAttentionView();
    return merged;
  }

  private preferredPeripheralBucket(candidate: AttentionCandidate): "queue" | "ambient" {
    if (
      !candidate.blocking
      && candidate.mode === "status"
      && candidate.consequence !== "high"
      && candidate.tone !== "critical"
    ) {
      return "ambient";
    }

    return "queue";
  }

  private findFrameByInteractionId(taskId: string, interactionId: string): AttentionFrame | null {
    const primary = this.frames.get(taskId);
    if (primary?.interactionId === interactionId) {
      return primary;
    }

    const taskView = this.taskViews.get(taskId);
    if (taskView.active?.interactionId === interactionId) {
      return taskView.active;
    }

    const queued = taskView.queued.find((frame) => frame.interactionId === interactionId);
    if (queued) {
      return queued;
    }

    const ambient = taskView.ambient.find((frame) => frame.interactionId === interactionId);
    if (ambient) {
      return ambient;
    }

    return null;
  }

  private findPeripheralEpisodeFrame(
    episodeId: string,
    attentionView: AttentionView,
  ): { frame: AttentionFrame; bucket: "queue" | "ambient" } | null {
    const queued = attentionView.queued.find((frame) => readFrameEpisodeId(frame) === episodeId);
    if (queued) {
      return { frame: queued, bucket: "queue" };
    }

    const ambient = attentionView.ambient.find((frame) => readFrameEpisodeId(frame) === episodeId);
    if (ambient) {
      return { frame: ambient, bucket: "ambient" };
    }

    return null;
  }

  private recordDeferredSignal(
    frame: AttentionFrame,
    reason: "queued" | "suppressed",
    sourceFrame: Pick<AttentionFrame, "taskId" | "interactionId" | "source"> = frame,
  ): void {
    this.recordSignal({
      kind: "deferred",
      taskId: sourceFrame.taskId,
      interactionId: sourceFrame.interactionId,
      timestamp: frame.timing.updatedAt,
      frameId: frame.id,
      ...(sourceFrame.source !== undefined ? { source: sourceFrame.source } : {}),
      reason,
      metadata: signalMetadataForFrame(frame),
    });
  }

  private notifyFrame(taskId: string, frame: AttentionFrame | null): void {
    for (const listener of this.frameListeners.get(taskId) ?? []) {
      listener(frame);
    }
  }

  private notifyTaskView(taskId: string, taskView: AttentionTaskView): void {
    for (const listener of this.taskViewListeners.get(taskId) ?? []) {
      listener(taskView);
    }
  }

  private notifyAttentionView(): void {
    const attentionView = this.getAttentionView();
    for (const listener of this.attentionViewListeners) {
      listener(attentionView);
    }
  }

  private notifyTrace(trace: ApertureTrace): void {
    for (const listener of this.traceListeners) {
      listener(trace);
    }
  }

  private signalForResponse(frame: AttentionFrame, response: AttentionResponse, timestamp: string): AttentionSignal {
    const latencyMs = this.calculateLatency(frame, timestamp);
    const base = {
      taskId: frame.taskId,
      interactionId: frame.interactionId,
      timestamp,
      frameId: frame.id,
      ...(frame.source !== undefined ? { source: frame.source } : {}),
      metadata: signalMetadataForFrame(frame),
    };

    if (response.response.kind === "dismissed") {
      return {
        kind: "dismissed",
        ...base,
        ...(latencyMs !== undefined ? { latencyMs } : {}),
      };
    }

    return {
      kind: "responded",
      ...base,
      responseKind: response.response.kind,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
  }

  private applyAutoResponse(candidate: AttentionCandidate, response: AttentionResponse): null {
    const timestamp = new Date().toISOString();
    this.recordSignal({
      kind: "responded",
      taskId: candidate.taskId,
      interactionId: candidate.interactionId,
      timestamp,
      ...(candidate.source !== undefined ? { source: candidate.source } : {}),
      responseKind: response.response.kind === "dismissed" ? "acknowledged" : response.response.kind,
      metadata: {
        ...signalMetadataForCandidate(candidate),
        autoResolved: true,
      },
    });
    this.episodes.resolveInteraction(candidate.interactionId);
    for (const listener of this.responseListeners) {
      listener(response);
    }
    return null;
  }

  private calculateLatency(frame: AttentionFrame, timestamp: string): number | undefined {
    const startedAt = Date.parse(frame.timing.updatedAt);
    const completedAt = Date.parse(timestamp);

    if (Number.isNaN(startedAt) || Number.isNaN(completedAt)) {
      return undefined;
    }

    return Math.max(0, completedAt - startedAt);
  }

  private recordAttentionShift(previous: AttentionFrame | null, next: AttentionFrame, timestamp: string): void {
    if (!previous || previous.interactionId === next.interactionId) {
      return;
    }

    const destinationSignal: AttentionSignal = {
      kind: "attention_shifted",
      taskId: next.taskId,
      interactionId: next.interactionId,
      timestamp,
      frameId: next.id,
      ...(next.source !== undefined ? { source: next.source } : {}),
      fromInteractionId: previous.interactionId,
      toInteractionId: next.interactionId,
    };
    this.recordSignal(destinationSignal);

    if (previous.taskId !== next.taskId) {
      this.recordSignal({
        kind: "attention_shifted",
        taskId: previous.taskId,
        interactionId: previous.interactionId,
        timestamp,
        frameId: previous.id,
        ...(previous.source !== undefined ? { source: previous.source } : {}),
        fromInteractionId: previous.interactionId,
        toInteractionId: next.interactionId,
      });
    }
  }

  private recordReturnSignal(previousTaskView: AttentionTaskView, next: AttentionFrame, timestamp: string): void {
    const from = previousTaskView.queued.some((frame) => frame.interactionId === next.interactionId)
      ? "queued"
      : previousTaskView.ambient.some((frame) => frame.interactionId === next.interactionId)
        ? "ambient"
        : null;

    if (!from) {
      return;
    }

    this.recordSignal({
      kind: "returned",
      taskId: next.taskId,
      interactionId: next.interactionId,
      timestamp,
      frameId: next.id,
      ...(next.source !== undefined ? { source: next.source } : {}),
      from,
    });
  }

  private observationSignal(
    kind: "viewed" | "timed_out" | "context_expanded" | "context_skipped",
    taskId: string,
    interactionId: string,
    frame: AttentionFrame | null,
    options: { surface?: string },
  ): Extract<
    AttentionSignal,
    { kind: "viewed" | "timed_out" | "context_expanded" | "context_skipped" }
  > {
    return {
      kind,
      taskId,
      interactionId,
      timestamp: new Date().toISOString(),
      ...(frame?.id !== undefined ? { frameId: frame.id } : {}),
      ...(frame?.source !== undefined ? { source: frame.source } : {}),
      ...(frame ? { metadata: signalMetadataForFrame(frame) } : {}),
      ...(options.surface !== undefined ? { surface: options.surface } : {}),
    };
  }

  private findFrame(taskId: string, interactionId: string): AttentionFrame | null {
    const taskView = this.taskViews.get(taskId);
    if (taskView.active?.interactionId === interactionId) {
      return taskView.active;
    }

    const queued = taskView.queued.find((frame) => frame.interactionId === interactionId);
    if (queued) {
      return queued;
    }

    return taskView.ambient.find((frame) => frame.interactionId === interactionId) ?? null;
  }

  private assertValidEvent(event: ApertureEvent): void {
    this.assertNonEmpty("event.id", event.id);
    this.assertNonEmpty("event.taskId", event.taskId);
    this.assertTimestamp("event.timestamp", event.timestamp);

    if (event.source !== undefined) {
      this.assertNonEmpty("event.source.id", event.source.id);
    }

    switch (event.type) {
      case "task.started":
      case "task.updated":
        this.assertNonEmpty("event.title", event.title);
        break;
      case "human.input.requested":
        this.assertNonEmpty("event.interactionId", event.interactionId);
        this.assertNonEmpty("event.title", event.title);
        this.assertNonEmpty("event.summary", event.summary);
        break;
      case "task.completed":
      case "task.cancelled":
        break;
    }
  }

  private assertValidSourceEvent(event: SourceEvent): void {
    this.assertNonEmpty("event.id", event.id);
    this.assertNonEmpty("event.taskId", event.taskId);
    this.assertTimestamp("event.timestamp", event.timestamp);

    if (event.source) {
      this.assertNonEmpty("event.source.id", event.source.id);
    }

    switch (event.type) {
      case "task.started":
        this.assertNonEmpty("event.title", event.title);
        return;
      case "task.updated":
        this.assertNonEmpty("event.title", event.title);
        this.assertTaskStatus("event.status", event.status);
        return;
      case "task.completed":
        return;
      case "task.cancelled":
        if (event.reason !== undefined) {
          this.assertNonEmpty("event.reason", event.reason);
        }
        return;
      case "human.input.requested":
        this.assertNonEmpty("event.interactionId", event.interactionId);
        this.assertNonEmpty("event.title", event.title);
        this.assertNonEmpty("event.summary", event.summary);
        this.assertHumanInputRequest("event.request", event.request);
        if (event.riskHint !== undefined) {
          this.assertConsequenceLevel("event.riskHint", event.riskHint);
        }
        return;
    }
  }

  private assertValidFrameResponse(response: AttentionResponse): void {
    this.assertNonEmpty("response.taskId", response.taskId);
    this.assertNonEmpty("response.interactionId", response.interactionId);

    switch (response.response.kind) {
      case "acknowledged":
      case "approved":
      case "rejected":
      case "dismissed":
        return;
      case "option_selected":
        if (response.response.optionIds.length === 0) {
          throw new Error("response.optionIds must contain at least one option id");
        }
        return;
      case "text_submitted":
        this.assertNonEmpty("response.text", response.response.text);
        return;
      case "form_submitted":
        if (
          response.response.values === null ||
          typeof response.response.values !== "object" ||
          Array.isArray(response.response.values)
        ) {
          throw new Error("response.values must be an object");
        }
        return;
    }
  }

  private assertValidSignal(signal: AttentionSignal): void {
    this.assertNonEmpty("signal.taskId", signal.taskId);
    this.assertNonEmpty("signal.interactionId", signal.interactionId);
    this.assertTimestamp("signal.timestamp", signal.timestamp);

    if (signal.source !== undefined) {
      this.assertNonEmpty("signal.source.id", signal.source.id);
    }
  }

  private assertNonEmpty(label: string, value: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
  }

  private assertTimestamp(label: string, value: string): void {
    this.assertNonEmpty(label, value);
    if (Number.isNaN(Date.parse(value))) {
      throw new Error(`${label} must be a valid ISO timestamp`);
    }
  }

  private assertTaskStatus(label: string, value: string): void {
    if (!["running", "blocked", "waiting", "completed", "failed"].includes(value)) {
      throw new Error(`${label} must be a valid task status`);
    }
  }

  private assertConsequenceLevel(label: string, value: string): void {
    if (!["low", "medium", "high"].includes(value)) {
      throw new Error(`${label} must be a valid consequence level`);
    }
  }

  private assertHumanInputRequest(
    label: string,
    value: HumanInputRequest,
  ): void {
    if (!value || typeof value !== "object" || !("kind" in value)) {
      throw new Error(`${label} must be a valid human input request`);
    }

    switch (value.kind) {
      case "approval":
        return;
      case "choice":
        if (!Array.isArray(value.options) || value.options.length === 0) {
          throw new Error(`${label}.options must contain at least one option`);
        }
        return;
      case "form":
        if (!Array.isArray(value.fields) || value.fields.length === 0) {
          throw new Error(`${label}.fields must contain at least one field`);
        }
        return;
      default:
        throw new Error(`${label} must have a supported request kind`);
    }
  }
}
