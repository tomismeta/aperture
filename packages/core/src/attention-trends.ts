import type { AttentionSignalSummary } from "./signal-summary.js";

export type AttentionTrend =
  | "context_before_action"
  | "defer_then_return"
  | "fragmented_attention"
  | "stalling";

export function deriveAttentionTrends(summary: AttentionSignalSummary): AttentionTrend[] {
  const trends: AttentionTrend[] = [];

  if (summary.counts.contextExpanded >= 1 && summary.counts.responded >= 1) {
    trends.push("context_before_action");
  }

  if (summary.counts.deferred >= 2 && summary.counts.returned >= 1) {
    trends.push("defer_then_return");
  }

  if (summary.counts.attentionShifted >= 3) {
    trends.push("fragmented_attention");
  }

  if (summary.counts.viewed >= 1 && summary.counts.timedOut >= 1 && summary.counts.responded === 0) {
    trends.push("stalling");
  }

  return trends;
}
