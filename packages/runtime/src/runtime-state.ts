import {
  baseAttentionSurfaceCapabilities,
  mergeAttentionSurfaceCapabilities,
  type AttentionResponse,
  type AttentionSignal,
  type AttentionSurfaceCapabilities,
  type AttentionView,
  type SourceEvent,
} from "@tomismeta/aperture-core";
import type { ApertureTrace, InternalHealthEmitter } from "@tomismeta/aperture-core/internal";
import { readInternalCoreHealthSnapshot } from "@tomismeta/aperture-core/internal";

import type {
  ApertureRuntimeAdapter,
  ApertureRuntimeAttentionViewSnapshot,
  ApertureRuntimeExplanationSnapshot,
  ApertureRuntimeHealthSnapshot,
  ApertureRuntimeSessionCapture,
  ApertureRuntimeSnapshot,
  ApertureRuntimeSurfaceRole,
  RuntimeWorkResponseRecord,
} from "./runtime-contract.js";
import { RuntimeCaptureStore } from "./runtime-capture-store.js";
import type { LearningPersistenceState } from "./learning-persistence.js";
import { RuntimeTelemetry } from "./runtime-telemetry.js";
import { WorkResponseStore } from "./work-response-store.js";

type AdapterSession = {
  id: string;
  kind: string;
  lastSeenAt: number;
  connectedAt: string;
  label?: string;
  metadata?: Record<string, string>;
};

type SurfaceSession = {
  id: string;
  lastSeenAt: number;
  label?: string;
  role: ApertureRuntimeSurfaceRole;
  capabilities: AttentionSurfaceCapabilities;
};

type PartialSurfaceCapabilities = {
  topology?: Partial<AttentionSurfaceCapabilities["topology"]>;
  responses?: Partial<AttentionSurfaceCapabilities["responses"]>;
};

type RuntimeStateOptions = {
  runtimeId: string;
  kind: string;
  startedAt: string;
  eventLogLimit: number;
  captureLogLimit: number;
  adapterTtlMs: number;
  surfaceTtlMs: number;
  metadata?: Record<string, string>;
  learningPersistence?: LearningPersistenceState;
  workResponses: WorkResponseStore;
  telemetry: RuntimeTelemetry;
};

export class RuntimeState {
  private readonly runtimeId: string;
  private readonly kind: string;
  private readonly startedAt: string;
  private readonly adapterTtlMs: number;
  private readonly surfaceTtlMs: number;
  private readonly metadata: Record<string, string> | undefined;
  private readonly adapters = new Map<string, AdapterSession>();
  private readonly surfaces = new Map<string, SurfaceSession>();
  private readonly capture: RuntimeCaptureStore;
  private readonly workResponses: WorkResponseStore;
  private readonly telemetry: RuntimeTelemetry;
  private stateVersion = 0;
  private learningPersistence: LearningPersistenceState | undefined;

  constructor(options: RuntimeStateOptions) {
    this.runtimeId = options.runtimeId;
    this.kind = options.kind;
    this.startedAt = options.startedAt;
    this.adapterTtlMs = options.adapterTtlMs;
    this.surfaceTtlMs = options.surfaceTtlMs;
    this.metadata = options.metadata;
    this.learningPersistence = options.learningPersistence;
    this.capture = new RuntimeCaptureStore({
      eventFeedLimit: options.eventLogLimit,
      captureLogLimit: options.captureLogLimit,
    });
    this.workResponses = options.workResponses;
    this.telemetry = options.telemetry;
  }

  get version(): number {
    return this.stateVersion;
  }

  get surfaceCount(): number {
    this.pruneSurfaces();
    return this.surfaces.size;
  }

  get retention(): { pendingTtlMs: number; terminalRetentionMs: number; capacity: number } {
    return {
      pendingTtlMs: this.workResponses.pendingTtl,
      terminalRetentionMs: this.workResponses.retention,
      capacity: this.workResponses.capacity,
    };
  }

  setLearningPersistence(state: LearningPersistenceState | undefined): void {
    this.learningPersistence = state;
    this.bumpStateVersion();
  }

  registerAdapter(adapter: {
    id: string;
    kind: string;
    label?: string;
    metadata?: Record<string, string>;
    connectedAt: string;
  }): { heartbeatIntervalMs: number; expiresAt: string } {
    this.adapters.set(adapter.id, {
      id: adapter.id,
      kind: adapter.kind,
      lastSeenAt: Date.now(),
      connectedAt: adapter.connectedAt,
      ...(adapter.label ? { label: adapter.label } : {}),
      ...(adapter.metadata ? { metadata: adapter.metadata } : {}),
    });
    this.bumpStateVersion();
    return {
      heartbeatIntervalMs: Math.max(1_000, Math.floor(this.adapterTtlMs / 3)),
      expiresAt: new Date(Date.now() + this.adapterTtlMs).toISOString(),
    };
  }

