import type { OmpEventSink } from "./bind.js";
import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import { OmpDirectWorkerTransport } from "./direct-worker-transport.js";
import { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

const MAXIMUM_QUEUED_DELIVERIES = 64;

export type OmarchyAttentionTransportOptions = {
  direct: OmpDirectWorkerTransport;
  notification: OmarchyNotificationTransport;
  onFailure?: (error: unknown) => void;
};

type QueuedDelivery = {
  event: OmpEvent;
  context: OmpMappingContext;
};

export class OmarchyAttentionTransport implements OmpEventSink {
  private readonly direct: OmpDirectWorkerTransport;
  private readonly notification: OmarchyNotificationTransport;
  private readonly onFailure: (error: unknown) => void;
  private readonly queue: QueuedDelivery[] = [];
  private draining: Promise<void> | null = null;
  private active = true;

  constructor(options: OmarchyAttentionTransportOptions) {
    this.direct = options.direct;
    this.notification = options.notification;
    this.onFailure = options.onFailure ?? (() => undefined);
  }

  async isAvailable(): Promise<boolean> {
    const [direct, notification] = await Promise.all([
      this.direct.isAvailable(),
      this.notification.isAvailable(),
    ]);
    return direct || notification;
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    if (!this.active) return;
    if (this.queue.length >= MAXIMUM_QUEUED_DELIVERIES) {
      void this.notification.handle(event, context).catch((error) => this.onFailure(error));
      return;
    }
    this.queue.push({ event, context });
    this.draining ??= this.drain();
  }

  async close(): Promise<void> {
    await this.draining;
    await Promise.all([this.direct.close(), this.notification.close()]);
  }

  disable(): void {
    this.active = false;
    this.queue.length = 0;
  }

  private async drain(): Promise<void> {
    try {
      while (this.active) {
        const delivery = this.queue.shift();
        if (!delivery) return;
        try {
          await this.deliver(delivery);
        } catch (error) {
          this.onFailure(error);
        }
      }
    } finally {
      this.draining = null;
      if (this.active && this.queue.length > 0) this.draining = this.drain();
    }
  }

  private async deliver(delivery: QueuedDelivery): Promise<void> {
    let directEvents;
    try {
      directEvents = mapOmpDirectAttentionEvents(delivery.event, delivery.context);
    } catch {
      await this.notification.handle(delivery.event, delivery.context);
      return;
    }
    if (directEvents.length === 0) {
      await this.notification.handle(delivery.event, delivery.context);
      return;
    }

    try {
      for (const event of directEvents) await this.direct.send(event);
      await this.notification.handleClosures(delivery.event, delivery.context);
    } catch {
      await this.notification.handle(delivery.event, delivery.context);
    }
  }
}
