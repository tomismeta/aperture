import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import {
  ompDirectDeliveryDisposition,
  type OmpDirectWorkerTransport,
} from "./direct-worker-transport.js";
import type { OmarchyNotificationTransport } from "./omarchy-notification-transport.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";
const MAXIMUM_AMBIGUOUS_DELIVERY_ATTEMPTS = 3;
const TRANSIENT_DIRECT_REJECTION_CODES = new Set([
  "capacity",
  "processing_failed",
  "attention_engine_failed",
]);
export class AttentionDeliveryRetryError extends Error {
  constructor(readonly deliveryCause: unknown) {
    super("Aperture direct attention delivery remains acceptance-unknown");
    this.name = "AttentionDeliveryRetryError";
  }
}

export type QueuedAttentionDelivery = {
  kind: "event";
  event: OmpEvent;
  context: OmpMappingContext;
  directEvents?: OmpAttentionEvent[];
  forceNative?: boolean;
  nativeFallbackAllowed?: boolean;
  retryAttempt?: number;
};

export type AttentionDeliveryRoute = "direct" | "native" | "accepted";

export type AttentionDeliveryObserver = {
  prepare(event: OmpAttentionEvent): void;
  routeFor(event: OmpAttentionEvent): AttentionDeliveryRoute;
  mayUseNative(event: OmpAttentionEvent): boolean;
  acceptedDirect(event: OmpAttentionEvent): void;
  selectedNative(event: OmpAttentionEvent): void;
};

const untrackedDelivery: AttentionDeliveryObserver = {
  prepare: () => undefined,
  routeFor: () => "direct",
  mayUseNative: () => true,
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
    observer.prepare(event);
    const route = observer.routeFor(event);
    if (route === "accepted") continue;
    if (
      delivery.nativeFallbackAllowed !== false &&
      (delivery.forceNative || route === "native") &&
      observer.mayUseNative(event)
    ) {
      observer.selectedNative(event);
      nativeRequired = true;
      continue;
    }
    try {
      await sendDirectEvent(event, direct);
      observer.acceptedDirect(event);
    } catch (error) {
      if (!observer.mayUseNative(event) && isTransientDirectRejection(error)) {
        throw new AttentionDeliveryRetryError(error);
      }
      const disposition = ompDirectDeliveryDisposition(error);
      if (disposition === "acceptance-unknown") {
        throw new AttentionDeliveryRetryError(error);
      }
      if (
        disposition === "definitely-not-accepted" &&
        delivery.nativeFallbackAllowed !== false &&
        observer.mayUseNative(event)
      ) {
        observer.selectedNative(event);
        nativeRequired = true;
        continue;
      }
      if (disposition === "definitely-not-accepted") {
        throw new AttentionDeliveryRetryError(error);
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

function isTransientDirectRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "WorkerDirectRejectedError" &&
    typeof candidate.code === "string" &&
    TRANSIENT_DIRECT_REJECTION_CODES.has(candidate.code)
  );
}
