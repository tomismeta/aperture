import type { ApertureCoreHealthSnapshot } from "./aperture-core.js";

export const APERTURE_INTERNAL_READ_HEALTH = Symbol("aperture.internal.readHealth");

export type InternalHealthEmitter = {
  [APERTURE_INTERNAL_READ_HEALTH](): ApertureCoreHealthSnapshot;
};

export function readInternalCoreHealthSnapshot(
  emitter: InternalHealthEmitter,
): ApertureCoreHealthSnapshot {
  return emitter[APERTURE_INTERNAL_READ_HEALTH]();
}
