import { bindOmpExtension } from "./bind.js";
import {
  OmarchyNotificationTransport,
  type OmarchyNotificationTransportOptions,
} from "./omarchy-notification-transport.js";
import type { OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmarchyOmpExtensionOptions = OmarchyNotificationTransportOptions & {
  mappingContext?: OmpMappingContext;
  suppressBuiltInNotifications?: boolean;
};

export function createApertureOmarchyOmpExtension(
  options: ApertureOmarchyOmpExtensionOptions = {},
) {
  return async function apertureOmarchyOmpExtension(pi: OmpExtensionApi): Promise<void> {
    const { mappingContext, suppressBuiltInNotifications = true, ...transportOptions } = options;
    const transport = new OmarchyNotificationTransport(transportOptions);
    const suppressionActive = suppressBuiltInNotifications && (await transport.isAvailable());
    const previousNotifications = process.env.PI_NOTIFICATIONS;
    if (suppressionActive) process.env.PI_NOTIFICATIONS = "off";

    const restoreBuiltInNotifications = (): void => {
      if (!suppressionActive || process.env.PI_NOTIFICATIONS !== "off") return;
      if (previousNotifications === undefined) delete process.env.PI_NOTIFICATIONS;
      else process.env.PI_NOTIFICATIONS = previousNotifications;
    };
    let deliveryActive = true;

    bindOmpExtension(
      pi,
      suppressionActive
        ? {
            handle: async (event, context) => {
              if (!deliveryActive) return;
              try {
                await transport.handle(event, context);
              } catch (error) {
                deliveryActive = false;
                restoreBuiltInNotifications();
                throw error;
              }
            },
            close: async () => {
              try {
                await transport.close();
              } finally {
                restoreBuiltInNotifications();
              }
            },
          }
        : transport,
      mappingContext,
    );
  };
}

export default createApertureOmarchyOmpExtension();
