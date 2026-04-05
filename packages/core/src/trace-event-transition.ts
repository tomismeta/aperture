import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import type {
  TraceEventFieldDiff,
  TraceEventTransition,
  TraceEventTransitionKind,
} from "./trace-common.js";

export function buildTraceEventTransition(
  kind: TraceEventTransitionKind,
  original: SourceEvent | ApertureEvent,
  finalized: ApertureEvent,
): TraceEventTransition {
  return {
    kind,
    original,
    finalized,
    changedFields: diffEventFields(original, finalized),
  };
}

function diffEventFields(
  before: SourceEvent | ApertureEvent,
  after: ApertureEvent,
): TraceEventFieldDiff[] {
  const diffs: TraceEventFieldDiff[] = [];
  collectDiffs("", before, after, diffs);
  return diffs;
}

function collectDiffs(path: string, before: unknown, after: unknown, diffs: TraceEventFieldDiff[]): void {
  if (Object.is(before, after)) {
    return;
  }

  if (before === undefined && isPlainObject(after)) {
    for (const key of Object.keys(after).sort()) {
      const nextPath = path.length > 0 ? `${path}.${key}` : key;
      collectDiffs(nextPath, undefined, after[key], diffs);
    }
    return;
  }

  if (after === undefined && isPlainObject(before)) {
    for (const key of Object.keys(before).sort()) {
      const nextPath = path.length > 0 ? `${path}.${key}` : key;
      collectDiffs(nextPath, before[key], undefined, diffs);
    }
    return;
  }

  if (before === undefined || after === undefined) {
    diffs.push({
      path,
      before,
      after,
    });
    return;
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    diffs.push({
      path,
      before,
      after,
    });
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const nextPath = path.length > 0 ? `${path}.${key}` : key;
      collectDiffs(nextPath, before[key], after[key], diffs);
    }
    return;
  }

  diffs.push({
    path,
    before,
    after,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
