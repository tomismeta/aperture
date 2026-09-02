import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import type { OmpDirectWorkerTransport } from "./direct-worker-transport.js";
import type { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

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

  try {
    for (const event of directEvents) await direct.send(event);
    await notification.handleClosures(delivery.event, delivery.context);
  } catch {
    await notification.handle(delivery.event, delivery.context);
  }
}
