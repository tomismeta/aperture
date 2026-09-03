import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import type { OmpDirectWorkerTransport } from "./direct-worker-transport.js";

const MAXIMUM_REPLAY_EVENTS = 64;
const REPLAY_RESPONSE_TIMEOUT_MS = 750;

export type FocusReplayResult =
  | "succeeded"
  | "connection-timeout"
  | "response-timeout"
  | "delivery-failed"
  | "invalid-acknowledgement"
  | "processing-failed"
  | "processing-timeout"
  | "attention-engine-failed"
  | "attention-snapshot-failed"
  | "rejected"
  | "unknown-failure";

type ReplayRequest = {
  workerGeneration: string;
  events: OmpAttentionEvent[];
};

export class FocusReplaySender {
  private queued: ReplayRequest | null = null;
  private draining: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private active = true;

  constructor(
    private readonly direct: OmpDirectWorkerTransport,
    private readonly onResult: (result: FocusReplayResult) => void,
  ) {}

  send(workerGeneration: string, events: OmpAttentionEvent[]): void {
    if (
      !this.active ||
      !/^[A-Za-z0-9_-]{32}$/.test(workerGeneration) ||
      events.length === 0 ||
      events.length > MAXIMUM_REPLAY_EVENTS
    ) {
      return;
    }
    this.queued = { workerGeneration, events: [...events] };
    this.draining ??= this.drain();
  }

  async close(): Promise<void> {
    if (this.active) {
      this.active = false;
      this.queued = null;
      this.controller?.abort();
    }
    if (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      while (this.active && this.queued) {
        const request = this.queued;
        this.queued = null;
        const controller = new AbortController();
        this.controller = controller;
        await this.deliver(request, controller.signal);
        if (this.controller === controller) this.controller = null;
      }
    } finally {
      this.controller = null;
      this.draining = null;
      if (this.active && this.queued) this.draining = this.drain();
    }
  }

  private async deliver(request: ReplayRequest, signal: AbortSignal): Promise<void> {
    try {
      for (const event of request.events) {
        if (!this.active || signal.aborted) return;
        await this.direct.send(event, REPLAY_RESPONSE_TIMEOUT_MS, signal);
      }
      if (this.active && !signal.aborted) this.onResult("succeeded");
    } catch (error) {
      if (this.active && !signal.aborted) this.onResult(classifyReplayFailure(error));
    }
  }
}

function classifyReplayFailure(error: unknown): FocusReplayResult {
  if (!(error instanceof Error)) return "unknown-failure";
  if (error.name === "WorkerDirectRejectedError") {
    const code = (error as Error & { code?: unknown }).code;
    if (code === "processing_failed") return "processing-failed";
    if (code === "processing_timeout") return "processing-timeout";
    if (code === "attention_engine_failed") return "attention-engine-failed";
    if (code === "attention_snapshot_failed") return "attention-snapshot-failed";
    return "rejected";
  }
  if (error.message.includes("rejected direct message")) return "rejected";
  if (error.message.includes("connection timed out")) return "connection-timeout";
  if (error.message.includes("response timed out")) return "response-timeout";
  if (
    error.message.includes("delivery failed") ||
    error.message.includes("write failed") ||
    error.message.includes("closed before acknowledgement")
  ) {
    return "delivery-failed";
  }
  if (error.message.includes("acknowledgement")) return "invalid-acknowledgement";
  return "unknown-failure";
}
