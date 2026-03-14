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

export type AttentionDeferredSignalCounts = {
  queued: number;
  suppressed: number;
  manual: number;
};

export type AttentionSignalSummary = {
  recentSignals: number;
  lifetimeSignals: number;
  counts: AttentionSignalCounts;
  deferred: AttentionDeferredSignalCounts;
  responseRate: number;
  dismissalRate: number;
  averageResponseLatencyMs: number | null;
  averageDismissalLatencyMs: number | null;
  lastSignalAt: string | null;
};
