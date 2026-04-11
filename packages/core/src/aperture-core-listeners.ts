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

/**
 * Keeps subscription and notification plumbing separate from the core
 * judgment pipeline so `ApertureCore` can read more like orchestration.
 */
export class ApertureCoreListeners {
  private readonly frameListeners = new Map<string, Set<AttentionFrameListener>>();
  private readonly taskViewListeners = new Map<string, Set<AttentionTaskViewListener>>();
  private readonly attentionViewListeners = new Set<AttentionViewListener>();
  private readonly responseListeners = new Set<AttentionResponseListener>();
  private readonly signalListeners = new Set<AttentionSignalListener>();
  private readonly traceListeners = new Set<AttentionTraceListener>();
  private readonly internalTraceListeners = new Set<InternalTraceListener>();

  subscribeFrame(
    taskId: string,
    listener: AttentionFrameListener,
    currentFrame: AttentionFrame | null,
  ): () => void {
    const listeners = this.frameListeners.get(taskId) ?? new Set<AttentionFrameListener>();
    listeners.add(listener);
    this.frameListeners.set(taskId, listeners);
    listener(currentFrame);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.frameListeners.delete(taskId);
      }
    };
  }

  subscribeTaskView(
    taskId: string,
    listener: AttentionTaskViewListener,
    taskView: AttentionTaskView,
  ): () => void {
    const listeners = this.taskViewListeners.get(taskId) ?? new Set<AttentionTaskViewListener>();
    listeners.add(listener);
    this.taskViewListeners.set(taskId, listeners);
    listener(taskView);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.taskViewListeners.delete(taskId);
      }
    };
  }

  subscribeAttentionView(
    listener: AttentionViewListener,
    attentionView: AttentionView,
  ): () => void {
    this.attentionViewListeners.add(listener);
    listener(attentionView);
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

  [APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener: InternalTraceListener): () => void {
    this.internalTraceListeners.add(listener);
    return () => {
      this.internalTraceListeners.delete(listener);
    };
  }

  emitFrame(taskId: string, frame: AttentionFrame | null): void {
    for (const listener of this.frameListeners.get(taskId) ?? []) {
      listener(frame);
    }
  }

  emitTaskView(taskId: string, taskView: AttentionTaskView): void {
    for (const listener of this.taskViewListeners.get(taskId) ?? []) {
      listener(taskView);
    }
  }

  emitAttentionView(attentionView: AttentionView): void {
    for (const listener of this.attentionViewListeners) {
      listener(attentionView);
    }
  }

  emitResponse(response: AttentionResponse): void {
    for (const listener of this.responseListeners) {
      listener(response);
    }
  }

  emitSignal(signal: AttentionSignal): void {
    for (const listener of this.signalListeners) {
      listener(signal);
    }
  }

  emitTrace(trace: InternalApertureTrace): void {
    for (const listener of this.internalTraceListeners) {
      listener(trace);
    }

    const publicTrace = toPublicApertureTrace(trace);
    for (const listener of this.traceListeners) {
      listener(publicTrace);
    }
  }
}
