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
};

export async function deliverQueuedAttention(
  delivery: QueuedAttentionDelivery,
  direct: OmpDirectWorkerTransport,
  notification: OmarchyNotificationTransport,
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

  let accepted = 0;
  try {
    for (const event of directEvents) {
      await sendDirectEvent(event, direct);
      accepted += 1;
    }
    await notification.handleClosures(delivery.event, delivery.context);
  } catch (error) {
    const disposition = ompDirectDeliveryDisposition(error);
    const workerRejected = error instanceof Error && error.name === "WorkerDirectRejectedError";
    if (accepted === 0 && disposition !== "acceptance-unknown" && !workerRejected) {
      await notification.handle(delivery.event, delivery.context);
      return;
    }
    throw error;
  }
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
