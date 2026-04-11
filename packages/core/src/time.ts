export type TimeSource = () => number;

export type CoreClock = {
  nowMs(): number;
  nowIso(): string;
  parse(timestamp: string): number | null;
  add(timestamp: string, durationMs: number): string | null;
  diff(laterTimestamp: string, earlierTimestamp: string): number | null;
};

export function createCoreClock(timeSource: TimeSource = Date.now): CoreClock {
  return {
    nowMs: () => timeSource(),
    nowIso: () => formatTimestamp(timeSource()),
    parse: parseTimestamp,
    add: addDurationToTimestamp,
    diff: diffTimestamps,
  };
}

export function parseTimestamp(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function addDurationToTimestamp(timestamp: string, durationMs: number): string | null {
  const parsed = parseTimestamp(timestamp);
  if (parsed === null) {
    return null;
  }
  return formatTimestamp(parsed + durationMs);
}

export function diffTimestamps(laterTimestamp: string, earlierTimestamp: string): number | null {
  const later = parseTimestamp(laterTimestamp);
  const earlier = parseTimestamp(earlierTimestamp);
  if (later === null || earlier === null) {
    return null;
  }
  return later - earlier;
}
