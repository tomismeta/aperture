import type {
  ApertureEvent,
  AttentionView,
  ConformedEvent,
  Frame,
  FrameResponse,
  HumanInputRequest,
  InteractionSignal,
  TaskView,
} from "./index.js";

import { buildAttentionView } from "./attention-view.js";
import { AttentionHeuristics } from "./attention-heuristics.js";
import { deriveAttentionState, type AttentionState } from "./attention-state.js";
import { EpisodeStore, readFrameEpisodeId } from "./episode-store.js";
import { EvaluationEngine } from "./evaluation-engine.js";
import { FramePlanner } from "./frame-planner.js";
import { InteractionCoordinator } from "./interaction-coordinator.js";
import type { InteractionCandidate } from "./interaction-candidate.js";
import { InteractionSignalStore } from "./interaction-signal-store.js";
import { loadJudgmentConfig, type JudgmentConfig } from "./judgment-config.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { buildMemoryProfile, signalMetadataForFrame } from "./memory-aggregator.js";
import { normalizeConformedEvent } from "./semantic-normalizer.js";
import { PolicyGates } from "./policy-gates.js";
import { forecastPressure } from "./pressure-forecast.js";
import { ProfileStore, type MemoryProfile, type UserProfile } from "./profile-store.js";
import { QueuePlanner } from "./queue-planner.js";
import type { SignalSummary } from "./signal-summary.js";
import { TaskViewStore } from "./task-view-store.js";
import type { ApertureTrace } from "./trace.js";
import { TraceRecorder } from "./trace-recorder.js";
import { UtilityScore } from "./utility-score.js";

type FrameListener = (frame: Frame | null) => void;
type TaskViewListener = (taskView: TaskView) => void;
type AttentionViewListener = (attentionView: AttentionView) => void;
type ResponseListener = (response: FrameResponse) => void;
type SignalListener = (signal: InteractionSignal) => void;
type TraceListener = (trace: ApertureTrace) => void;

export type ApertureCoreOptions = {
  userProfile?: UserProfile;
  memoryProfile?: MemoryProfile;
  judgmentConfig?: JudgmentConfig;
  profileStore?: ProfileStore;
  markdownRootDir?: string;
};

export class ApertureCore {
  private readonly frames = new Map<string, Frame>();
  private readonly frameListeners = new Map<string, Set<FrameListener>>();
  private readonly taskViewListeners = new Map<string, Set<TaskViewListener>>();
  private readonly attentionViewListeners = new Set<AttentionViewListener>();
  private readonly responseListeners = new Set<ResponseListener>();
  private readonly signalListeners = new Set<SignalListener>();
  private readonly traceListeners = new Set<TraceListener>();
  private readonly taskViews = new TaskViewStore();
  private readonly signals = new InteractionSignalStore();
  private readonly episodes = new EpisodeStore();
  private readonly heuristics = new AttentionHeuristics();
  private readonly evaluation = new EvaluationEngine();
  private readonly traceRecorder = new TraceRecorder();
  private coordinator: InteractionCoordinator;
  private readonly planner = new FramePlanner();
  private readonly profileStore: ProfileStore | undefined;
  private readonly markdownRootDir: string | undefined;
  private baseMemoryProfile: MemoryProfile;
  private userProfile: UserProfile | undefined;
  private judgmentConfig: JudgmentConfig | undefined;

  constructor(options: ApertureCoreOptions = {}) {
    this.markdownRootDir = options.markdownRootDir;
    this.profileStore = options.profileStore;
    this.userProfile = options.userProfile;
    this.judgmentConfig = options.judgmentConfig;
    this.baseMemoryProfile = options.memoryProfile ?? {
      version: MARKDOWN_SCHEMA_VERSION,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
      sessionCount: 0,
    };
    this.coordinator = this.createCoordinator();
  }

