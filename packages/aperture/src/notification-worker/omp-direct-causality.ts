import { directKey, type MappedOmpDirectEvent } from "./omp-direct-adapter.js";
import type { NotificationWorkerNavigation } from "./protocol.js";
import type {
  OmpDirectPersistedState,
  PersistedOmpDirectEntry,
  PersistedOmpDirectTombstone,
} from "./omp-direct-state-store.js";

export class OmpDirectCausalityIndex {
  private readonly interactions = new Map<
    string,
    Extract<PersistedOmpDirectTombstone, { kind: "interaction" }>
  >();
  private readonly sessions = new Map<
    string,
    Extract<PersistedOmpDirectTombstone, { kind: "session" }>
  >();

  rebuild(tombstones: readonly PersistedOmpDirectTombstone[]): void {
    this.interactions.clear();
    this.sessions.clear();
    for (const tombstone of tombstones) {
      if (tombstone.kind === "interaction") this.interactions.set(tombstone.key, tombstone);
      else this.sessions.set(tombstone.sessionId, tombstone);
    }
  }

  interaction(
    key: string,
  ): Extract<PersistedOmpDirectTombstone, { kind: "interaction" }> | undefined {
    return this.interactions.get(key);
  }

  family(
    sessionId: string,
    family: string,
  ): Extract<PersistedOmpDirectTombstone, { kind: "interaction" }> | undefined {
    return this.interactions.get(directKey(sessionId, family, ""));
  }

  session(
    sessionId: string,
  ): Extract<PersistedOmpDirectTombstone, { kind: "session" }> | undefined {
    return this.sessions.get(sessionId);
  }

  remember(state: OmpDirectPersistedState, tombstone: PersistedOmpDirectTombstone): void {
    const identity = tombstoneIdentity(tombstone);
    const index = state.tombstones.findIndex(
      (candidate) => tombstoneIdentity(candidate) === identity,
    );
    if (index === -1) state.tombstones.push(tombstone);
    else state.tombstones[index] = tombstone;
    if (tombstone.kind === "interaction") this.interactions.set(tombstone.key, tombstone);
    else this.sessions.set(tombstone.sessionId, tombstone);
  }
}

