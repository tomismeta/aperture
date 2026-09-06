import {
  OMP_ATTENTION_EVENT_SCHEMA_VERSION,
  type OmpAttentionEvent,
} from "../omp-attention-event.js";
import { isOmpCompletionEntry, latestOmpDirectRevision } from "./omp-direct-causality.js";
import type { PersistedOmpDirectEntry } from "./omp-direct-state-store.js";
import type { NotificationWorkerNavigation } from "./protocol.js";

export function ompCompletionResolutionEvent(
  active: readonly PersistedOmpDirectEntry[],
  navigationByTaskId: ReadonlyMap<string, NotificationWorkerNavigation>,
  handle: string,
  occurredAt: string,
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
  return {
    schemaVersion: OMP_ATTENTION_EVENT_SCHEMA_VERSION,
    type: "omp.attention-event",
    eventId: `${completion.key}:focused`,
    occurredAt: completedAt > occurredAt ? completedAt : occurredAt,
    sessionId: completion.sessionId,
    classification: "completion_resolved",
    title: "Result opened",
    summary: "Opened.",
    transition: "resolved",
  };
}
