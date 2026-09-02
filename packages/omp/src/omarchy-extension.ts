import { bindOmpExtension } from "./bind.js";
import {
  OmpDirectWorkerTransport,
  type OmpDirectWorkerTransportOptions,
} from "./direct-worker-transport.js";
import { OmpFocusHost, type OmpFocusHostOptions } from "./omp-focus-host.js";
import { mapOmpDirectAttentionEvents } from "./direct-event-mapping.js";
import { OmarchyAttentionTransport } from "./omarchy-attention-transport.js";
import {
  OmarchyNotificationTransport,
  type OmarchyNotificationTransportOptions,
} from "./omarchy-notification-transport.js";
import type { OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmarchyOmpExtensionOptions = OmarchyNotificationTransportOptions & {
  mappingContext?: OmpMappingContext;
  suppressBuiltInNotifications?: boolean;
  directTransport?: OmpDirectWorkerTransport;
  directTransportOptions?: OmpDirectWorkerTransportOptions;
  focusHostOptions?: Omit<OmpFocusHostOptions, "direct">;
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
    let focusHost: OmpFocusHost | undefined;
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
    });
    const [transportAvailable, directAvailable] = await Promise.all([
      transport.isAvailable(),
      direct.isAvailable(),
    ]);
    suppressionActive = suppressBuiltInNotifications && transportAvailable;
    if (suppressionActive) process.env.PI_NOTIFICATIONS = "off";

    bindOmpExtension(
      pi,
      {
        handle: async (event, context) => {
          if (!deliveryActive) return;
          let navigable = false;
          try {
            navigable = mapOmpDirectAttentionEvents(event, context).length > 0;
          } catch {
            navigable = false;
          }
          if (focusHost?.shouldRecreate()) {
            await focusHost.close();
            focusHost = undefined;
          }
          if (focusHost && !focusHost.isActive() && navigable) {
            await focusHost.retryRegistration();
          }
          if (directAvailable && !focusHost && navigable) {
            focusHost = await OmpFocusHost.create({
              direct,
              ...focusHostOptions,
              ui: context.focusUi,
            });
          }
          const focusHandle = focusHost?.focusHandle();
          await transport.handle(event, {
            ...context,
            ...(focusHandle ? { focusHandle } : {}),
          });
        },
        close: async () => {
          try {
            await focusHost?.close();
            await transport.close();
          } finally {
            restoreBuiltInNotifications();
          }
        },
      },
      mappingContext,
    );
  };
}

export default createApertureOmarchyOmpExtension();
