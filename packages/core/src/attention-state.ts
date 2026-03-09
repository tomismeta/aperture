import type { SignalSummary } from "./signal-summary.js";

export type AttentionState = "engaged" | "hesitating" | "monitoring" | "avoiding" | "overloaded";

export function deriveAttentionState(summary: SignalSummary): AttentionState {
  const enoughPresentedForPattern = summary.counts.presented >= 5;
  const enoughObservedForPressure = summary.counts.presented + summary.counts.deferred >= 5;

  if (
    enoughObservedForPressure &&
    summary.counts.deferred >= 3 &&
    summary.deferred.queued + summary.deferred.suppressed >= 3
  ) {
    return "overloaded";
  }

  if (enoughPresentedForPattern && summary.dismissalRate >= 0.6 && summary.deferred.suppressed >= 2) {
    return "avoiding";
  }

  if (
    summary.counts.contextExpanded >= 1 &&
    summary.averageResponseLatencyMs !== null &&
    summary.averageResponseLatencyMs >= 15_000
  ) {
    return "hesitating";
  }

  if (
    enoughPresentedForPattern &&
    summary.responseRate >= 0.6 &&
    summary.averageResponseLatencyMs !== null &&
    summary.averageResponseLatencyMs <= 10_000
  ) {
    return "engaged";
  }

  return "monitoring";
}
