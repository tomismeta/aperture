export type SignalCounts = {
  presented: number;
  responded: number;
  dismissed: number;
  deferred: number;
  contextExpanded: number;
  returned: number;
  attentionShifted: number;
};

export type DeferredCounts = {
  queued: number;
  suppressed: number;
  manual: number;
};

export type SignalSummary = {
  recentSignals: number;
  lifetimeSignals: number;
  counts: SignalCounts;
  deferred: DeferredCounts;
  responseRate: number;
  dismissalRate: number;
  averageResponseLatencyMs: number | null;
  averageDismissalLatencyMs: number | null;
  lastSignalAt: string | null;
};
