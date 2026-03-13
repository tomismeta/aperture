export type AttentionSignalCounts = {
  presented: number;
  viewed: number;
  responded: number;
  dismissed: number;
  deferred: number;
  contextExpanded: number;
  contextSkipped: number;
  timedOut: number;
  returned: number;
  attentionShifted: number;
};
export type SignalCounts = AttentionSignalCounts;

export type DeferredSignalCounts = {
  queued: number;
  suppressed: number;
  manual: number;
};
export type DeferredCounts = DeferredSignalCounts;

export type AttentionSignalSummary = {
  recentSignals: number;
  lifetimeSignals: number;
  counts: AttentionSignalCounts;
  deferred: DeferredSignalCounts;
  responseRate: number;
  dismissalRate: number;
  averageResponseLatencyMs: number | null;
  averageDismissalLatencyMs: number | null;
  lastSignalAt: string | null;
};
export type SignalSummary = AttentionSignalSummary;
