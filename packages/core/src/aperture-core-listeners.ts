import { performance } from "node:perf_hooks";

import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionResponse } from "./frame-response.js";
import type { AttentionSignal } from "./interaction-signal.js";
import type { ApertureTrace as PublicApertureTrace } from "./trace.js";
import type { ApertureTrace as InternalApertureTrace } from "./trace-types.js";
import { APERTURE_INTERNAL_TRACE_SUBSCRIBE, type InternalTraceListener } from "./internal-trace.js";
import { toPublicApertureTrace } from "./trace-projection.js";

export type AttentionFrameListener = (frame: AttentionFrame | null) => void;
export type AttentionTaskViewListener = (taskView: AttentionTaskView) => void;
export type AttentionViewListener = (attentionView: AttentionView) => void;
export type AttentionResponseListener = (response: AttentionResponse) => void;
export type AttentionSignalListener = (signal: AttentionSignal) => void;
export type AttentionTraceListener = (trace: PublicApertureTrace) => void;

export type ApertureCoreListenerChannelHealth = {
  active: number;
  emissions: number;
  failures: number;
  detached: number;
  slowDeliveries: number;
  maxDeliveryMs: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export type ApertureCoreListenerHealthSnapshot = {
  totalActive: number;
  frame: ApertureCoreListenerChannelHealth;
  taskView: ApertureCoreListenerChannelHealth;
  attentionView: ApertureCoreListenerChannelHealth;
  response: ApertureCoreListenerChannelHealth;
  signal: ApertureCoreListenerChannelHealth;
  trace: ApertureCoreListenerChannelHealth;
  internalTrace: ApertureCoreListenerChannelHealth;
};

type ListenerRegistration<T> = {
  listener: T;
  consecutiveFailures: number;
};

type ListenerChannelHealthState = Omit<ApertureCoreListenerChannelHealth, "active">;

const MAX_CONSECUTIVE_LISTENER_FAILURES = 3;
const SLOW_LISTENER_DELIVERY_MS = 25;

/**
 * Keeps subscription and notification plumbing separate from the core
 * judgment pipeline so `ApertureCore` can read more like orchestration.
 */
export class ApertureCoreListeners {
  private readonly frameListeners = new Map<
    string,
    Set<ListenerRegistration<AttentionFrameListener>>
  >();
  private readonly taskViewListeners = new Map<
    string,
    Set<ListenerRegistration<AttentionTaskViewListener>>
  >();
  private readonly attentionViewListeners = new Set<ListenerRegistration<AttentionViewListener>>();
  private readonly responseListeners = new Set<ListenerRegistration<AttentionResponseListener>>();
  private readonly signalListeners = new Set<ListenerRegistration<AttentionSignalListener>>();
  private readonly traceListeners = new Set<ListenerRegistration<AttentionTraceListener>>();
  private readonly internalTraceListeners = new Set<ListenerRegistration<InternalTraceListener>>();
  private readonly frameHealth = createListenerChannelHealthState();
  private readonly taskViewHealth = createListenerChannelHealthState();
  private readonly attentionViewHealth = createListenerChannelHealthState();
  private readonly responseHealth = createListenerChannelHealthState();
  private readonly signalHealth = createListenerChannelHealthState();
  private readonly traceHealth = createListenerChannelHealthState();
  private readonly internalTraceHealth = createListenerChannelHealthState();

  subscribeFrame(
    taskId: string,
    listener: AttentionFrameListener,
    currentFrame: AttentionFrame | null,
  ): () => void {
    const listeners =
      this.frameListeners.get(taskId) ?? new Set<ListenerRegistration<AttentionFrameListener>>();
    const registration = createListenerRegistration(listener);
    listeners.add(registration);
    this.frameListeners.set(taskId, listeners);
    const unsubscribe = () => {
      listeners.delete(registration);
      if (listeners.size === 0) {
        this.frameListeners.delete(taskId);
      }
    };
    try {
      listener(currentFrame);
    } catch (error) {
      unsubscribe();
      throw error;
    }

    return unsubscribe;
  }

  subscribeTaskView(
    taskId: string,
    listener: AttentionTaskViewListener,
    taskView: AttentionTaskView,
  ): () => void {
    const listeners =
      this.taskViewListeners.get(taskId) ??
      new Set<ListenerRegistration<AttentionTaskViewListener>>();
    const registration = createListenerRegistration(listener);
    listeners.add(registration);
    this.taskViewListeners.set(taskId, listeners);
    const unsubscribe = () => {
      listeners.delete(registration);
      if (listeners.size === 0) {
        this.taskViewListeners.delete(taskId);
      }
    };
    try {
      listener(taskView);
    } catch (error) {
      unsubscribe();
      throw error;
    }

    return unsubscribe;
  }

  subscribeAttentionView(
    listener: AttentionViewListener,
    attentionView: AttentionView,
  ): () => void {
    const registration = createListenerRegistration(listener);
    this.attentionViewListeners.add(registration);
    try {
      listener(attentionView);
    } catch (error) {
      this.attentionViewListeners.delete(registration);
      throw error;
    }
    return () => {
      this.attentionViewListeners.delete(registration);
    };
  }

  onResponse(listener: AttentionResponseListener): () => void {
    const registration = createListenerRegistration(listener);
    this.responseListeners.add(registration);
    return () => {
      this.responseListeners.delete(registration);
    };
  }

  onSignal(listener: AttentionSignalListener): () => void {
    const registration = createListenerRegistration(listener);
    this.signalListeners.add(registration);
    return () => {
      this.signalListeners.delete(registration);
    };
  }

  onTrace(listener: AttentionTraceListener): () => void {
    const registration = createListenerRegistration(listener);
    this.traceListeners.add(registration);
    return () => {
      this.traceListeners.delete(registration);
    };
  }

  [APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener: InternalTraceListener): () => void {
    const registration = createListenerRegistration(listener);
    this.internalTraceListeners.add(registration);
    return () => {
      this.internalTraceListeners.delete(registration);
    };
  }

  emitFrame(taskId: string, frame: AttentionFrame | null): void {
    const listeners = this.frameListeners.get(taskId);
    if (!listeners) {
      return;
    }
    this.emitRegistrations(listeners, this.frameHealth, (listener) => listener(frame));
    if (listeners.size === 0) {
      this.frameListeners.delete(taskId);
    }
  }

  emitTaskView(taskId: string, taskView: AttentionTaskView): void {
    const listeners = this.taskViewListeners.get(taskId);
    if (!listeners) {
      return;
    }
    this.emitRegistrations(listeners, this.taskViewHealth, (listener) => listener(taskView));
    if (listeners.size === 0) {
      this.taskViewListeners.delete(taskId);
    }
  }

  emitAttentionView(attentionView: AttentionView): void {
    this.emitRegistrations(this.attentionViewListeners, this.attentionViewHealth, (listener) =>
      listener(attentionView),
    );
  }

  emitResponse(response: AttentionResponse): void {
    this.emitRegistrations(this.responseListeners, this.responseHealth, (listener) =>
      listener(response),
    );
  }

  emitSignal(signal: AttentionSignal): void {
    this.emitRegistrations(this.signalListeners, this.signalHealth, (listener) => listener(signal));
  }

  emitTrace(trace: InternalApertureTrace): void {
    this.emitRegistrations(this.internalTraceListeners, this.internalTraceHealth, (listener) =>
      listener(trace),
    );
    const publicTrace = toPublicApertureTrace(trace);
    this.emitRegistrations(this.traceListeners, this.traceHealth, (listener) =>
      listener(publicTrace),
    );
  }

  getHealthSnapshot(): ApertureCoreListenerHealthSnapshot {
    const frame = toListenerChannelHealth(
      this.frameHealth,
      countRegistrations(this.frameListeners),
    );
    const taskView = toListenerChannelHealth(
      this.taskViewHealth,
      countRegistrations(this.taskViewListeners),
    );
    const attentionView = toListenerChannelHealth(
      this.attentionViewHealth,
      this.attentionViewListeners.size,
    );
    const response = toListenerChannelHealth(this.responseHealth, this.responseListeners.size);
    const signal = toListenerChannelHealth(this.signalHealth, this.signalListeners.size);
    const trace = toListenerChannelHealth(this.traceHealth, this.traceListeners.size);
    const internalTrace = toListenerChannelHealth(
      this.internalTraceHealth,
      this.internalTraceListeners.size,
    );

    return {
      totalActive:
        frame.active +
        taskView.active +
        attentionView.active +
        response.active +
        signal.active +
        trace.active +
        internalTrace.active,
      frame,
      taskView,
      attentionView,
      response,
      signal,
      trace,
      internalTrace,
    };
  }

  private emitRegistrations<T>(
    registrations: Set<ListenerRegistration<T>>,
    health: ListenerChannelHealthState,
    emit: (listener: T) => void,
  ): void {
    for (const registration of [...registrations]) {
      const startedAt = performance.now();
      try {
        emit(registration.listener);
        registration.consecutiveFailures = 0;
      } catch (error) {
        registration.consecutiveFailures += 1;
        health.failures += 1;
        health.lastErrorAt = new Date().toISOString();
        health.lastErrorMessage = error instanceof Error ? error.message : String(error);
        if (registration.consecutiveFailures >= MAX_CONSECUTIVE_LISTENER_FAILURES) {
          registrations.delete(registration);
          health.detached += 1;
        }
      } finally {
        const durationMs = performance.now() - startedAt;
        health.emissions += 1;
        if (durationMs > health.maxDeliveryMs) {
          health.maxDeliveryMs = durationMs;
        }
        if (durationMs >= SLOW_LISTENER_DELIVERY_MS) {
          health.slowDeliveries += 1;
        }
      }
    }
  }
}

function createListenerRegistration<T>(listener: T): ListenerRegistration<T> {
  return {
    listener,
    consecutiveFailures: 0,
  };
}

function createListenerChannelHealthState(): ListenerChannelHealthState {
  return {
    emissions: 0,
    failures: 0,
    detached: 0,
    slowDeliveries: 0,
    maxDeliveryMs: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

function toListenerChannelHealth(
  health: ListenerChannelHealthState,
  active: number,
): ApertureCoreListenerChannelHealth {
  return {
    active,
    emissions: health.emissions,
    failures: health.failures,
    detached: health.detached,
    slowDeliveries: health.slowDeliveries,
    maxDeliveryMs: Number(health.maxDeliveryMs.toFixed(2)),
    lastErrorAt: health.lastErrorAt,
    lastErrorMessage: health.lastErrorMessage,
  };
}

function countRegistrations<T>(listeners: Map<string, Set<ListenerRegistration<T>>>): number {
  let total = 0;
  for (const registrations of listeners.values()) {
    total += registrations.size;
  }
  return total;
}
