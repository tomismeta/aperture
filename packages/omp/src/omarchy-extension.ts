import { createHash } from "node:crypto";

import { FocusHost, type FocusHostOptions } from "@tomismeta/aperture/focus-host";
import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import { bindOmpExtension } from "./bind.js";
import {
  OmpDirectWorkerTransport,
  type OmpDirectWorkerTransportOptions,
} from "./direct-worker-transport.js";
import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import { OmarchyAttentionTransport } from "./omarchy-attention-transport.js";
import {
  OmarchyNotificationTransport,
  type OmarchyNotificationTransportOptions,
} from "./omarchy-notification-transport.js";
import type { OmpEvent, OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmarchyOmpExtensionOptions = OmarchyNotificationTransportOptions & {
  mappingContext?: OmpMappingContext;
  suppressBuiltInNotifications?: boolean;
  directTransport?: OmpDirectWorkerTransport;
  directTransportOptions?: OmpDirectWorkerTransportOptions;
  focusHostOptions?: Omit<
    FocusHostOptions,
    "transport" | "terminalTitle" | "onRegistered" | "onStatus"
  >;
};

export function createApertureOmarchyOmpExtension(
  options: ApertureOmarchyOmpExtensionOptions = {},
) {
  return async function apertureOmarchyOmpExtension(pi: OmpExtensionApi): Promise<void> {
    const {
      mappingContext,
      suppressBuiltInNotifications = true,
      directTransport: configuredDirectTransport,
      directTransportOptions,
      focusHostOptions,
      ...notificationOptions
    } = options;
    const direct =
      configuredDirectTransport ?? new OmpDirectWorkerTransport(directTransportOptions);
    const notification = new OmarchyNotificationTransport(notificationOptions);
    let suppressionActive = false;
    let deliveryActive = true;
    let focusHost: FocusHost | undefined;
    const focusReplayCache = new Map<string, OmpAttentionEvent>();
    function handleDeliveryFailure(error: unknown): void {
      pi.logger?.warn?.("Aperture OMP adapter delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!suppressionActive || !deliveryActive) return;
      deliveryActive = false;
      transport.disable();
      restoreBuiltInNotifications();
    }
    const previousNotifications = process.env.PI_NOTIFICATIONS;
    const restoreBuiltInNotifications = (): void => {
      if (!suppressionActive || process.env.PI_NOTIFICATIONS !== "off") return;
      if (previousNotifications === undefined) delete process.env.PI_NOTIFICATIONS;
      else process.env.PI_NOTIFICATIONS = previousNotifications;
    };
    const transport = new OmarchyAttentionTransport({
      direct,
      notification,
      onFailure: handleDeliveryFailure,
      onFocusReplay: (result) => {
        pi.logger?.debug?.(`Aperture focus replay ${result}`);
      },
    });
    const transportAvailable = await transport.isAvailable();
    suppressionActive = suppressBuiltInNotifications && transportAvailable;
    if (suppressionActive) process.env.PI_NOTIFICATIONS = "off";

    bindOmpExtension(
      pi,
      {
        handle: async (event, context, capabilities) => {
          if (!deliveryActive) return;
          if (!focusHost && isFocusCandidateEvent(event)) {
            focusHost = FocusHost.create({
              transport: direct,
              ...focusHostOptions,
              ...(capabilities.terminalTitle ? { terminalTitle: capabilities.terminalTitle } : {}),
              onRegistered: (publicHandle, workerGeneration) => {
                transport.replayFocus(
                  workerGeneration,
                  [...focusReplayCache.values()].map((cached) =>
                    focusReplayEvent(cached, publicHandle),
                  ),
                );
              },
              onStatus: (status) => {
                pi.logger?.debug?.(`Aperture focus ${status}`);
              },
            });
          }
          focusHost?.prewarm();
          const focusHandle = focusHost?.focusHandle();
          const deliveryContext = {
            ...context,
            ...(focusHandle ? { focusHandle } : {}),
          };
          try {
            const directEvents = mapOmpDirectAttentionEvents(event, deliveryContext);
            updateFocusReplayCache(focusReplayCache, directEvents);
            await transport.handleMapped(event, deliveryContext, directEvents);
          } catch {
            await transport.handle(event, deliveryContext);
          }
        },
        close: async () => {
          try {
            await focusHost?.close();
            await transport.close();
            focusReplayCache.clear();
          } finally {
            restoreBuiltInNotifications();
          }
        },
      },
      mappingContext,
    );
  };
}

function isFocusCandidateEvent(event: OmpEvent): boolean {
  return (
    event.type === "tool_approval_requested" ||
    ((event.type === "tool_call" || event.type === "tool_execution_start") &&
      event.toolName === "ask")
  );
}

const MAXIMUM_FOCUS_REPLAY_EVENTS = 64;
function focusReplayEvent(event: OmpAttentionEvent, publicHandle: string): OmpAttentionEvent {
  const replayIdentity = createHash("sha256")
    .update(event.eventId)
    .update("\u0000focus")
    .digest("hex");
  return {
    ...event,
    eventId: `omp-focus:${replayIdentity}`,
    focus: { kind: "opaque-focus", handle: publicHandle },
  };
}

function updateFocusReplayCache(
  cache: Map<string, OmpAttentionEvent>,
  events: OmpAttentionEvent[],
): void {
  for (const event of events) {
    if (event.classification === "session_shutdown") {
      const prefix = `${event.sessionId}\u0000`;
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
      continue;
    }
    if (!event.interactionId) continue;
    const key = `${event.sessionId}\u0000${event.interactionId}`;
    if (event.classification === "approval_resolved" || event.classification === "input_resolved") {
      cache.delete(key);
      continue;
    }
    if (
      event.classification !== "approval_requested" &&
      event.classification !== "input_requested"
    ) {
      continue;
    }
    const { focus: _focus, ...withoutFocus } = event;
    if (!cache.has(key) && cache.size >= MAXIMUM_FOCUS_REPLAY_EVENTS) {
      const oldest = cache.keys().next().value;
      if (typeof oldest === "string") cache.delete(oldest);
    }
    cache.set(key, withoutFocus);
  }
}

export default createApertureOmarchyOmpExtension();
