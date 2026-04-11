import type { TraceFieldDiff } from "./trace-common.js";

export function diffTraceObjects(before: unknown, after: unknown): TraceFieldDiff[] {
  const diffs: TraceFieldDiff[] = [];
  collectDiffs("", before, after, diffs);
  return diffs;
}

function collectDiffs(
  path: string,
  before: unknown,
  after: unknown,
  diffs: TraceFieldDiff[],
): void {
  if (Object.is(before, after)) {
    return;
  }

  if ((before === undefined || before === null) && isPlainObject(after)) {
    for (const key of Object.keys(after).sort()) {
      const nextPath = path.length > 0 ? `${path}.${key}` : key;
      collectDiffs(nextPath, undefined, after[key], diffs);
    }
    return;
  }

  if ((after === undefined || after === null) && isPlainObject(before)) {
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
