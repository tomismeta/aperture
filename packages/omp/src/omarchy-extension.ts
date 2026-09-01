import { bindOmpExtension } from "./bind.js";
import {
  OmpDirectWorkerTransport,
  type OmpDirectWorkerTransportOptions,
} from "./direct-worker-transport.js";
import { HerdrFocusHost, type HerdrFocusHostOptions } from "./herdr-focus.js";
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
  focusHostOptions?: Omit<HerdrFocusHostOptions, "direct">;
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
    let focusHost: HerdrFocusHost | undefined;
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
    if (directAvailable) {
      focusHost = await HerdrFocusHost.create({ direct, ...focusHostOptions });
    }
    if (suppressionActive) process.env.PI_NOTIFICATIONS = "off";

    bindOmpExtension(
      pi,
      {
        handle: (event, context) =>
          deliveryActive
            ? transport.handle(event, {
                ...context,
                ...(focusHost?.focusHandle()
                  ? { focusHandle: focusHost.focusHandle() }
                  : {}),
              })
            : Promise.resolve(),
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
