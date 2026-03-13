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
import { EpisodeStore } from "./episode-store.js";
import { EvaluationEngine } from "./evaluation-engine.js";
import { FramePlanner } from "./frame-planner.js";
import { InteractionCoordinator } from "./interaction-coordinator.js";
import { InteractionSignalStore } from "./interaction-signal-store.js";
import { loadJudgmentConfig, type JudgmentConfig } from "./judgment-config.js";
import { normalizeConformedEvent } from "./semantic-normalizer.js";
import { PolicyGates } from "./policy-gates.js";
import { ProfileStore, type MemoryProfile, type UserProfile } from "./profile-store.js";
import type { SignalSummary } from "./signal-summary.js";
import { TaskViewStore } from "./task-view-store.js";
import type { ApertureTrace } from "./trace.js";
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
  private readonly coordinator: InteractionCoordinator;
  private readonly planner = new FramePlanner();

  constructor(options: ApertureCoreOptions = {}) {
    this.coordinator = new InteractionCoordinator(
      new PolicyGates({
        ...(options.userProfile !== undefined ? { userProfile: options.userProfile } : {}),
        ...(options.judgmentConfig !== undefined ? { judgmentConfig: options.judgmentConfig } : {}),
      }),
      new UtilityScore({
        ...(options.memoryProfile !== undefined ? { memoryProfile: options.memoryProfile } : {}),
      }),
      undefined,
    );
  }

  static async fromMarkdown(rootDir: string): Promise<ApertureCore> {
    const profileStore = new ProfileStore(rootDir);
    const fallbackUser: UserProfile = {
      version: 1,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
    };
    const fallbackMemory: MemoryProfile = {
      version: 1,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
      sessionCount: 0,
    };
    const fallbackJudgment: JudgmentConfig = {
      version: 1,
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
    });
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
    const evaluation = this.evaluation.evaluate(event);

    switch (evaluation.kind) {
      case "noop": {
        this.notifyTrace({
          timestamp: new Date().toISOString(),
          event,
          evaluation: { kind: "noop" },
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          current: this.getFrame(event.taskId),
          taskView: this.getTaskView(event.taskId),
          attentionView: this.getAttentionView(),
        });
        return null;
      }
      case "clear": {
        const current = this.getFrame(event.taskId);
        const result = this.applyClear(event.taskId);
        this.notifyTrace({
          timestamp: new Date().toISOString(),
          event,
          evaluation: { kind: "clear", taskId: event.taskId },
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          current,
          taskView: this.getTaskView(event.taskId),
          attentionView: this.getAttentionView(),
        });
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
            result = this.addAmbientFrame(event.taskId, this.planner.plan(explanation.decision.candidate, null));
            break;
          case "queue":
            result = this.queueFrame(event.taskId, this.planner.plan(explanation.decision.candidate, null));
            break;
          case "activate":
            result = this.commitFrame(this.planner.plan(explanation.decision.candidate, current));
            break;
        }
        this.notifyTrace({
          timestamp: new Date().toISOString(),
          event,
          evaluation: {
            kind: "candidate",
            original: evaluation.candidate,
            adjusted: candidate,
          },
          heuristics: {
            scoreOffset: candidate.attentionScoreOffset ?? 0,
            rationale: candidate.attentionRationale ?? [],
          },
          episode: candidate.episodeId
            ? {
                id: candidate.episodeId,
                key: candidate.episodeKey ?? candidate.episodeId,
                state: candidate.episodeState ?? "emerging",
                size: candidate.episodeSize ?? 1,
                lastInteractionId: candidate.interactionId,
                updatedAt: candidate.timestamp,
              }
            : null,
          policy: explanation.policy,
          utility: {
            candidate: explanation.utility,
            currentScore: explanation.currentScore,
            currentPriority: explanation.currentPriority,
          },
          planner: {
            kind: explanation.decision.kind,
            reasons: explanation.reasons,
          },
          coordination: {
            kind: explanation.decision.kind,
            candidateScore: explanation.candidateScore,
            currentScore: explanation.currentScore,
            currentPriority: explanation.currentPriority,
            reasons: explanation.reasons,
          },
          taskSummary,
          globalSummary,
          taskAttentionState,
          globalAttentionState,
          current,
          taskView: this.getTaskView(event.taskId),
          attentionView: this.getAttentionView(),
          result,
        });
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
    const current = this.frames.get(response.taskId);
    if (!current || current.interactionId !== response.interactionId) {
      return;
    }

    const timestamp = new Date().toISOString();
    this.recordSignal(this.signalForResponse(current, response, timestamp));
    this.episodes.resolveInteraction(response.interactionId);

    const previousTaskView = this.taskViews.get(response.taskId);
    this.frames.delete(response.taskId);
    const taskView = this.taskViews.resolve(response.taskId, response.interactionId);
    if (taskView.active) {
      this.recordAttentionShift(previousTaskView.active, taskView.active, timestamp);
      this.recordReturnSignal(previousTaskView, taskView.active, timestamp);
      this.frames.set(response.taskId, taskView.active);
      this.notifyFrame(response.taskId, taskView.active);
    } else {
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
    });
    this.notifyFrame(frame.taskId, frame);
    this.notifyTaskView(frame.taskId, taskView);
    this.notifyAttentionView();
    return frame;
  }

  private applyClear(taskId: string): null {
    if (!this.frames.has(taskId)) {
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
    this.recordSignal({
      kind: "deferred",
      taskId: frame.taskId,
      interactionId: frame.interactionId,
      timestamp: frame.timing.updatedAt,
      frameId: frame.id,
      ...(frame.source !== undefined ? { source: frame.source } : {}),
      reason: "queued",
    });
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
  }

  private addAmbientFrame(taskId: string, frame: Frame): Frame {
    const taskView = this.taskViews.addAmbient(taskId, frame);
    this.recordSignal({
      kind: "deferred",
      taskId: frame.taskId,
      interactionId: frame.interactionId,
      timestamp: frame.timing.updatedAt,
      frameId: frame.id,
      ...(frame.source !== undefined ? { source: frame.source } : {}),
      reason: "suppressed",
    });
    this.notifyTaskView(taskId, taskView);
    this.notifyAttentionView();
    return this.frames.get(taskId) ?? frame;
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
