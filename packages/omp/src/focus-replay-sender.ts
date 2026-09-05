import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import {
  ompDirectDeliveryDisposition,
  type OmpDirectWorkerTransport,
} from "./direct-worker-transport.js";

const MAXIMUM_REPLAY_EVENTS = 64;
const REPLAY_RESPONSE_TIMEOUT_MS = 750;
const MAXIMUM_TRANSIENT_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 250] as const;

export type FocusReplayResult =
  | "succeeded"
  | "connection-timeout"
  | "response-timeout"
  | "delivery-failed"
  | "invalid-acknowledgement"
  | "processing-failed"
  | "processing-timeout"
  | "attention-engine-failed"
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
    let finalFailure: FocusReplayResult | undefined;
    for (let attempt = 1; attempt <= MAXIMUM_TRANSIENT_ATTEMPTS; attempt += 1) {
      try {
        for (const event of request.events) {
          if (!this.active || signal.aborted || this.superseded(request)) return;
          await this.direct.send(event, REPLAY_RESPONSE_TIMEOUT_MS, signal);
        }
        if (this.active && !signal.aborted && !this.superseded(request)) {
          this.onResult("succeeded");
        }
        return;
      } catch (error) {
        if (!this.active || signal.aborted || this.superseded(request)) return;
        finalFailure = classifyReplayFailure(error);
        if (!isTransientReplayFailure(error, finalFailure) || attempt === MAXIMUM_TRANSIENT_ATTEMPTS) {
          this.onResult(finalFailure);
          return;
        }
        await delay(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!, signal);
      }
    }
  }

  private superseded(request: ReplayRequest): boolean {
    return this.queued !== null && this.queued.workerGeneration !== request.workerGeneration;
  }
}

function classifyReplayFailure(error: unknown): FocusReplayResult {
  if (!(error instanceof Error)) return "unknown-failure";
  if (error.name === "WorkerDirectRejectedError") {
    const code = (error as Error & { code?: unknown }).code;
    if (code === "processing_failed") return "processing-failed";
    if (code === "processing_timeout") return "processing-timeout";
    if (code === "attention_engine_failed") return "attention-engine-failed";
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

function isTransientReplayFailure(error: unknown, result: FocusReplayResult): boolean {
  return (
    ompDirectDeliveryDisposition(error) !== undefined ||
    result === "connection-timeout" ||
    result === "response-timeout" ||
    result === "delivery-failed" ||
    result === "processing-timeout" ||
    result === "attention-engine-failed"
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
