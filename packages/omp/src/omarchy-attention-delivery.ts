import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import {
  ompDirectDeliveryDisposition,
  type OmpDirectWorkerTransport,
} from "./direct-worker-transport.js";
import type { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";
const MAXIMUM_AMBIGUOUS_DELIVERY_ATTEMPTS = 3;

export type QueuedAttentionDelivery = {
  kind: "event";
  event: OmpEvent;
  context: OmpMappingContext;
  directEvents?: OmpAttentionEvent[];
  forceNative?: boolean;
};

export type AttentionDeliveryRoute = "direct" | "native" | "accepted";

export type AttentionDeliveryObserver = {
  routeFor(event: OmpAttentionEvent): AttentionDeliveryRoute;
  acceptedDirect(event: OmpAttentionEvent): void;
  selectedNative(event: OmpAttentionEvent): void;
};

const untrackedDelivery: AttentionDeliveryObserver = {
  routeFor: () => "direct",
  acceptedDirect: () => undefined,
  selectedNative: () => undefined,
};

export async function deliverQueuedAttention(
  delivery: QueuedAttentionDelivery,
  direct: OmpDirectWorkerTransport,
  notification: OmarchyNotificationTransport,
  observer: AttentionDeliveryObserver = untrackedDelivery,
): Promise<void> {
  let directEvents: OmpAttentionEvent[];
  try {
    directEvents =
      delivery.directEvents ?? mapOmpDirectAttentionEvents(delivery.event, delivery.context);
  } catch {
    await notification.handle(delivery.event, delivery.context);
    return;
  }
  if (directEvents.length === 0) {
    await notification.handle(delivery.event, delivery.context);
    return;
  }

  let nativeRequired = false;
  for (const event of directEvents) {
    const route = observer.routeFor(event);
    if (route === "accepted") continue;
    if (delivery.forceNative || route === "native") {
      observer.selectedNative(event);
      nativeRequired = true;
      continue;
    }
    try {
      await sendDirectEvent(event, direct);
      observer.acceptedDirect(event);
    } catch (error) {
      const disposition = ompDirectDeliveryDisposition(error);
      const workerRejected = error instanceof Error && error.name === "WorkerDirectRejectedError";
      if (disposition !== "acceptance-unknown" && !workerRejected) {
        observer.selectedNative(event);
        nativeRequired = true;
        continue;
      }
      throw error;
    }
  }
  if (nativeRequired) await notification.handle(delivery.event, delivery.context);
  else await notification.handleClosures(delivery.event, delivery.context);
}

async function sendDirectEvent(
  event: OmpAttentionEvent,
  direct: OmpDirectWorkerTransport,
): Promise<void> {
  for (let attempt = 1; attempt <= MAXIMUM_AMBIGUOUS_DELIVERY_ATTEMPTS; attempt += 1) {
    try {
      await direct.send(event);
      return;
    } catch (error) {
      if (
        ompDirectDeliveryDisposition(error) !== "acceptance-unknown" ||
        attempt === MAXIMUM_AMBIGUOUS_DELIVERY_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}
