import test from "node:test";
import assert from "node:assert/strict";

import { deriveAttentionTrends } from "../src/attention-trends.js";
import type { SignalSummary } from "../src/signal-summary.js";

function createSummary(overrides: Partial<SignalSummary> = {}): SignalSummary {
  return {
    recentSignals: 0,
    lifetimeSignals: 0,
    counts: {
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
    },
    deferred: {
      queued: 0,
      suppressed: 0,
      manual: 0,
    },
    responseRate: 0,
    dismissalRate: 0,
    averageResponseLatencyMs: null,
    averageDismissalLatencyMs: null,
    lastSignalAt: null,
    ...overrides,
  };
}

test("derives context and defer-return trends from signal summaries", () => {
  const trends = deriveAttentionTrends(
    createSummary({
      counts: {
        presented: 4,
        viewed: 2,
        responded: 2,
        dismissed: 0,
        deferred: 3,
        contextExpanded: 1,
        contextSkipped: 0,
        timedOut: 0,
        returned: 1,
        attentionShifted: 0,
      },
    }),
  );

  assert.deepEqual(trends, ["context_before_action", "defer_then_return"]);
});

test("derives fragmented and stalling trends independently", () => {
  const trends = deriveAttentionTrends(
    createSummary({
      counts: {
        presented: 3,
        viewed: 2,
        responded: 0,
        dismissed: 0,
        deferred: 1,
        contextExpanded: 0,
        contextSkipped: 1,
        timedOut: 1,
        returned: 0,
        attentionShifted: 3,
      },
    }),
  );

  assert.deepEqual(trends, ["fragmented_attention", "stalling"]);
});
