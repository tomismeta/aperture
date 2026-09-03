import { type SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";

import { assertOmpAttentionDisplayText, assertOmpSessionId } from "../omp-attention-event.js";
import type {
  OmpDirectPersistedState,
  PersistedOmpDirectEntry,
  PersistedOmpDirectRevision,
} from "./omp-direct-state-store.js";

export function migrateOmpDirectStateV1(value: unknown): OmpDirectPersistedState {
  const state = asRecord(value, "OMP direct state");
  assertExactKeys(state, ["schemaVersion", "active"], "OMP direct state");
  if (state.schemaVersion !== 1 || !Array.isArray(state.active)) {
    throw new Error("OMP direct v1 state schema is unsupported");
  }
  const active = state.active.map((rawEntry) => {
    const entry = asRecord(rawEntry, "OMP direct v1 active entry");
    assertExactKeys(
      entry,
      ["key", "taskId", "interactionId", "navigation", "revisions"],
      "OMP direct v1 active entry",
    );
    const navigation = asRecord(entry.navigation, "OMP direct v1 navigation");
    assertExactKeys(navigation, ["kind", "sessionId"], "OMP direct v1 navigation");
    if (navigation.kind !== "omp-session") {
      throw new Error("OMP direct v1 navigation kind is invalid");
    }
    const migrated: PersistedOmpDirectEntry = {
      key: storedText(entry.key, 160, "OMP direct key"),
      taskId: storedText(entry.taskId, 160, "OMP direct taskId"),
      interactionId: storedText(entry.interactionId, 160, "OMP direct interactionId"),
      sessionId: assertOmpSessionId(navigation.sessionId),
      revisions: Array.isArray(entry.revisions)
        ? (entry.revisions as PersistedOmpDirectRevision[])
        : [],
    };
    assertOmpDirectEntry(migrated);
    return migrated;
  });
  return { schemaVersion: 3, active, tombstones: [] };
}

export function migrateOmpDirectStateV2(value: unknown): OmpDirectPersistedState {
  const state = asRecord(value, "OMP direct state");
  assertExactKeys(state, ["schemaVersion", "active"], "OMP direct state");
  if (state.schemaVersion !== 2 || !Array.isArray(state.active)) {
    throw new Error("OMP direct v2 state schema is unsupported");
  }
  for (const entry of state.active) assertOmpDirectEntry(entry);
  return {
    schemaVersion: 3,
    active: state.active as PersistedOmpDirectEntry[],
    tombstones: [],
  };
}

export function decodeOmpDirectState(value: unknown): {
  state: OmpDirectPersistedState;
  migrated: boolean;
} {
  const record = asRecord(value, "OMP direct state");
  if (record.schemaVersion === 1) {
    return { state: migrateOmpDirectStateV1(value), migrated: true };
  }
  if (record.schemaVersion === 2) {
    return { state: migrateOmpDirectStateV2(value), migrated: true };
  }
  return { state: assertOmpDirectState(value), migrated: false };
}

export function assertOmpDirectState(value: unknown): OmpDirectPersistedState {
  const state = asRecord(value, "OMP direct state");
  assertExactKeys(state, ["schemaVersion", "active", "tombstones"], "OMP direct state");
  if (
    state.schemaVersion !== 3 ||
    !Array.isArray(state.active) ||
    !Array.isArray(state.tombstones)
  ) {
    throw new Error("OMP direct state schema is unsupported");
  }
  for (const entry of state.active) assertOmpDirectEntry(entry);
  for (const tombstone of state.tombstones) assertOmpDirectTombstone(tombstone);
  return value as OmpDirectPersistedState;
}

function assertOmpDirectEntry(value: unknown): void {
  const entry = asRecord(value, "OMP direct active entry");
  assertExactKeys(
    entry,
    ["key", "taskId", "interactionId", "sessionId", "revisions"],
    "OMP direct active entry",
  );
  storedText(entry.key, 160, "OMP direct key");
  const taskId = storedText(entry.taskId, 160, "OMP direct taskId");
  const interactionId = storedText(entry.interactionId, 160, "OMP direct interactionId");
  const sessionId = assertOmpSessionId(entry.sessionId);
  if (!Array.isArray(entry.revisions) || entry.revisions.length === 0) {
    throw new Error("OMP direct revisions are invalid");
  }
  let previousTimestamp = "";
  for (const revision of entry.revisions) {
    const timestamp = assertOmpDirectRevision(revision, taskId, interactionId, sessionId);
    if (previousTimestamp && timestamp < previousTimestamp) {
      throw new Error("OMP direct revisions are out of order");
    }
    previousTimestamp = timestamp;
  }
}

function assertOmpDirectTombstone(value: unknown): void {
  const tombstone = asRecord(value, "OMP direct tombstone");
  if (tombstone.kind === "interaction") {
    assertExactKeys(
      tombstone,
      ["kind", "key", "eventId", "occurredAt"],
      "OMP direct interaction tombstone",
    );
    storedText(tombstone.key, 160, "OMP direct tombstone key");
  } else if (tombstone.kind === "session") {
    assertExactKeys(
      tombstone,
      ["kind", "sessionId", "eventId", "occurredAt"],
      "OMP direct session tombstone",
    );
    assertOmpSessionId(tombstone.sessionId);
  } else {
    throw new Error("OMP direct tombstone kind is invalid");
  }
  storedText(tombstone.eventId, 160, "OMP direct tombstone eventId");
  storedTimestamp(tombstone.occurredAt, "OMP direct tombstone occurrence");
}

function assertOmpDirectRevision(
  value: unknown,
  taskId: string,
  interactionId: string,
  sessionId: string,
): string {
  const revision = asRecord(value, "OMP direct revision");
  assertExactKeys(revision, ["occurredAt", "displayTitle", "sourceEvent"], "OMP direct revision");
  const occurredAt = storedTimestamp(revision.occurredAt, "OMP direct occurrence");
  assertOmpAttentionDisplayText(revision.displayTitle, 160, "persisted display title");
  const sourceEventRecord = asRecord(revision.sourceEvent, "OMP direct source event");
  assertDirectSourceEventFields(sourceEventRecord);
  const sourceEvent = revision.sourceEvent as SourceEvent;
  assertValidSourceEvent(sourceEvent);
  if (sourceEvent.taskId !== taskId || sourceEvent.timestamp !== occurredAt) {
    throw new Error("OMP direct source event identity is invalid");
  }
  if (sourceEvent.type === "human.input.requested" && sourceEvent.interactionId !== interactionId) {
    throw new Error("OMP direct interaction identity is invalid");
  }
  const source = asRecord(sourceEvent.source, "OMP direct source");
  assertExactKeys(source, ["id", "kind", "label"], "OMP direct source");
  if (source.kind !== "omp" || source.label !== "OMP") {
    throw new Error("OMP direct source is invalid");
  }
  const metadata = asRecord(sourceEvent.metadata, "OMP direct metadata");
  assertExactKeys(metadata, ["ompDirect"], "OMP direct metadata");
  const direct = asRecord(metadata.ompDirect, "OMP direct metadata facts");
  assertExactKeys(direct, ["classification", "sessionId"], "OMP direct metadata facts");
  if (direct.sessionId !== sessionId || typeof direct.classification !== "string") {
    throw new Error("OMP direct metadata identity is invalid");
  }
  if ("title" in sourceEvent) {
    assertOmpAttentionDisplayText(sourceEvent.title, 160, "persisted event title");
  }
  if ("summary" in sourceEvent && sourceEvent.summary !== undefined) {
    assertOmpAttentionDisplayText(sourceEvent.summary, 320, "persisted event summary");
  }
  return occurredAt;
}

function assertDirectSourceEventFields(event: Record<string, unknown>): void {
  switch (event.type) {
    case "human.input.requested":
      assertExactKeys(
        event,
        [
          "id",
          "taskId",
          "timestamp",
          "source",
          "metadata",
          "type",
          "interactionId",
          "activityClass",
          "title",
          "summary",
          "request",
          "riskHint",
        ],
        "OMP direct human input event",
      );
      return;
    case "task.updated":
      assertExactKeys(
        event,
        [
          "id",
          "taskId",
          "timestamp",
          "source",
          "metadata",
          "type",
          "title",
          "summary",
          "status",
          "activityClass",
          "semanticHints",
        ],
        "OMP direct task update",
      );
      return;
    case "task.completed":
      assertExactKeys(
        event,
        ["id", "taskId", "timestamp", "source", "metadata", "type", "summary"],
        "OMP direct task completion",
      );
      return;
    default:
      throw new Error("OMP direct source event type is invalid");
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are invalid`);
  }
}

function storedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  if (Array.from(value).length > maximum) throw new Error(`${label} exceeded its limit`);
  return value;
}

function storedTimestamp(value: unknown, label: string): string {
  const timestamp = storedText(value, 64, label);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${label} is invalid`);
  return timestamp;
}
