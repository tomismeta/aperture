import test from "node:test";
import assert from "node:assert/strict";

import { deriveAttentionBurden } from "../src/attention-burden.js";

test("deriveAttentionBurden raises threshold offset under sustained decision load", () => {
  const burden = deriveAttentionBurden(
    {
      recentSignals: 8,
      lifetimeSignals: 20,
      counts: {
        presented: 8,
        viewed: 0,
        responded: 2,
        dismissed: 1,
        deferred: 3,
        contextExpanded: 1,
        contextSkipped: 1,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      deferred: {
        queued: 2,
        suppressed: 1,
        manual: 0,
      },
      responseRate: 0.25,
      dismissalRate: 0.125,
      averageResponseLatencyMs: 16_000,
      averageDismissalLatencyMs: null,
      lastSignalAt: "2026-03-12T10:15:00.000Z",
    },
    {
      level: "high",
      overloadRisk: "high",
      score: 6,
      metrics: {
        recentDemand: 8,
        interruptiveVisible: 2,
        averageResponseLatencyMs: 16_000,
        deferredCount: 3,
        suppressedCount: 1,
      },
      reasons: ["recent deferrals suggest operator capacity is tightening"],
    },
    "overloaded",
    "present",
  );

  assert.equal(burden.level, "high");
  assert.equal(burden.thresholdOffset, 12);
  assert.ok(burden.reasons.includes("current pressure is already high"));
  assert.ok(burden.reasons.includes("recent operator behavior indicates overload"));
});

test("deriveAttentionBurden resets to light while the operator is absent", () => {
  const burden = deriveAttentionBurden(
    {
      recentSignals: 5,
      lifetimeSignals: 10,
      counts: {
        presented: 5,
        viewed: 0,
        responded: 1,
        dismissed: 1,
        deferred: 2,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      deferred: {
        queued: 2,
        suppressed: 0,
        manual: 0,
      },
      responseRate: 0.2,
      dismissalRate: 0.2,
      averageResponseLatencyMs: 12_000,
      averageDismissalLatencyMs: null,
      lastSignalAt: "2026-03-12T10:15:00.000Z",
    },
    {
      level: "elevated",
      overloadRisk: "rising",
      score: 3,
      metrics: {
        recentDemand: 5,
        interruptiveVisible: 1,
        averageResponseLatencyMs: 12_000,
        deferredCount: 2,
        suppressedCount: 0,
      },
      reasons: ["incoming demand is climbing"],
    },
    "hesitating",
    "absent",
  );

  assert.equal(burden.level, "light");
  assert.equal(burden.thresholdOffset, 0);
  assert.deepEqual(burden.reasons, []);
});
