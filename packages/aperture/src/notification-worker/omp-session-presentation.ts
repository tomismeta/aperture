import type { OmpAttentionEvent } from "../omp-attention-event.js";

export type ProjectedOmpSessionPresentation = {
  sourceLabel: string;
  context?: {
    items: Array<{ id: string; label: string; value: string }>;
  };
};

export function projectOmpSessionPresentation(
  event: OmpAttentionEvent,
): ProjectedOmpSessionPresentation {
  const context = event.session?.facets?.length
    ? {
        items: event.session.facets.map((facet) => ({
          id: `omp-session:${facet.id}`,
          label: facet.label,
          value: facet.value,
        })),
      }
    : undefined;
  return {
    sourceLabel: event.session?.label ? `OMP ${event.session.label}` : "OMP",
    ...(context ? { context } : {}),
  };
}
