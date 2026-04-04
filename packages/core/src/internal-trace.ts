import type { ApertureTrace } from "./trace-types.js";

export type InternalTraceListener = (trace: ApertureTrace) => void;

export const APERTURE_INTERNAL_TRACE_SUBSCRIBE = Symbol("aperture.internal.subscribeTrace");

export type InternalTraceEmitter = {
  [APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener: InternalTraceListener): () => void;
};

export function subscribeInternalTrace(
  emitter: InternalTraceEmitter,
  listener: InternalTraceListener,
): () => void {
  return emitter[APERTURE_INTERNAL_TRACE_SUBSCRIBE](listener);
}
