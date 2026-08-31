import { bindOmpExtension } from "./bind.js";
import {
  OmarchyNotificationTransport,
  type OmarchyNotificationTransportOptions,
} from "./omarchy-notification-transport.js";
import type { OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmarchyOmpExtensionOptions = OmarchyNotificationTransportOptions & {
  mappingContext?: OmpMappingContext;
};

export function createApertureOmarchyOmpExtension(
  options: ApertureOmarchyOmpExtensionOptions = {},
) {
  return function apertureOmarchyOmpExtension(pi: OmpExtensionApi): void {
    const { mappingContext, ...transportOptions } = options;
    bindOmpExtension(pi, new OmarchyNotificationTransport(transportOptions), mappingContext);
  };
}

export default createApertureOmarchyOmpExtension();
