import { assertOmpSessionId } from "@tomismeta/aperture/omp-attention-event";
import {
  OMP_SESSION_HEARTBEAT_INTERVAL_MS,
  WORKER_DIRECT_PROTOCOL_VERSION,
  type OmpSessionHeartbeat,
} from "@tomismeta/aperture/worker-direct-message";

import type { OmpDirectWorkerTransport } from "./direct-worker-transport.js";

const HEARTBEAT_RESPONSE_TIMEOUT_MS = 1_000;

export type SessionHeartbeatSenderOptions = {
  intervalMilliseconds?: number;
  responseTimeoutMilliseconds?: number;
  onFailure?: (error: unknown) => void;
};

type SessionHeartbeatTransport = Pick<OmpDirectWorkerTransport, "send">;

export class SessionHeartbeatSender {
  private readonly intervalMilliseconds: number;
  private readonly responseTimeoutMilliseconds: number;
  private readonly onFailure: (error: unknown) => void;
  private timer: NodeJS.Timeout | undefined;
  private pending: Promise<void> | undefined;
  private pendingController: AbortController | undefined;
  private sessionId: string | undefined;
  private serial = 0;
  private closed = false;

  constructor(
    private readonly direct: SessionHeartbeatTransport,
    options: SessionHeartbeatSenderOptions = {},
  ) {
    this.intervalMilliseconds = options.intervalMilliseconds ?? OMP_SESSION_HEARTBEAT_INTERVAL_MS;
    this.responseTimeoutMilliseconds =
      options.responseTimeoutMilliseconds ?? HEARTBEAT_RESPONSE_TIMEOUT_MS;
    this.onFailure = options.onFailure ?? (() => undefined);
    if (
      !Number.isSafeInteger(this.intervalMilliseconds) ||
      this.intervalMilliseconds < 1 ||
      !Number.isSafeInteger(this.responseTimeoutMilliseconds) ||
      this.responseTimeoutMilliseconds < 1
    ) {
      throw new Error("Aperture OMP heartbeat timing was invalid");
    }
  }

  observe(sessionId: string): void {
    if (this.closed) return;
    const validated = assertOmpSessionId(sessionId);
    if (validated === this.sessionId) return;
    this.sessionId = validated;
    this.pulse();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pulse(), this.intervalMilliseconds);
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.sessionId = undefined;
    clearInterval(this.timer);
    this.pendingController?.abort(new Error("Aperture OMP heartbeat sender closed"));
    await this.pending?.catch(() => undefined);
  }

  private pulse(): void {
    const sessionId = this.sessionId;
    if (this.closed || !sessionId || this.pending) return;
    this.serial = this.serial >= Number.MAX_SAFE_INTEGER ? 1 : this.serial + 1;
    const message: OmpSessionHeartbeat = {
      schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
      type: "omp.session-heartbeat",
      requestId: `heartbeat-${this.serial}`,
      sessionId,
    };
    const controller = new AbortController();
    this.pendingController = controller;
    this.pending = this.direct
      .send(message, this.responseTimeoutMilliseconds, controller.signal)
      .then(() => undefined)
      .catch((error) => {
        if (!this.closed) this.onFailure(error);
      })
      .finally(() => {
        this.pending = undefined;
        if (this.pendingController === controller) this.pendingController = undefined;
        if (!this.closed && this.sessionId !== sessionId) this.pulse();
      });
  }
}
