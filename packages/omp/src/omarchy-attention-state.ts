import { createHash } from "node:crypto";

import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import type { AttentionDeliveryRoute } from "./omarchy-attention-delivery.js";

export const MAXIMUM_QUEUED_DELIVERIES = 64;
export const MAXIMUM_CONCURRENT_NATIVE_FALLBACKS = 4;
const MAXIMUM_TRACKED_EVENT_IDS = 256;

export type FocusReplayRegistration = {
  workerGeneration: string;
  publicHandle: string;
  receiptEpisodeToken: string;
};

export class CausalAttentionState {
  private readonly directEventIds = new Map<string, true>();
  private readonly nativeEventIds = new Map<string, true>();
  private readonly directClosureEventIds = new Map<string, true>();
  private readonly activeRequests = new Map<string, OmpAttentionEvent>();
  private readonly completionKeyBySession = new Map<string, string>();

  prepareDelivery(event: OmpAttentionEvent): void {
    if (!isClosure(event) || this.directClosureEventIds.has(event.eventId)) return;
    const directAuthority = this.hasDirectAuthority(event);
    this.applyClosure(event);
    if (directAuthority) {
      rememberBounded(
        this.directClosureEventIds,
        event.eventId,
        MAXIMUM_TRACKED_EVENT_IDS,
      );
    }
  }

  routeFor(event: OmpAttentionEvent): AttentionDeliveryRoute {
    if (this.nativeEventIds.has(event.eventId)) return "native";
    if (this.directEventIds.has(event.eventId)) return "accepted";
    return "direct";
  }

  mayUseNative(event: OmpAttentionEvent): boolean {
    return !this.directClosureEventIds.has(event.eventId);
  }

  acceptedDirect(event: OmpAttentionEvent): boolean {
    rememberBounded(this.directEventIds, event.eventId, MAXIMUM_TRACKED_EVENT_IDS);
    if (isClosure(event)) {
      this.applyClosure(event);
      return false;
    }
    if (!event.interactionId) return false;
    const key = interactionKey(event);
    if (event.classification === "turn_completed") {
      this.deleteCompletion(event.sessionId);
      this.rememberActive(key, event);
      this.completionKeyBySession.set(event.sessionId, key);
      return true;
    }
    if (
      event.classification !== "approval_requested" &&
      event.classification !== "input_requested"
    ) {
      return false;
    }
    this.rememberActive(key, event);
    return true;
  }

  selectedNative(event: OmpAttentionEvent): void {
    this.applyClosure(event);
    if (isClosure(event)) return;
    rememberBounded(this.nativeEventIds, event.eventId, MAXIMUM_TRACKED_EVENT_IDS);
  }

  focusReplayEvents(publicHandle: string, receiptEpisodeToken: string): OmpAttentionEvent[] {
    return [...this.activeRequests.values()].map((event) =>
      focusReplayEvent(event, publicHandle, receiptEpisodeToken),
    );
  }

  clear(): void {
    this.directEventIds.clear();
    this.nativeEventIds.clear();
    this.directClosureEventIds.clear();
    this.activeRequests.clear();
    this.completionKeyBySession.clear();
  }

  private hasDirectAuthority(event: OmpAttentionEvent): boolean {
    if (event.classification === "session_shutdown") {
      const prefix = `${event.sessionId}\u0000`;
      for (const key of this.activeRequests.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }
    if (event.classification === "completion_resolved") {
      return this.completionKeyBySession.has(event.sessionId);
    }
    return Boolean(event.interactionId && this.activeRequests.has(interactionKey(event)));
  }

  private applyClosure(event: OmpAttentionEvent): void {
    if (event.classification === "session_shutdown") {
      this.deleteSession(event.sessionId);
      return;
    }
    if (event.classification === "completion_resolved") {
      this.deleteCompletion(event.sessionId);
      return;
    }
    if (
      event.interactionId &&
      (event.classification === "approval_resolved" ||
        event.classification === "input_resolved")
    ) {
      this.deleteActive(interactionKey(event));
    }
  }

  private rememberActive(key: string, event: OmpAttentionEvent): void {
    if (!this.activeRequests.has(key) && this.activeRequests.size >= MAXIMUM_QUEUED_DELIVERIES) {
      const oldest = this.activeRequests.keys().next().value;
      if (typeof oldest === "string") this.deleteActive(oldest);
    }
    const { focus: _focus, ...withoutFocus } = event;
    this.activeRequests.set(key, withoutFocus);
  }

  private deleteActive(key: string): void {
    this.activeRequests.delete(key);
    for (const [sessionId, completionKey] of this.completionKeyBySession) {
      if (completionKey === key) this.completionKeyBySession.delete(sessionId);
    }
  }

  private deleteCompletion(sessionId: string): void {
    const key = this.completionKeyBySession.get(sessionId);
    if (key) this.activeRequests.delete(key);
    this.completionKeyBySession.delete(sessionId);
  }

  private deleteSession(sessionId: string): void {
    this.deleteCompletion(sessionId);
    const prefix = `${sessionId}\u0000`;
    for (const key of this.activeRequests.keys()) {
      if (key.startsWith(prefix)) this.activeRequests.delete(key);
    }
  }
}

function interactionKey(event: OmpAttentionEvent): string {
  return `${event.sessionId}\u0000${event.interactionId}`;
}

function isClosure(event: OmpAttentionEvent): boolean {
  return event.transition === "resolved" || event.transition === "shutdown";
}

function rememberBounded(map: Map<string, true>, key: string, maximumSize: number): void {
  if (map.has(key)) return;
  if (map.size >= maximumSize) {
    const oldest = map.keys().next().value;
    if (typeof oldest === "string") map.delete(oldest);
  }
  map.set(key, true);
}

function focusReplayEvent(
  event: OmpAttentionEvent,
  publicHandle: string,
  receiptEpisodeToken: string,
): OmpAttentionEvent {
  const replayIdentity = createHash("sha256")
    .update(event.eventId)
    .update("\u0000focus\u0000")
    .update(receiptEpisodeToken)
    .digest("hex");
  return {
    ...event,
    eventId: `omp-focus:${replayIdentity}`,
    focus: { kind: "opaque-focus", handle: publicHandle },
  };
}