export function applyMappedOmpDirectEvent(
  candidate: OmpDirectPersistedState,
  causality: OmpDirectCausalityIndex,
  mapped: MappedOmpDirectEvent,
  previous: PersistedOmpDirectEntry | undefined,
  nextNavigation: Map<string, NotificationWorkerNavigation>,
  navigation: NotificationWorkerNavigation | undefined,
): "persist" | "navigation-only" | "ignored" {
  if (mapped.kind === "shutdown") {
    const shutdown = causality.session(mapped.sessionId);
    if (shutdown && shutdown.occurredAt >= mapped.occurredAt) return "ignored";
    candidate.active = candidate.active.filter((entry) => {
      const cancelled =
        entry.sessionId === mapped.sessionId &&
        latestOmpDirectRevision(entry).occurredAt <= mapped.occurredAt;
      if (cancelled) nextNavigation.delete(entry.taskId);
      return !cancelled;
    });
    causality.remember(candidate, {
      kind: "session",
      sessionId: mapped.sessionId,
      eventId: mapped.eventId,
      occurredAt: mapped.occurredAt,
    });
    return "persist";
  }

  if (mapped.kind === "resolve-family") {
    const resolution = causality.family(mapped.sessionId, mapped.family);
    if (resolution && resolution.occurredAt >= mapped.occurredAt) return "ignored";
    const resolvedEntries = candidate.active.filter(
      (entry) => entry.sessionId === mapped.sessionId && isOmpCompletionEntry(entry),
    );
    candidate.active = candidate.active.filter((entry) => {
      const cancelled =
        entry.sessionId === mapped.sessionId &&
        isOmpCompletionEntry(entry) &&
        latestOmpDirectRevision(entry).occurredAt <= mapped.occurredAt;
      if (cancelled) nextNavigation.delete(entry.taskId);
      return !cancelled;
    });
    for (const entry of resolvedEntries) {
      if (latestOmpDirectRevision(entry).occurredAt > mapped.occurredAt) continue;
      causality.remember(candidate, {
        kind: "interaction",
        key: entry.key,
        eventId: mapped.eventId,
        occurredAt: mapped.occurredAt,
      });
    }
    causality.remember(candidate, {
      kind: "interaction",
      key: directKey(mapped.sessionId, mapped.family, ""),
      eventId: mapped.eventId,
      occurredAt: mapped.occurredAt,
    });
    return "persist";
  }

  if (mapped.kind === "resolve") {
    const resolution = causality.interaction(mapped.key);
    if (resolution && !previous) return "ignored";
    const previousAt = previous ? latestOmpDirectRevision(previous).occurredAt : undefined;
    // Approval/input identities are terminal even when the producer clock moves backward.
    if (previous) {
      candidate.active = candidate.active.filter((entry) => entry.key !== previous.key);
      nextNavigation.delete(previous.taskId);
    }
    if (resolution) return "persist";
    causality.remember(candidate, {
      kind: "interaction",
      key: mapped.key,
      eventId: mapped.eventId,
      occurredAt: previousAt && previousAt > mapped.occurredAt ? previousAt : mapped.occurredAt,
    });
    return "persist";
  }

  const sessionShutdown = causality.session(mapped.sessionId);
  if (sessionShutdown && sessionShutdown.occurredAt >= mapped.occurredAt) return "ignored";
  const interactionResolution = causality.interaction(mapped.key);
  if (interactionResolution) return "ignored";
  const familyResolution = causality.family(mapped.sessionId, mapped.family);
  if (familyResolution && familyResolution.occurredAt >= mapped.occurredAt) {
    return "ignored";
  }
  const previousRevision = previous ? latestOmpDirectRevision(previous) : undefined;
  if (
    previousRevision &&
    previousRevision.displayTitle === mapped.displayTitle &&
    JSON.stringify(previousRevision.sourceEvent) === JSON.stringify(mapped.sourceEvent)
  ) {
    return "navigation-only";
  }
  if (previousRevision && previousRevision.occurredAt > mapped.occurredAt) return "ignored";

  if (mapped.family === "completion") {
    const newer = candidate.active.find(
      (entry) =>
        entry.sessionId === mapped.sessionId &&
        entry.key !== mapped.key &&
        isOmpCompletionEntry(entry) &&
        latestOmpDirectRevision(entry).occurredAt > mapped.occurredAt,
    );
    if (newer) return "ignored";
    const superseded = candidate.active.filter(
      (entry) =>
        entry.sessionId === mapped.sessionId &&
        entry.key !== mapped.key &&
        isOmpCompletionEntry(entry),
    );
    for (const entry of superseded) {
      nextNavigation.delete(entry.taskId);
      causality.remember(candidate, {
        kind: "interaction",
        key: entry.key,
        eventId: mapped.sourceEvent.id,
        occurredAt: mapped.occurredAt,
      });
    }
    if (superseded.length > 0) {
      const supersededKeys = new Set(superseded.map((entry) => entry.key));
      candidate.active = candidate.active.filter((entry) => !supersededKeys.has(entry.key));
    }
  }

  const active = persistedOmpDirectEntry(mapped, previous);
  const index = candidate.active.findIndex((entry) => entry.key === mapped.key);
  if (index === -1) candidate.active.push(active);
  else candidate.active[index] = active;
  if (navigation) nextNavigation.set(mapped.taskId, navigation);
  else nextNavigation.delete(mapped.taskId);
  return "persist";
}

export function isOmpCompletionEntry(entry: PersistedOmpDirectEntry): boolean {
  const direct = latestOmpDirectRevision(entry).sourceEvent.metadata?.ompDirect;
  return (
    typeof direct === "object" &&
    direct !== null &&
    "classification" in direct &&
    direct.classification === "turn_completed"
  );
}

export function persistedOmpDirectEntry(
  mapped: Extract<MappedOmpDirectEvent, { kind: "upsert" }>,
  previous: PersistedOmpDirectEntry | undefined,
): PersistedOmpDirectEntry {
  return {
    key: mapped.key,
    taskId: mapped.taskId,
    interactionId: mapped.interactionId,
    sessionId: mapped.sessionId,
    revisions: [
      ...(previous?.revisions ?? []),
      {
        occurredAt: mapped.occurredAt,
        displayTitle: mapped.displayTitle,
        presentation: mapped.presentation,
        sourceEvent: mapped.sourceEvent,
      },
    ],
  };
}

export function latestOmpDirectRevision(active: PersistedOmpDirectEntry) {
  const revision = active.revisions.at(-1);
  if (!revision) throw new Error("OMP direct active state has no revision");
  return revision;
}

function tombstoneIdentity(tombstone: PersistedOmpDirectTombstone): string {
  return tombstone.kind === "interaction"
    ? `interaction\u0000${tombstone.key}`
    : `session\u0000${tombstone.sessionId}`;
}
