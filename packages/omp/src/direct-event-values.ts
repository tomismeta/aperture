import {
  assertOmpAttentionSession,
  type OmpAttentionEvent,
} from "@tomismeta/aperture/omp-attention-event";

import type { OmpMappingContext } from "./types.js";

export function safeOmpSessionPresentation(
  value: OmpMappingContext["session"],
): OmpAttentionEvent["session"] {
  if (!value) return undefined;
  const candidate = {
    ...(value.label === undefined ? {} : { label: value.label.trim() }),
    ...(value.facets === undefined
      ? {}
      : {
          facets: value.facets.map((facet) => ({
            id: facet.id.trim(),
            label: facet.label.trim(),
            value: facet.value.trim(),
          })),
        }),
  };
  try {
    return assertOmpAttentionSession(candidate);
  } catch {
    return undefined;
  }
}

export function readStopReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("stopReason" in value)) return undefined;
  return typeof value.stopReason === "string" ? value.stopReason : undefined;
}
