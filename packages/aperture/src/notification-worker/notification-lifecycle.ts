import type { AttentionSignal } from "@tomismeta/aperture-core";

import type { MappedNotificationEvent } from "./adapter.js";
import type { NotificationClosedInput } from "./protocol.js";
import type { PersistedActiveNotification, PersistedNotificationRevision } from "./state-store.js";

export function persistedActive(
  mapped: MappedNotificationEvent,
  previous: PersistedActiveNotification | undefined,
): PersistedActiveNotification {
  const revision: PersistedNotificationRevision = {
    occurredAt: mapped.occurredAt,
    displayTitle: mapped.displayTitle,
    sourceEvent: mapped.sourceEvent,
  };
  return {
    key: mapped.key,
    taskId: mapped.taskId,
    interactionId: mapped.interactionId,
    revisions: [...(previous?.revisions ?? []), revision],
  };
}

export function latestRevision(active: PersistedActiveNotification): PersistedNotificationRevision {
  const revision = active.revisions.at(-1);
  if (!revision) throw new Error("notification worker active state has no revision");
  return revision;
}

export function feedbackSignal(
  active: PersistedActiveNotification,
  input: NotificationClosedInput,
): AttentionSignal | null {
  const base = {
    taskId: active.taskId,
    interactionId: active.interactionId,
    timestamp: input.occurredAt,
    surface: "omarchy-notifications",
  };
  switch (input.reason) {
    case "expired":
      return { ...base, kind: "timed_out" };
    case "dismissed":
      return { ...base, kind: "dismissed" };
    case "actioned":
      return { ...base, kind: "responded", responseKind: "acknowledged" };
    case "closed":
    case "unknown":
      return null;
  }
}
