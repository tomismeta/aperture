import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import type { TraceEventTransition, TraceEventTransitionKind } from "./trace-common.js";
import { diffTraceObjects } from "./trace-diff.js";

export function buildTraceEventTransition(
  kind: TraceEventTransitionKind,
  original: SourceEvent | ApertureEvent,
  finalized: ApertureEvent,
): TraceEventTransition {
  return {
    kind,
    original,
    finalized,
    changedFields: diffTraceObjects(original, finalized),
  };
}
