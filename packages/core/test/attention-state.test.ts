import test from "node:test";
import assert from "node:assert/strict";

import { deriveAttentionState } from "../src/attention-state.js";
import type { SignalSummary } from "../src/signal-summary.js";

function createSummary(overrides: Partial<SignalSummary> = {}): SignalSummary {
  return {
    recentSignals: 0,
    lifetimeSignals: 0,
    counts: {
      presented: 0,
      responded: 0,
      dismissed: 0,
      deferred: 0,
      contextExpanded: 0,
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

test("overloaded requires enough observed activity", () => {
  const lowSample = createSummary({
    counts: {
      presented: 1,
      responded: 0,
      dismissed: 0,
      deferred: 3,
      contextExpanded: 0,
      returned: 0,
      attentionShifted: 0,
    },
    deferred: {
      queued: 2,
      suppressed: 1,
      manual: 0,
    },
  });

  assert.equal(deriveAttentionState(lowSample), "monitoring");
});

test("avoiding requires enough presented samples", () => {
  const lowSample = createSummary({
    counts: {
      presented: 3,
      responded: 0,
      dismissed: 2,
      deferred: 2,
      contextExpanded: 0,
      returned: 0,
      attentionShifted: 0,
    },
    deferred: {
      queued: 0,
      suppressed: 2,
      manual: 0,
    },
    dismissalRate: 2 / 3,
  });

  assert.equal(deriveAttentionState(lowSample), "monitoring");
});

test("engaged requires enough presented samples", () => {
  const lowSample = createSummary({
    counts: {
      presented: 4,
      responded: 4,
      dismissed: 0,
      deferred: 0,
      contextExpanded: 0,
      returned: 0,
      attentionShifted: 0,
    },
    responseRate: 1,
    averageResponseLatencyMs: 2000,
  });

  assert.equal(deriveAttentionState(lowSample), "monitoring");
});
