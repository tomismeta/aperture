import type { AttentionResponse, AttentionSignal, SourceEvent } from "@tomismeta/aperture-core";
import type { ApertureTrace } from "@tomismeta/aperture-core/internal";

import type {
  ApertureRuntimeAttentionViewSnapshot,
  ApertureRuntimeCaptureStep,
  ApertureRuntimeEvent,
} from "./runtime-contract.js";

type RuntimeCaptureStoreOptions = {
  eventFeedLimit: number;
  captureLogLimit: number;
};

type RuntimeEventWithoutSequence = ApertureRuntimeEvent extends infer TEvent
  ? TEvent extends ApertureRuntimeEvent
    ? Omit<TEvent, "sequence">
    : never
  : never;

export class RuntimeCaptureStore {
  private readonly eventFeedLimit: number;
  private readonly captureLogLimit: number;
  private sequence = 0;
  private captureSequence = 0;
  private readonly events: ApertureRuntimeEvent[] = [];
  private readonly publishedSourceEvents: SourceEvent[] = [];
  private readonly submittedResponses: AttentionResponse[] = [];
  private readonly signals: AttentionSignal[] = [];
  private readonly traces: ApertureTrace[] = [];
  private readonly attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[] = [];
  private readonly captureSteps: ApertureRuntimeCaptureStep[] = [];

  constructor(options: RuntimeCaptureStoreOptions) {
    this.eventFeedLimit = options.eventFeedLimit;
    this.captureLogLimit = options.captureLogLimit;
  }

  recordRuntimeEvent(event: RuntimeEventWithoutSequence): void {
    this.sequence += 1;
    this.pushBounded(
      this.events,
      {
        sequence: this.sequence,
        ...event,
      },
      this.eventFeedLimit,
    );
  }

  recordPublishedSourceEvent(event: SourceEvent, recordedAt: string): void {
    this.pushBounded(this.publishedSourceEvents, event, this.captureLogLimit);
    this.pushBounded(
      this.captureSteps,
      {
        sequence: this.nextCaptureSequence(),
        recordedAt,
        kind: "publishSource",
        event,
      },
      this.captureLogLimit,
    );
  }

  recordSubmittedResponse(response: AttentionResponse, recordedAt: string): void {
    this.pushBounded(
      this.captureSteps,
      {
        sequence: this.nextCaptureSequence(),
        recordedAt,
        kind: "submit",
        response,
      },
      this.captureLogLimit,
    );
  }

  recordObservedResponse(response: AttentionResponse): void {
    this.pushBounded(this.submittedResponses, response, this.captureLogLimit);
  }

  recordSignal(signal: AttentionSignal): void {
    this.pushBounded(this.signals, signal, this.captureLogLimit);
  }

  recordTrace(trace: ApertureTrace): void {
    this.pushBounded(this.traces, trace, this.captureLogLimit);
  }

  recordAttentionViewSnapshot(
    snapshot: Omit<ApertureRuntimeAttentionViewSnapshot, "sequence">,
  ): void {
    this.pushBounded(
      this.attentionViewSnapshots,
      {
        sequence: this.nextCaptureSequence(),
        ...snapshot,
      },
      this.captureLogLimit,
    );
  }

  eventsSince(sequence: number): ApertureRuntimeEvent[] {
    return this.events.filter((event) => event.sequence > sequence);
  }

  currentSequence(): number {
    return this.sequence;
  }

  exportCaptureData(): {
    captureSteps: ApertureRuntimeCaptureStep[];
    publishedSourceEvents: SourceEvent[];
    submittedResponses: AttentionResponse[];
    signals: AttentionSignal[];
    traces: ApertureTrace[];
    attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[];
  } {
    return {
      captureSteps: [...this.captureSteps],
      publishedSourceEvents: [...this.publishedSourceEvents],
      submittedResponses: [...this.submittedResponses],
      signals: [...this.signals],
      traces: [...this.traces],
      attentionViewSnapshots: [...this.attentionViewSnapshots],
    };
  }

  private nextCaptureSequence(): number {
    this.captureSequence += 1;
    return this.captureSequence;
  }

  private pushBounded<T>(entries: T[], entry: T, limit: number): void {
    entries.push(entry);
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
  }
}
