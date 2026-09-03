import type { MappedOmpDirectEvent } from "./omp-direct-adapter.js";
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
