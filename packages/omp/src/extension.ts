import { bindOmpExtension } from "./bind.js";
import { OmpRuntimeTransport, type OmpRuntimeTransportOptions } from "./runtime-transport.js";
import type { OmpExtensionApi, OmpMappingContext } from "./types.js";

export type ApertureOmpExtensionOptions = OmpRuntimeTransportOptions & {
  mappingContext?: OmpMappingContext;
};

export function createApertureOmpExtension(options: ApertureOmpExtensionOptions = {}) {
  return function apertureOmpExtension(pi: OmpExtensionApi): void {
    const { mappingContext, ...transportOptions } = options;
    bindOmpExtension(pi, new OmpRuntimeTransport(transportOptions), mappingContext);
  };
}

export default createApertureOmpExtension();
