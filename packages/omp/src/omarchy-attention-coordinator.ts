import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import { boundedShutdownWait } from "./bounded-shutdown.js";
import { OmpDirectWorkerTransport } from "./direct-worker-transport.js";
import { FocusReplaySender, type FocusReplayResult } from "./focus-replay-sender.js";
import { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import {
  deliverQueuedAttention,
  type AttentionDeliveryObserver,
  type QueuedAttentionDelivery,
} from "./omarchy-attention-delivery.js";
import {
  CausalAttentionState,
  MAXIMUM_QUEUED_DELIVERIES,
  type FocusReplayRegistration,
} from "./omarchy-attention-state.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

const SHUTDOWN_TIMEOUT_MS = 3_000;
const MAXIMUM_CONCURRENT_NATIVE_FALLBACKS = 4;

export type OmarchyAttentionCoordinatorOptions = {
  direct: OmpDirectWorkerTransport;
  notification: OmarchyNotificationTransport;
  onFailure?: (error: unknown) => void;
  onFocusReplay?: (result: FocusReplayResult) => void;
  shutdownTimeoutMs?: number;
  waitForShutdown?: (operation: Promise<unknown>, milliseconds: number) => Promise<void>;
};

export class OmarchyAttentionCoordinator {
  private readonly direct: OmpDirectWorkerTransport;
  private readonly notification: OmarchyNotificationTransport;
  private readonly onFailure: (error: unknown) => void;
  private readonly focusReplay: FocusReplaySender;
  private readonly shutdownTimeoutMs: number;
  private readonly waitForShutdown: NonNullable<
    OmarchyAttentionCoordinatorOptions["waitForShutdown"]
  >;
  private readonly state = new CausalAttentionState();
  private readonly queue: QueuedAttentionDelivery[] = [];
  private readonly nativeFallbacks = new Set<Promise<void>>();
  private readonly deliveryObserver: AttentionDeliveryObserver = {
    routeFor: (event) => this.state.routeFor(event),
    acceptedDirect: (event) => {
      if (this.stopped) return;
      if (this.state.acceptedDirect(event)) this.replayLatestFocus();
    },
    selectedNative: (event) => {
      if (!this.stopped) this.state.selectedNative(event);
    },
  };
  private latestFocus: FocusReplayRegistration | undefined;
  private draining: Promise<void> | null = null;
  private accepting = true;
  private stopped = false;
  private closed = false;

  constructor(options: OmarchyAttentionCoordinatorOptions) {
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

  handle(event: OmpEvent, context: OmpMappingContext): void {
    this.enqueue({ kind: "event", event, context });
  }

  handleMapped(
    event: OmpEvent,
    context: OmpMappingContext,
    directEvents: OmpAttentionEvent[],
  ): void {
    this.enqueue({ kind: "event", event, context, directEvents: [...directEvents] });
  }

  replayFocus(workerGeneration: string, publicHandle: string): void {
    if (
      !this.accepting ||
      !/^[A-Za-z0-9_-]{32}$/.test(workerGeneration) ||
      !/^[A-Za-z0-9_-]{32}$/.test(publicHandle)
    ) {
      return;
    }
    this.latestFocus = { workerGeneration, publicHandle };
    this.replayLatestFocus();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.accepting = false;
    const replayClosing = this.focusReplay.close();
    const deadline = Date.now() + this.shutdownTimeoutMs;
    const pending: Promise<unknown>[] = [replayClosing, ...this.nativeFallbacks];
    if (this.draining) pending.push(this.draining);
    await this.waitForShutdown(Promise.allSettled(pending), Math.max(0, deadline - Date.now()));
    this.stopped = true;
    this.queue.length = 0;
    await this.waitForShutdown(
      Promise.allSettled([this.direct.close(), this.notification.close()]),
      Math.max(0, deadline - Date.now()),
    );
    this.latestFocus = undefined;
    this.state.clear();
  }

  disable(): void {
    this.accepting = false;
    this.stopped = true;
    this.latestFocus = undefined;
    void this.focusReplay.close();
    this.queue.length = 0;
    this.state.clear();
  }

  private enqueue(delivery: QueuedAttentionDelivery): void {
    if (!this.accepting) return;
    if (this.queue.length >= MAXIMUM_QUEUED_DELIVERIES) {
      if (this.nativeFallbacks.size >= MAXIMUM_CONCURRENT_NATIVE_FALLBACKS) {
        this.onFailure(new Error("Aperture OMP native fallback capacity was exhausted"));
        return;
      }
      const fallback = this.deliverNativeFallback(delivery);
      this.nativeFallbacks.add(fallback);
      void fallback.then(
        () => this.nativeFallbacks.delete(fallback),
        () => this.nativeFallbacks.delete(fallback),
      );
      return;
    }
    this.queue.push(delivery);
    this.draining ??= this.drain();
  }

  private async deliverNativeFallback(delivery: QueuedAttentionDelivery): Promise<void> {
    try {
      await deliverQueuedAttention(
        { ...delivery, forceNative: true },
        this.direct,
        this.notification,
        this.deliveryObserver,
      );
    } catch (error) {
      this.onFailure(error);
    }
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopped) {
        const delivery = this.queue.shift();
        if (!delivery) return;
        try {
          await deliverQueuedAttention(
            delivery,
            this.direct,
            this.notification,
            this.deliveryObserver,
          );
        } catch (error) {
          this.onFailure(error);
        }
      }
    } finally {
      this.draining = null;
      if (!this.stopped && this.queue.length > 0) this.draining = this.drain();
    }
  }

  private replayLatestFocus(): void {
    if (!this.latestFocus || this.stopped) return;
    this.focusReplay.send(
      this.latestFocus.workerGeneration,
      this.state.focusReplayEvents(this.latestFocus.publicHandle),
    );
  }
}
