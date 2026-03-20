import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionView } from "@tomismeta/aperture-core";
import type { AttentionSignalSummary } from "../../core/src/signal-summary.js";

import { computePosture } from "../src/posture.js";

test("computePosture cools to calm after a stale burst with no visible interruptive work", () => {
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-03-15T12:03:00.000Z");

  try {
    const summary: AttentionSignalSummary = {
      recentSignals: 8,
      lifetimeSignals: 20,
      counts: {
        presented: 8,
        viewed: 0,
        responded: 1,
        dismissed: 0,
        deferred: 4,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 2,
        attentionShifted: 0,
      },
      deferred: {
        queued: 2,
        suppressed: 2,
        manual: 0,
      },
      responseRate: 0.2,
      dismissalRate: 0,
      averageResponseLatencyMs: 18_000,
      averageDismissalLatencyMs: null,
      lastSignalAt: "2026-03-15T12:00:00.000Z",
    };

    const view: AttentionView = {
      active: null,
      queued: [],
      ambient: [],
    };

    assert.equal(computePosture(summary, view), "calm");
  } finally {
    Date.now = realNow;
  }
});
