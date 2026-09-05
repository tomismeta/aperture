import { type SourceEvent } from "@tomismeta/aperture-core";
import { assertValidSourceEvent } from "@tomismeta/aperture-core/internal";

import { assertOmpAttentionDisplayText, assertOmpSessionId } from "../omp-attention-event.js";
import type { OmpDirectPersistedState } from "./omp-direct-state-store.js";
import type { ProjectedOmpSessionPresentation } from "./omp-session-presentation.js";
export function assertOmpDirectState(value: unknown): OmpDirectPersistedState {
  const state = asRecord(value, "OMP direct state");
  assertExactKeys(state, ["active", "tombstones"], "OMP direct state");
  if (!Array.isArray(state.active) || !Array.isArray(state.tombstones)) {
    throw new Error("OMP direct state shape is unsupported");
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
  assertExactKeys(
    revision,
    ["occurredAt", "displayTitle", "presentation", "sourceEvent"],
    "OMP direct revision",
  );
  const occurredAt = storedTimestamp(revision.occurredAt, "OMP direct occurrence");
  assertOmpAttentionDisplayText(revision.displayTitle, 160, "persisted display title");
  assertOmpSessionPresentation(revision.presentation);
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
    default:
      throw new Error("OMP direct source event type is invalid");
  }
}

function assertOmpSessionPresentation(value: unknown): ProjectedOmpSessionPresentation {
  const presentation = asRecord(value, "OMP direct session presentation");
  const permitted =
    presentation.context === undefined ? ["sourceLabel"] : ["sourceLabel", "context"];
  assertExactKeys(presentation, permitted, "OMP direct session presentation");
  const sourceLabel = assertLegacySourceLabel(presentation.sourceLabel);
  return {
    sourceLabel,
    ...(presentation.context === undefined
      ? {}
      : { context: assertDirectSessionContext(presentation.context) }),
  };
}

function assertLegacySourceLabel(value: unknown): string {
  const label = assertOmpAttentionDisplayText(value, 120, "persisted source label");
  if (label !== "OMP" && (!label.startsWith("OMP ") || !label.slice(4).trim())) {
    throw new Error("OMP direct source presentation is invalid");
  }
  return label;
}

function assertDirectSessionContext(
  value: unknown,
): NonNullable<ProjectedOmpSessionPresentation["context"]> {
  const context = asRecord(value, "OMP direct session context");
  assertExactKeys(context, ["items"], "OMP direct session context");
  if (!Array.isArray(context.items) || context.items.length < 1 || context.items.length > 4) {
    throw new Error("OMP direct session context items are invalid");
  }
  const ids = new Set<string>();
  const items = context.items.map((rawItem) => {
    const item = asRecord(rawItem, "OMP direct session context item");
    assertExactKeys(item, ["id", "label", "value"], "OMP direct session context item");
    if (
      typeof item.id !== "string" ||
      !/^omp-session:[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(item.id) ||
      ids.has(item.id)
    ) {
      throw new Error("OMP direct session context item id is invalid");
    }
    ids.add(item.id);
    return {
      id: item.id,
      label: assertOmpAttentionDisplayText(item.label, 32, "persisted session facet label"),
      value: assertOmpAttentionDisplayText(item.value, 120, "persisted session facet value"),
    };
  });
  return { items };
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
