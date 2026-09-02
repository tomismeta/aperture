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

export class FocusReplaySender {
  private pending = false;
  private active = true;

  constructor(
    private readonly direct: OmpDirectWorkerTransport,
    private readonly onResult: (result: FocusReplayResult) => void,
  ) {}

  send(events: OmpAttentionEvent[]): void {
    if (
      !this.active ||
      this.pending ||
      events.length === 0 ||
      events.length > MAXIMUM_REPLAY_EVENTS
    ) {
      return;
    }
    this.pending = true;
    void this.deliver([...events]).finally(() => {
      this.pending = false;
    });
  }

  close(): void {
    this.active = false;
  }

  private async deliver(events: OmpAttentionEvent[]): Promise<void> {
    try {
      for (const event of events) {
        await this.direct.send(event, REPLAY_RESPONSE_TIMEOUT_MS);
      }
      if (this.active) this.onResult("succeeded");
    } catch (error) {
      if (this.active) this.onResult(classifyReplayFailure(error));
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
