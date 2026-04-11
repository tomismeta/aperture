import type { AttentionSignal } from "./interaction-signal.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import { createCoreClock, type CoreClock } from "./time.js";

const RECENT_SIGNAL_LIMIT = 32;
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const MAX_RETAINED_SIGNALS = 256;

type AttentionSignalStoreOptions = {
  clock?: CoreClock;
};

export class AttentionSignalStore {
  private readonly byTaskId = new Map<string, AttentionSignal[]>();
  private readonly clock: CoreClock;

  constructor(options: AttentionSignalStoreOptions = {}) {
    this.clock = options.clock ?? createCoreClock();
  }

  record(signal: AttentionSignal): void {
    const current = this.byTaskId.get(signal.taskId) ?? [];
    const next = [...current, signal];
    this.byTaskId.set(
      signal.taskId,
      next.length > MAX_RETAINED_SIGNALS ? next.slice(-MAX_RETAINED_SIGNALS) : next,
    );
  }

  list(taskId?: string): AttentionSignal[] {
    if (taskId !== undefined) {
      return [...(this.byTaskId.get(taskId) ?? [])];
    }

    return [...this.byTaskId.values()]
      .flat()
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  summarize(taskId?: string): AttentionSignalSummary {
    return summarizeAttentionSignals(this.list(taskId), this.clock);
  }
}

export function summarizeAttentionSignals(
  signals: AttentionSignal[],
  clock: CoreClock = createCoreClock(),
): AttentionSignalSummary {
  const recentSignals = recentAttentionSignals(signals, clock);
  const counts = {
    presented: 0,
    viewed: 0,
    responded: 0,
    dismissed: 0,
    deferred: 0,
    contextExpanded: 0,
    contextSkipped: 0,
    timedOut: 0,
    returned: 0,
    attentionShifted: 0,
  };
  const deferred = {
    next: 0,
    suppressed: 0,
    manual: 0,
  };

  let responseLatencyTotal = 0;
  let responseLatencyCount = 0;
  let dismissalLatencyTotal = 0;
  let dismissalLatencyCount = 0;

  for (const signal of recentSignals) {
    switch (signal.kind) {
      case "presented":
        counts.presented += 1;
        break;
      case "viewed":
        counts.viewed += 1;
        break;
      case "responded":
        counts.responded += 1;
        if (signal.latencyMs !== undefined) {
          responseLatencyTotal += signal.latencyMs;
          responseLatencyCount += 1;
        }
        break;
      case "dismissed":
        counts.dismissed += 1;
        if (signal.latencyMs !== undefined) {
          dismissalLatencyTotal += signal.latencyMs;
          dismissalLatencyCount += 1;
        }
        break;
      case "deferred":
        counts.deferred += 1;
        if (signal.reason !== undefined) {
          deferred[signal.reason] += 1;
        }
        break;
      case "context_expanded":
        counts.contextExpanded += 1;
        break;
      case "context_skipped":
        counts.contextSkipped += 1;
        break;
      case "timed_out":
        counts.timedOut += 1;
        break;
      case "returned":
        counts.returned += 1;
        break;
      case "attention_shifted":
        counts.attentionShifted += 1;
        break;
    }
  }

  return {
    recentSignals: recentSignals.length,
    lifetimeSignals: signals.length,
    counts,
    deferred,
    responseRate: counts.presented > 0 ? counts.responded / counts.presented : 0,
    dismissalRate: counts.presented > 0 ? counts.dismissed / counts.presented : 0,
    averageResponseLatencyMs:
      responseLatencyCount > 0 ? Math.round(responseLatencyTotal / responseLatencyCount) : null,
    averageDismissalLatencyMs:
      dismissalLatencyCount > 0 ? Math.round(dismissalLatencyTotal / dismissalLatencyCount) : null,
    lastSignalAt: signals.length > 0 ? (signals[signals.length - 1]?.timestamp ?? null) : null,
  };
}

function recentAttentionSignals(signals: AttentionSignal[], clock: CoreClock): AttentionSignal[] {
  const bounded = signals.slice(-RECENT_SIGNAL_LIMIT);
  const latestTimestamp = bounded[bounded.length - 1]?.timestamp;

  if (latestTimestamp === undefined) {
    return bounded;
  }

  const latestMs = clock.parse(latestTimestamp);
  if (latestMs === null) {
    return bounded;
  }

  const recent = bounded.filter((signal) => {
    const signalMs = clock.parse(signal.timestamp);
    if (signalMs === null) {
      return true;
    }

    return latestMs - signalMs <= RECENT_WINDOW_MS;
  });

  return recent.length > 0 ? recent : bounded;
}
