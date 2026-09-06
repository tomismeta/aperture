import { FocusHost, type FocusHostOptions } from "@tomismeta/aperture/focus-host";

import { bindOmpExtension } from "./bind.js";
import {
  OmpDirectWorkerTransport,
  type OmpDirectWorkerTransportOptions,
} from "./direct-worker-transport.js";
import { mapOmpDirectAttentionEvents, sessionIdForEvent } from "./direct-event-mapping.js";
import { OmarchyAttentionTransport } from "./omarchy-attention-transport.js";
import {
  OmarchyNotificationTransport,
  type OmarchyNotificationTransportOptions,
} from "./omarchy-notification-transport.js";
import {
  SessionHeartbeatSender,
  type SessionHeartbeatSenderOptions,
} from "./session-heartbeat-sender.js";
import type { OmpEvent, OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmarchyOmpExtensionOptions = OmarchyNotificationTransportOptions & {
  mappingContext?: OmpMappingContext;
  suppressBuiltInNotifications?: boolean;
  directTransport?: OmpDirectWorkerTransport;
  directTransportOptions?: OmpDirectWorkerTransportOptions;
  sessionHeartbeat?: SessionHeartbeatSenderOptions;
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
      sessionHeartbeat,
      ...notificationOptions
    } = options;
    const direct =
      configuredDirectTransport ?? new OmpDirectWorkerTransport(directTransportOptions);
    const notification = new OmarchyNotificationTransport(notificationOptions);
    const heartbeat = new SessionHeartbeatSender(direct, {
      ...sessionHeartbeat,
      onFailure: (error) => {
        pi.logger?.debug?.("Aperture OMP session heartbeat unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    let suppressionActive = false;
    let deliveryActive = true;
    let focusHost: FocusHost | undefined;
    let closing: Promise<void> | undefined;
    function closeAdapter(): Promise<void> {
      deliveryActive = false;
      return (closing ??= (async () => {
        try {
          // Stop both leases immediately; retain the transport for fresh title
          // ownership proof and revocation before closing delivery.
          await Promise.allSettled([heartbeat.close(), focusHost?.close()]);
          await transport.close();
        } finally {
          restoreBuiltInNotifications();
        }
      })());
    }
    function handleDeliveryFailure(error: unknown): void {
      pi.logger?.warn?.("Aperture OMP adapter delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!suppressionActive || !deliveryActive) return;
      deliveryActive = false;
      transport.disable();
      restoreBuiltInNotifications();
      void closeAdapter().catch((closeError) => {
        pi.logger?.debug?.("Aperture OMP adapter cleanup failed", {
          error: closeError instanceof Error ? closeError.message : String(closeError),
        });
      });
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
          const heartbeatSessionId = sessionIdForEvent(event, context);
          if (event.type !== "session_shutdown" && heartbeatSessionId) {
            heartbeat.observe(heartbeatSessionId);
          }
          if (!focusHost && isFocusCandidateEvent(event)) {
            focusHost = FocusHost.create({
              transport: direct,
              ...focusHostOptions,
              ...(capabilities.terminalTitle ? { terminalTitle: capabilities.terminalTitle } : {}),
              onRegistered: (publicHandle, workerGeneration, receiptEpisodeToken) => {
                transport.replayFocus(workerGeneration, publicHandle, receiptEpisodeToken);
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
            await transport.handleMapped(event, deliveryContext, directEvents);
          } catch {
            await transport.handle(event, deliveryContext);
          }
        },
        close: closeAdapter,
      },
      mappingContext,
    );
  };
}

function isFocusCandidateEvent(event: OmpEvent): boolean {
  return (
    event.type === "session_stop" ||
    event.type === "tool_approval_requested" ||
    (event.type === "tool_call" && event.toolName === "ask")
  );
}

export default createApertureOmarchyOmpExtension();