  heartbeatAdapter(adapterId: string): boolean {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      return false;
    }
    adapter.lastSeenAt = Date.now();
    return true;
  }

  removeAdapter(adapterId: string): void {
    if (this.adapters.delete(adapterId)) {
      this.bumpStateVersion();
    }
  }

  attachSurface(surface: {
    id: string;
    label?: string;
    role?: ApertureRuntimeSurfaceRole;
    capabilities: PartialSurfaceCapabilities | undefined;
  }): { heartbeatIntervalMs: number; expiresAt: string } {
    this.surfaces.set(surface.id, {
      id: surface.id,
      lastSeenAt: Date.now(),
      role: surface.role ?? "participant",
      capabilities: normalizeSurfaceCapabilities(surface.capabilities),
      ...(surface.label ? { label: surface.label } : {}),
    });
    this.bumpStateVersion();
    return {
      heartbeatIntervalMs: Math.max(1_000, Math.floor(this.surfaceTtlMs / 3)),
      expiresAt: new Date(Date.now() + this.surfaceTtlMs).toISOString(),
    };
  }

  heartbeatSurface(surfaceId: string): boolean {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) {
      return false;
    }
    surface.lastSeenAt = Date.now();
    return true;
  }

  removeSurface(surfaceId: string): boolean {
    const removed = this.surfaces.delete(surfaceId);
    if (removed) {
      this.bumpStateVersion();
    }
    return removed;
  }

  aggregateSurfaceCapabilities(): AttentionSurfaceCapabilities {
    this.pruneSurfaces();
    return mergeAttentionSurfaceCapabilities(
      [...this.surfaces.values()]
        .filter((surface) => surface.role === "participant")
        .map((surface) => surface.capabilities),
    );
  }

  recordRuntimeResponse(response: AttentionResponse): void {
    this.capture.recordRuntimeEvent({ type: "response", response });
    this.capture.recordObservedResponse(response);
    this.workResponses.recordAnswered(response);
    this.bumpStateVersion();
  }

  recordRuntimeTrace(trace: ApertureTrace): void {
    this.capture.recordRuntimeEvent({ type: "trace", trace });
    this.capture.recordTrace(trace);
  }

  recordSignal(signal: AttentionSignal): void {
    this.capture.recordSignal(signal);
    this.bumpStateVersion();
  }

  recordAttentionViewSnapshot(
    snapshot: Omit<ApertureRuntimeAttentionViewSnapshot, "sequence">,
  ): void {
    this.capture.recordAttentionViewSnapshot(snapshot);
    this.bumpStateVersion();
  }

  recordPublishedSourceEvent(event: SourceEvent, recordedAt: string): void {
    this.capture.recordPublishedSourceEvent(event, recordedAt);
    this.bumpStateVersion();
  }

  recordSubmittedResponse(response: AttentionResponse, recordedAt: string): void {
    this.capture.recordSubmittedResponse(response, recordedAt);
    this.bumpStateVersion();
  }

  registerPendingWorkResponse(event: SourceEvent, recordedAt: string): void {
    if (event.type !== "human.input.requested") {
      return;
    }
    this.workResponses.registerPending(event.taskId, event.interactionId, recordedAt);
    this.bumpStateVersion();
  }

  cancelWorkResponse(interactionId: string): RuntimeWorkResponseRecord | null {
    const record = this.workResponses.cancel(interactionId);
    if (record) {
      this.bumpStateVersion();
    }
    return record;
  }

  readWorkResponse(interactionId: string): RuntimeWorkResponseRecord | null {
    return this.workResponses.get(interactionId);
  }

  eventsSince(sequence: number) {
    return this.capture.eventsSince(sequence);
  }

  nextSequence() {
    return this.capture.currentSequence();
  }

  snapshot(
    core: {
      getAttentionView(): AttentionView;
      getSignalSummary(): ApertureRuntimeSnapshot["signalSummary"];
      getAttentionState(): ApertureRuntimeSnapshot["attentionState"];
    } & InternalHealthEmitter,
  ): ApertureRuntimeSnapshot {
    this.pruneAdapters();
    this.pruneSurfaces();
    return {
      version: this.stateVersion,
      attentionView: core.getAttentionView(),
      signalSummary: core.getSignalSummary(),
      attentionState: core.getAttentionState(),
      adapters: this.listAdapters(),
      surfaceCount: this.surfaces.size,
      surfaceCapabilities: this.aggregateSurfaceCapabilities(),
      health: this.health(core),
      ...(this.learningPersistence ? { learningPersistence: this.learningPersistence } : {}),
    };
  }

  health(core: InternalHealthEmitter): ApertureRuntimeHealthSnapshot {
    this.pruneAdapters();
    this.pruneSurfaces();
    return {
      startedAt: this.startedAt,
      adapters: {
        count: this.adapters.size,
        ttlMs: this.adapterTtlMs,
      },
      surfaces: {
        count: this.surfaces.size,
        ttlMs: this.surfaceTtlMs,
      },
      capture: this.capture.stats(),
      workResponses: this.workResponses.stats(),
      telemetry: this.telemetry.snapshot(),
      core: readInternalCoreHealthSnapshot(core),
    };
  }

  exportSessionCapture(
    core: {
      getAttentionView(): AttentionView;
    },
    currentExplanation: ApertureRuntimeExplanationSnapshot,
  ): ApertureRuntimeSessionCapture {
    const capture = this.capture.exportCaptureData();
    return {
      runtimeId: this.runtimeId,
      kind: this.kind,
      startedAt: this.startedAt,
      exportedAt: new Date().toISOString(),
      captureSteps: capture.captureSteps,
      publishedSourceEvents: capture.publishedSourceEvents,
      submittedResponses: capture.submittedResponses,
      signals: capture.signals,
      traces: capture.traces,
      attentionViewSnapshots: capture.attentionViewSnapshots,
      currentAttentionView: core.getAttentionView(),
      currentExplanation,
      adapters: this.listAdapters(),
      ...(this.metadata ? { metadata: this.metadata } : {}),
      ...(this.learningPersistence ? { learningPersistence: this.learningPersistence } : {}),
    };
  }

  async flush(): Promise<void> {
    await this.workResponses.flush();
  }

  captureData() {
    return this.capture.exportCaptureData();
  }

  private bumpStateVersion(): void {
    this.stateVersion += 1;
  }

  private pruneAdapters(): void {
    const cutoff = Date.now() - this.adapterTtlMs;
    let removed = false;
    for (const [adapterId, adapter] of this.adapters.entries()) {
      if (adapter.lastSeenAt < cutoff) {
        this.adapters.delete(adapterId);
        removed = true;
      }
    }
    if (removed) {
      this.bumpStateVersion();
    }
  }

  private pruneSurfaces(): void {
    const cutoff = Date.now() - this.surfaceTtlMs;
    let removed = false;
    for (const [surfaceId, surface] of this.surfaces.entries()) {
      if (surface.lastSeenAt < cutoff) {
        this.surfaces.delete(surfaceId);
        removed = true;
      }
    }
    if (removed) {
      this.bumpStateVersion();
    }
  }

  private listAdapters(): ApertureRuntimeAdapter[] {
    return [...this.adapters.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .map((adapter) => ({
        id: adapter.id,
        kind: adapter.kind,
        ...(adapter.label ? { label: adapter.label } : {}),
        ...(adapter.metadata ? { metadata: adapter.metadata } : {}),
        lastSeenAt: new Date(adapter.lastSeenAt).toISOString(),
        connectedAt: adapter.connectedAt,
      }));
  }
}

function normalizeSurfaceCapabilities(
  capabilities: PartialSurfaceCapabilities | undefined,
): AttentionSurfaceCapabilities {
  return {
    topology: {
      supportsAmbient:
        capabilities?.topology?.supportsAmbient ??
        baseAttentionSurfaceCapabilities.topology.supportsAmbient,
    },
    responses: {
      supportsSingleChoice:
        capabilities?.responses?.supportsSingleChoice ??
        baseAttentionSurfaceCapabilities.responses.supportsSingleChoice,
      supportsMultipleChoice:
        capabilities?.responses?.supportsMultipleChoice ??
        baseAttentionSurfaceCapabilities.responses.supportsMultipleChoice,
      supportsForm:
        capabilities?.responses?.supportsForm ??
        baseAttentionSurfaceCapabilities.responses.supportsForm,
      supportsTextResponse:
        capabilities?.responses?.supportsTextResponse ??
        baseAttentionSurfaceCapabilities.responses.supportsTextResponse,
    },
  };
}
