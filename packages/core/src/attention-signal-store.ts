import type { InteractionSignal } from "./index.js";

import type { SignalSummary } from "./signal-summary.js";

export class AttentionSignalStore {
  private static readonly RECENT_SIGNAL_LIMIT = 32;
  private static readonly RECENT_WINDOW_MS = 30 * 60 * 1000;
  private static readonly MAX_RETAINED_SIGNALS = 256;

  private readonly byTaskId = new Map<string, InteractionSignal[]>();

  record(signal: InteractionSignal): void {
    const current = this.byTaskId.get(signal.taskId) ?? [];
    const next = [...current, signal];
    this.byTaskId.set(
      signal.taskId,
      next.length > AttentionSignalStore.MAX_RETAINED_SIGNALS
        ? next.slice(-AttentionSignalStore.MAX_RETAINED_SIGNALS)
        : next,
    );
  }

  list(taskId?: string): InteractionSignal[] {
    if (taskId !== undefined) {
      return [...(this.byTaskId.get(taskId) ?? [])];
    }

    return [...this.byTaskId.values()]
      .flat()
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  summarize(taskId?: string): SignalSummary {
    const signals = this.list(taskId);
    const recentSignals = this.recentSignals(signals);
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
      queued: 0,
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
      lastSignalAt: signals.length > 0 ? signals[signals.length - 1]?.timestamp ?? null : null,
    };
  }

  private recentSignals(signals: InteractionSignal[]): InteractionSignal[] {
    const bounded = signals.slice(-AttentionSignalStore.RECENT_SIGNAL_LIMIT);
    const latestTimestamp = bounded[bounded.length - 1]?.timestamp;

    if (latestTimestamp === undefined) {
      return bounded;
    }

    const latestMs = Date.parse(latestTimestamp);
    if (Number.isNaN(latestMs)) {
      return bounded;
    }

    const recent = bounded.filter((signal) => {
      const signalMs = Date.parse(signal.timestamp);
      if (Number.isNaN(signalMs)) {
        return true;
      }

      return latestMs - signalMs <= AttentionSignalStore.RECENT_WINDOW_MS;
    });

    return recent.length > 0 ? recent : bounded;
  }
}
