import test from "node:test";
import assert from "node:assert/strict";

import { forecastPressure } from "../src/pressure-forecast.js";
import type { AttentionView, Frame } from "../src/frame.js";
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
      ...(overrides.counts ?? {}),
    },
    deferred: {
      queued: 0,
      suppressed: 0,
      manual: 0,
      ...(overrides.deferred ?? {}),
    },
    responseRate: 0,
    dismissalRate: 0,
    averageResponseLatencyMs: null,
    averageDismissalLatencyMs: null,
    lastSignalAt: null,
    ...overrides,
  };
}

function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame:test",
    taskId: "task:test",
    interactionId: "interaction:test",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Review request",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    timing: {
      createdAt: "2026-03-08T12:00:00.000Z",
      updatedAt: "2026-03-08T12:00:00.000Z",
    },
    ...overrides,
  };
}

test("forecastPressure identifies rising overload before backlog spikes", () => {
  const forecast = forecastPressure(
    createSummary({
      counts: {
        presented: 4,
        viewed: 0,
        responded: 1,
        dismissed: 0,
        deferred: 2,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 1,
        attentionShifted: 0,
      },
      deferred: {
        queued: 1,
        suppressed: 1,
        manual: 0,
      },
      responseRate: 0.25,
      averageResponseLatencyMs: 9_000,
    }),
    {
      active: createFrame(),
      queued: [],
      ambient: [],
    } satisfies AttentionView,
  );

  assert.equal(forecast.overloadRisk, "rising");
  assert.equal(forecast.level, "high");
  assert.match(forecast.reasons.join(" "), /incoming demand is climbing/);
});

test("forecastPressure identifies high overload risk when demand and latency spike together", () => {
  const forecast = forecastPressure(
    createSummary({
      counts: {
        presented: 5,
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
      averageResponseLatencyMs: 18_000,
    }),
    {
      active: createFrame(),
      queued: [
        createFrame({
          id: "frame:queued",
          taskId: "task:queued",
          interactionId: "interaction:queued",
        }),
      ],
      ambient: [],
    } satisfies AttentionView,
  );

  assert.equal(forecast.overloadRisk, "high");
  assert.equal(forecast.metrics.interruptiveVisible, 2);
  assert.match(forecast.reasons.join(" "), /recent response latency is slow/);
});