  private createCoordinator(): InteractionCoordinator {
    return new InteractionCoordinator(
      new PolicyGates({
        ...(this.userProfile !== undefined ? { userProfile: this.userProfile } : {}),
        ...(this.judgmentConfig !== undefined ? { judgmentConfig: this.judgmentConfig } : {}),
      }),
      new UtilityScore({
        memoryProfile: this.baseMemoryProfile,
      }),
      new QueuePlanner({
        ...(this.judgmentConfig?.plannerDefaults !== undefined
          ? { plannerDefaults: this.judgmentConfig.plannerDefaults }
          : {}),
      }),
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

  publishConformed(event: ConformedEvent): Frame | null {
    this.assertValidConformedEvent(event);
    return this.publish(normalizeConformedEvent(event));
  }

  publish(event: ApertureEvent): Frame | null {
    this.assertValidEvent(event);
    const taskSummary = this.signals.summarize(event.taskId);
    const globalSummary = this.signals.summarize();
    const taskAttentionState = deriveAttentionState(taskSummary);
    const globalAttentionState = deriveAttentionState(globalSummary);
    const pressureForecast = forecastPressure(globalSummary, this.getAttentionView());
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
          attentionView: this.getAttentionView(),
        }));
        return null;
      }
      case "clear": {
        const current = this.getFrame(event.taskId);
        const result = this.applyClear(event.taskId);
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
          attentionView: this.getAttentionView(),
        }, event.taskId));
        return result;
      }
      case "candidate": {
        const current = this.getFrame(event.taskId);
        const currentAttentionView = this.getAttentionView();
        const candidate = this.episodes.assign(this.heuristics.apply(
          evaluation.candidate,
          taskSummary,
          globalSummary,
        ));
        const explanation = this.coordinator.explain(current, candidate, {
          attentionView: currentAttentionView,
          taskSummary,
          globalSummary,
          pressureForecast,
        });
        let result: Frame | null;
        switch (explanation.decision.kind) {
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
              currentAttentionView,
            );
            break;
          case "queue":
            result = this.materializePeripheralFrame(
              explanation.decision.candidate,
              "queue",
              currentAttentionView,
            );
            break;
          case "activate":
            result =
              explanation.decision.candidate.episodeId
              && this.findPeripheralEpisodeFrame(explanation.decision.candidate.episodeId, currentAttentionView)
                ? this.materializePeripheralFrame(
                    explanation.decision.candidate,
                    this.preferredPeripheralBucket(explanation.decision.candidate),
                    currentAttentionView,
                  )
                : this.commitFrame(this.planner.plan(explanation.decision.candidate, current));
            break;
        }
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
          attentionView: this.getAttentionView(),
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

  getFrame(taskId: string): Frame | null {
    return this.frames.get(taskId) ?? null;
  }

  subscribe(taskId: string, listener: FrameListener): () => void {
    const listeners = this.frameListeners.get(taskId) ?? new Set<FrameListener>();
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

  subscribeTaskView(taskId: string, listener: TaskViewListener): () => void {
    const listeners = this.taskViewListeners.get(taskId) ?? new Set<TaskViewListener>();
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

  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  onSignal(listener: SignalListener): () => void {
    this.signalListeners.add(listener);
    return () => {
      this.signalListeners.delete(listener);
    };
  }

  onTrace(listener: TraceListener): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  submit(response: FrameResponse): void {
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

  getTaskView(taskId: string): TaskView {
    return this.taskViews.get(taskId);
  }

  getAttentionView(): AttentionView {
    return buildAttentionView(this.taskViews.values(), {
      globalAttentionState: this.getAttentionState(),
    });
  }

  getSignals(taskId?: string): InteractionSignal[] {
    return this.signals.list(taskId);
  }

  getSignalSummary(taskId?: string): SignalSummary {
    return this.signals.summarize(taskId);
  }

  getAttentionState(taskId?: string): AttentionState {
    return deriveAttentionState(this.signals.summarize(taskId));
  }

  snapshotMemoryProfile(now: string = new Date().toISOString()): MemoryProfile {
    return buildMemoryProfile(this.baseMemoryProfile, this.signals.list(), now);
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

  recordSignal(signal: InteractionSignal): void {
    this.assertValidSignal(signal);
    this.signals.record(signal);
    for (const listener of this.signalListeners) {
      listener(signal);
    }
  }

  private commitFrame(frame: Frame): Frame {
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

  private queueFrame(taskId: string, frame: Frame): Frame {
    const taskView = this.taskViews.enqueue(taskId, frame);
    this.recordDeferredSignal(frame, "queued");
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
  }

  private addAmbientFrame(taskId: string, frame: Frame): Frame {
    const taskView = this.taskViews.addAmbient(taskId, frame);
    this.recordDeferredSignal(frame, "suppressed");
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
  }

  private materializePeripheralFrame(
    candidate: InteractionCandidate,
    bucket: "queue" | "ambient",
    attentionView: AttentionView,
  ): Frame {
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

  private preferredPeripheralBucket(candidate: InteractionCandidate): "queue" | "ambient" {
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

  private findFrameByInteractionId(taskId: string, interactionId: string): Frame | null {
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
  ): { frame: Frame; bucket: "queue" | "ambient" } | null {
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
    frame: Frame,
    reason: "queued" | "suppressed",
    sourceFrame: Pick<Frame, "taskId" | "interactionId" | "source"> = frame,
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

  private notifyFrame(taskId: string, frame: Frame | null): void {
    for (const listener of this.frameListeners.get(taskId) ?? []) {
      listener(frame);
    }
  }

  private notifyTaskView(taskId: string, taskView: TaskView): void {
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

  private signalForResponse(frame: Frame, response: FrameResponse, timestamp: string): InteractionSignal {
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

  private calculateLatency(frame: Frame, timestamp: string): number | undefined {
    const startedAt = Date.parse(frame.timing.updatedAt);
    const completedAt = Date.parse(timestamp);

    if (Number.isNaN(startedAt) || Number.isNaN(completedAt)) {
      return undefined;
    }

    return Math.max(0, completedAt - startedAt);
  }

  private recordAttentionShift(previous: Frame | null, next: Frame, timestamp: string): void {
    if (!previous || previous.interactionId === next.interactionId) {
      return;
    }

    const destinationSignal: InteractionSignal = {
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

  private recordReturnSignal(previousTaskView: TaskView, next: Frame, timestamp: string): void {
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
    frame: Frame | null,
    options: { surface?: string },
  ): Extract<
    InteractionSignal,
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

  private findFrame(taskId: string, interactionId: string): Frame | null {
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

  private assertValidConformedEvent(event: ConformedEvent): void {
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

  private assertValidFrameResponse(response: FrameResponse): void {
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

  private assertValidSignal(signal: InteractionSignal): void {
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
