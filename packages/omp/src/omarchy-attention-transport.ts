import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import type { OmpEventSink } from "./bind.js";
import { boundedShutdownWait } from "./bounded-shutdown.js";
import { OmpDirectWorkerTransport } from "./direct-worker-transport.js";
import { FocusReplaySender, type FocusReplayResult } from "./focus-replay-sender.js";
import { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import {
  deliverQueuedAttention,
  type QueuedAttentionDelivery,
} from "./omarchy-attention-delivery.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

const MAXIMUM_QUEUED_DELIVERIES = 64;
const SHUTDOWN_TIMEOUT_MS = 3_000;
export type OmarchyAttentionTransportOptions = {
  direct: OmpDirectWorkerTransport;
  notification: OmarchyNotificationTransport;
  onFailure?: (error: unknown) => void;
  onFocusReplay?: (result: FocusReplayResult) => void;
  shutdownTimeoutMs?: number;
  waitForShutdown?: (operation: Promise<unknown>, milliseconds: number) => Promise<void>;
};

export class OmarchyAttentionTransport implements OmpEventSink {
  private readonly direct: OmpDirectWorkerTransport;
  private readonly notification: OmarchyNotificationTransport;
  private readonly onFailure: (error: unknown) => void;
  private readonly focusReplay: FocusReplaySender;
  private readonly shutdownTimeoutMs: number;
  private readonly waitForShutdown: NonNullable<
    OmarchyAttentionTransportOptions["waitForShutdown"]
  >;
  private readonly queue: QueuedAttentionDelivery[] = [];
  private draining: Promise<void> | null = null;
  private active = true;
  private closed = false;

  constructor(options: OmarchyAttentionTransportOptions) {
    this.direct = options.direct;
    this.notification = options.notification;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
    this.waitForShutdown = options.waitForShutdown ?? boundedShutdownWait;
    this.onFailure = options.onFailure ?? (() => undefined);
    this.focusReplay = new FocusReplaySender(
      this.direct,
      options.onFocusReplay ?? (() => undefined),
    );
  }

  async isAvailable(): Promise<boolean> {
    const [direct, notification] = await Promise.all([
      this.direct.isAvailable(),
      this.notification.isAvailable(),
    ]);
    return direct || notification;
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    this.enqueue({ kind: "event", event, context });
  }

  async handleMapped(
    event: OmpEvent,
    context: OmpMappingContext,
    directEvents: OmpAttentionEvent[],
  ): Promise<void> {
    this.enqueue({ kind: "event", event, context, directEvents: [...directEvents] });
  }

  replayFocus(workerGeneration: string, events: OmpAttentionEvent[]): void {
    if (this.active) this.focusReplay.send(workerGeneration, events);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.active = false;
    const replayClosing = this.focusReplay.close();
    this.queue.length = 0;
    const deadline = Date.now() + this.shutdownTimeoutMs;
    const pending: Promise<unknown>[] = [replayClosing];
    if (this.draining) pending.push(this.draining);
    await this.waitForShutdown(Promise.allSettled(pending), Math.max(0, deadline - Date.now()));
    await this.waitForShutdown(
      Promise.allSettled([this.direct.close(), this.notification.close()]),
      Math.max(0, deadline - Date.now()),
    );
  }

  disable(): void {
    this.active = false;
    void this.focusReplay.close();
    this.queue.length = 0;
  }

  private enqueue(delivery: QueuedAttentionDelivery): void {
    if (!this.active) return;
    if (this.queue.length >= MAXIMUM_QUEUED_DELIVERIES) {
      void this.notification
        .handle(delivery.event, delivery.context)
        .catch((error) => this.onFailure(error));
      return;
    }
    this.queue.push(delivery);
    this.draining ??= this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.active) {
        const delivery = this.queue.shift();
        if (!delivery) return;
        try {
          await deliverQueuedAttention(delivery, this.direct, this.notification);
        } catch (error) {
          this.onFailure(error);
        }
      }
    } finally {
      this.draining = null;
      if (this.active && this.queue.length > 0) this.draining = this.drain();
    }
  }
}
