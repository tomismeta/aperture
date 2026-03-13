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
import { inferToolFamily, sourceKey } from "./interaction-taxonomy.js";
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
      version: 1,
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
      profileStore,
      markdownRootDir: rootDir,
    });
  }

  async reloadMarkdown(): Promise<boolean> {
    if (!this.profileStore || !this.markdownRootDir) {
      return false;
    }

    const fallbackUser: UserProfile = this.userProfile ?? {
      version: 1,
      operatorId: "default",
      updatedAt: new Date(0).toISOString(),
    };
    const fallbackMemory: MemoryProfile = this.baseMemoryProfile;
    const fallbackJudgment: JudgmentConfig = this.judgmentConfig ?? {
      version: 1,
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

  snapshotMemoryProfile(now: string = new Date().toISOString()): MemoryProfile {
    const toolFamilies = this.toolFamilyMemory();
    const sourceTrust = this.sourceTrustMemory();
    const consequenceProfiles = this.consequenceMemory();

    return {
      ...this.baseMemoryProfile,
      version: 1,
      updatedAt: now,
      sessionCount: this.baseMemoryProfile.sessionCount + 1,
      ...(Object.keys(toolFamilies).length > 0 ? { toolFamilies } : {}),
      ...(Object.keys(sourceTrust).length > 0 ? { sourceTrust } : {}),
      ...(Object.keys(consequenceProfiles).length > 0 ? { consequenceProfiles } : {}),
    };
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
      metadata: this.signalMetadataForFrame(frame),
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
      metadata: this.signalMetadataForFrame(frame),
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
      metadata: this.signalMetadataForFrame(frame),
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
      metadata: this.signalMetadataForFrame(frame),
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
      ...(frame ? { metadata: this.signalMetadataForFrame(frame) } : {}),
      ...(options.surface !== undefined ? { surface: options.surface } : {}),
    };
  }

  private signalMetadataForFrame(frame: Frame): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      consequence: frame.consequence,
    };

    const toolFamily = inferToolFamily(frame);
    if (toolFamily) {
      metadata.toolFamily = toolFamily;
    }

    const key = sourceKey(frame.source);
    if (key) {
      metadata.sourceKey = key;
    }

    return metadata;
  }

  private toolFamilyMemory(): NonNullable<MemoryProfile["toolFamilies"]> {
    const next = { ...(this.baseMemoryProfile.toolFamilies ?? {}) };
    const session = new Map<string, {
      presentations: number;
      responses: number;
      dismissals: number;
      responseLatencyTotal: number;
      responseLatencyCount: number;
      dismissalLatencyTotal: number;
      dismissalLatencyCount: number;
      contextExpanded: number;
      deferrals: number;
      returns: number;
    }>();

    for (const signal of this.signals.list()) {
      const toolFamily = readSignalString(signal.metadata, "toolFamily");
      if (!toolFamily) {
        continue;
      }

      const current = session.get(toolFamily) ?? {
        presentations: 0,
        responses: 0,
        dismissals: 0,
        responseLatencyTotal: 0,
        responseLatencyCount: 0,
        dismissalLatencyTotal: 0,
        dismissalLatencyCount: 0,
        contextExpanded: 0,
        deferrals: 0,
        returns: 0,
      };

      switch (signal.kind) {
        case "presented":
          current.presentations += 1;
          break;
        case "responded":
          current.responses += 1;
          if (signal.latencyMs !== undefined) {
            current.responseLatencyTotal += signal.latencyMs;
            current.responseLatencyCount += 1;
          }
          break;
        case "dismissed":
          current.dismissals += 1;
          if (signal.latencyMs !== undefined) {
            current.dismissalLatencyTotal += signal.latencyMs;
            current.dismissalLatencyCount += 1;
          }
          break;
        case "context_expanded":
          current.contextExpanded += 1;
          break;
        case "deferred":
          current.deferrals += 1;
          break;
        case "returned":
          current.returns += 1;
          break;
      }

      session.set(toolFamily, current);
    }

    for (const [toolFamily, current] of session.entries()) {
      const previous = next[toolFamily] ?? {
        presentations: 0,
        responses: 0,
        dismissals: 0,
      };
      const presentations = previous.presentations + current.presentations;
      const responses = previous.responses + current.responses;
      const dismissals = previous.dismissals + current.dismissals;
      next[toolFamily] = {
        presentations,
        responses,
        dismissals,
        ...(current.responseLatencyCount > 0
          ? {
              avgResponseLatencyMs: Math.round(current.responseLatencyTotal / current.responseLatencyCount),
            }
          : previous.avgResponseLatencyMs !== undefined
            ? { avgResponseLatencyMs: previous.avgResponseLatencyMs }
            : {}),
        ...(current.dismissalLatencyCount > 0
          ? {
              avgDismissalLatencyMs: Math.round(current.dismissalLatencyTotal / current.dismissalLatencyCount),
            }
          : previous.avgDismissalLatencyMs !== undefined
            ? { avgDismissalLatencyMs: previous.avgDismissalLatencyMs }
            : {}),
        ...(presentations > 0
          ? {
              contextExpansionRate: roundRate(current.contextExpanded / presentations),
            }
          : previous.contextExpansionRate !== undefined
            ? { contextExpansionRate: previous.contextExpansionRate }
            : {}),
        ...(current.deferrals > 0
          ? {
              returnAfterDeferralRate: roundRate(current.returns / current.deferrals),
            }
          : previous.returnAfterDeferralRate !== undefined
            ? { returnAfterDeferralRate: previous.returnAfterDeferralRate }
            : {}),
      };
    }

    return next;
  }

  private sourceTrustMemory(): NonNullable<MemoryProfile["sourceTrust"]> {
    const next = structuredClone(this.baseMemoryProfile.sourceTrust ?? {});

    for (const signal of this.signals.list()) {
      const source = readSignalString(signal.metadata, "sourceKey");
      const consequence = readSignalString(signal.metadata, "consequence");
      if (!source || (consequence !== "low" && consequence !== "medium" && consequence !== "high")) {
        continue;
      }

      const current = next[source]?.[consequence] ?? {
        confirmations: 0,
        disagreements: 0,
        trustAdjustment: 0,
      };

      if (signal.kind === "responded") {
        if (signal.responseKind === "rejected") {
          current.disagreements += 1;
        } else {
          current.confirmations += 1;
        }
      } else if (signal.kind === "dismissed") {
        current.disagreements += 1;
      }

      const total = current.confirmations + current.disagreements;
      current.trustAdjustment = total > 0
        ? Math.round(((current.confirmations - current.disagreements) / total) * 10)
        : 0;

      next[source] = {
        ...(next[source] ?? {}),
        [consequence]: current,
      };
    }

    return next;
  }

  private consequenceMemory(): NonNullable<MemoryProfile["consequenceProfiles"]> {
    const next = { ...(this.baseMemoryProfile.consequenceProfiles ?? {}) };
    const totals = new Map<string, { reviewed: number; rejected: number }>();

    for (const signal of this.signals.list()) {
      const consequence = readSignalString(signal.metadata, "consequence");
      if (consequence !== "low" && consequence !== "medium" && consequence !== "high") {
        continue;
      }

      if (signal.kind !== "responded") {
        continue;
      }

      const current = totals.get(consequence) ?? { reviewed: 0, rejected: 0 };
      current.reviewed += 1;
      if (signal.responseKind === "rejected") {
        current.rejected += 1;
      }
      totals.set(consequence, current);
    }

    for (const [consequence, current] of totals.entries()) {
      next[consequence] = {
        rejectionRate: current.reviewed > 0 ? roundRate(current.rejected / current.reviewed) : 0,
      };
    }

    return next;
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

function readSignalString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
