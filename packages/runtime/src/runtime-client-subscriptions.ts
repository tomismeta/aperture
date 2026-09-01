import type { AttentionResponse, AttentionView } from "@tomismeta/aperture-core";
import type { ApertureTrace } from "@tomismeta/aperture-core/internal";

import type { ApertureRuntimeEvent, ApertureRuntimeSnapshot } from "./runtime-contract.js";

export type ApertureRuntimeClientErrorListener = (error: Error) => void;
export type ApertureRuntimeSnapshotListener = (snapshot: ApertureRuntimeSnapshot) => void;
export type AttentionViewListener = (attentionView: AttentionView) => void;
export type ResponseListener = (response: AttentionResponse) => void;
export type TraceListener = (trace: ApertureTrace) => void;

export class RuntimeClientSubscriptions {
  private readonly attention = new Set<AttentionViewListener>();
  private readonly snapshots = new Set<ApertureRuntimeSnapshotListener>();
  private readonly responses = new Set<ResponseListener>();
  private readonly traces = new Set<TraceListener>();
  private readonly errors = new Set<ApertureRuntimeClientErrorListener>();

  subscribeAttentionView(listener: AttentionViewListener, initial: AttentionView): () => void {
    const unsubscribe = this.subscribe(this.attention, listener);
    listener(initial);
    return unsubscribe;
  }

  subscribeSnapshot(
    listener: ApertureRuntimeSnapshotListener,
    initial: ApertureRuntimeSnapshot,
  ): () => void {
    const unsubscribe = this.subscribe(this.snapshots, listener);
    listener(initial);
    return unsubscribe;
  }

  onResponse(listener: ResponseListener): () => void {
    return this.subscribe(this.responses, listener);
  }

  onTrace(listener: TraceListener): () => void {
    return this.subscribe(this.traces, listener);
  }

  onError(listener: ApertureRuntimeClientErrorListener): () => void {
    return this.subscribe(this.errors, listener);
  }

  emitEvent(event: ApertureRuntimeEvent): void {
    if (event.type === "response") {
      for (const listener of this.responses) listener(event.response);
      return;
    }
    for (const listener of this.traces) listener(event.trace);
  }

  emitSnapshot(attentionView: AttentionView, snapshot: () => ApertureRuntimeSnapshot): void {
    for (const listener of this.attention) listener(attentionView);
    for (const listener of this.snapshots) listener(snapshot());
  }

  emitError(error: Error): void {
    for (const listener of this.errors) listener(error);
  }

  private subscribe<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
}
