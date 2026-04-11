import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { enrichApertureEvent, normalizeSourceEvent } from "./semantic-normalizer.js";

export type PublishOptions = {
  applySemanticDefaults?: boolean;
};

export type PreparedPublishedEvent = {
  originalEvent: SourceEvent | ApertureEvent;
  finalizedEvent: ApertureEvent;
  transitionKind: "source_normalized" | "direct_enriched" | "direct_passthrough";
};

export function preparePublishedSourceEvent(event: SourceEvent): PreparedPublishedEvent {
  return {
    originalEvent: event,
    finalizedEvent: normalizeSourceEvent(event),
    transitionKind: "source_normalized",
  };
}

export function preparePublishedEvent(
  event: ApertureEvent,
  options: PublishOptions = {},
): PreparedPublishedEvent {
  const semanticDefaultsApplied = options.applySemanticDefaults !== false;

  return {
    originalEvent: event,
    finalizedEvent: semanticDefaultsApplied
      ? enrichApertureEvent(event)
      : enrichApertureEvent(event, { skipSemanticDefaults: true }),
    transitionKind: semanticDefaultsApplied ? "direct_enriched" : "direct_passthrough",
  };
}
