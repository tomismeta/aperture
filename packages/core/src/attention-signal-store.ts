import type { AttentionSignal } from "./interaction-signal.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import { createCoreClock, type CoreClock } from "./time.js";

const RECENT_SIGNAL_LIMIT = 32;
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const MAX_RETAINED_SIGNALS = 256;
const DEFAULT_SIGNAL_TASK_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_TRACKED_TASKS = 1_024;

export type AttentionSignalStoreStats = {
  taskCount: number;
  signalCount: number;
  oldestSignalAt: string | null;
  latestSignalAt: string | null;
  taskRetentionMs: number;
  maxTrackedTasks: number;
  prunedTasks: number;
};

type AttentionSignalStoreOptions = {
  clock?: CoreClock;
  taskRetentionMs?: number;
  maxTrackedTasks?: number;
};

export class AttentionSignalStore {
  private readonly byTaskId = new Map<string, AttentionSignal[]>();
  private readonly clock: CoreClock;
  private readonly taskRetentionMs: number;
  private readonly maxTrackedTasks: number;
  private latestObservedAtMs: number | null = null;
  private prunedTasks = 0;

  constructor(options: AttentionSignalStoreOptions = {}) {
    this.clock = options.clock ?? createCoreClock();
    this.taskRetentionMs = options.taskRetentionMs ?? DEFAULT_SIGNAL_TASK_RETENTION_MS;
    this.maxTrackedTasks = options.maxTrackedTasks ?? DEFAULT_MAX_TRACKED_TASKS;
  }

  record(signal: AttentionSignal): void {
    const current = this.byTaskId.get(signal.taskId) ?? [];
    const next = [...current, signal];
    this.byTaskId.set(
      signal.taskId,
      next.length > MAX_RETAINED_SIGNALS ? next.slice(-MAX_RETAINED_SIGNALS) : next,
    );
    const signalMs = this.clock.parse(signal.timestamp);
    if (
      signalMs !== null &&
      (this.latestObservedAtMs === null || signalMs > this.latestObservedAtMs)
    ) {
      this.latestObservedAtMs = signalMs;
    }
    this.prune();
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

  stats(): AttentionSignalStoreStats {
    let signalCount = 0;
    let oldestSignalAt: string | null = null;
    let latestSignalAt: string | null = null;

    for (const signals of this.byTaskId.values()) {
      signalCount += signals.length;
      const oldest = signals[0]?.timestamp ?? null;
      const latest = signals[signals.length - 1]?.timestamp ?? null;
      if (oldest && (oldestSignalAt === null || oldest < oldestSignalAt)) {
        oldestSignalAt = oldest;
      }
      if (latest && (latestSignalAt === null || latest > latestSignalAt)) {
        latestSignalAt = latest;
      }
    }

    return {
      taskCount: this.byTaskId.size,
      signalCount,
      oldestSignalAt,
      latestSignalAt,
      taskRetentionMs: this.taskRetentionMs,
      maxTrackedTasks: this.maxTrackedTasks,
      prunedTasks: this.prunedTasks,
    };
  }

  private prune(): void {
    if (this.latestObservedAtMs !== null) {
      for (const [taskId, signals] of this.byTaskId.entries()) {
        const latestSignal = signals[signals.length - 1];
        const latestSignalMs = latestSignal ? this.clock.parse(latestSignal.timestamp) : null;
        if (latestSignalMs === null) {
          continue;
        }
        if (this.latestObservedAtMs - latestSignalMs > this.taskRetentionMs) {
          this.byTaskId.delete(taskId);
          this.prunedTasks += 1;
        }
      }
    }

    if (this.byTaskId.size <= this.maxTrackedTasks) {
      return;
    }

    const overflow = this.byTaskId.size - this.maxTrackedTasks;
    const oldestTasks = [...this.byTaskId.entries()]
      .map(([taskId, signals]) => ({
        taskId,
        latestAt: signals[signals.length - 1]?.timestamp ?? "",
      }))
      .sort((left, right) => left.latestAt.localeCompare(right.latestAt))
      .slice(0, overflow);

    for (const task of oldestTasks) {
      this.byTaskId.delete(task.taskId);
      this.prunedTasks += 1;
    }
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
