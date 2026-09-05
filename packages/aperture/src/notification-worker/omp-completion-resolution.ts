import {
  OMP_ATTENTION_EVENT_SCHEMA_VERSION,
  type OmpAttentionEvent,
} from "../omp-attention-event.js";
import { isOmpCompletionEntry, latestOmpDirectRevision } from "./omp-direct-causality.js";
import type { PersistedOmpDirectEntry } from "./omp-direct-state-store.js";
import type { NotificationWorkerNavigation } from "./protocol.js";

export type OmpCompletionResolution = "focused" | "focus-expired";

export function ompCompletionResolutionEvent(
  active: readonly PersistedOmpDirectEntry[],
  navigationByTaskId: ReadonlyMap<string, NotificationWorkerNavigation>,
  handle: string,
  occurredAt: string,
  resolution: OmpCompletionResolution,
): OmpAttentionEvent | undefined {
  const completion = active.find((entry) => {
    const navigation = navigationByTaskId.get(entry.taskId);
    return (
      isOmpCompletionEntry(entry) &&
      navigation?.kind === "opaque-focus" &&
      navigation.handle === handle
    );
  });
  if (!completion) return undefined;
  const completedAt = latestOmpDirectRevision(completion).occurredAt;
  const focused = resolution === "focused";
  return {
    schemaVersion: OMP_ATTENTION_EVENT_SCHEMA_VERSION,
    type: "omp.attention-event",
    eventId: `${completion.key}:${resolution}`,
    occurredAt: completedAt > occurredAt ? completedAt : occurredAt,
    sessionId: completion.sessionId,
    classification: "completion_resolved",
    title: focused ? "Result opened" : "Result expired",
    summary: focused ? "Opened." : "Session focus expired.",
    transition: "resolved",
  };
}
