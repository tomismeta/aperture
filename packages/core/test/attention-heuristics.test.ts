import test from "node:test";
import assert from "node:assert/strict";

import { AttentionHeuristics } from "../src/attention-heuristics.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import type { SignalSummary } from "../src/signal-summary.js";

const heuristics = new AttentionHeuristics();

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:heuristics",
    interactionId: "interaction:heuristics",
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Background update",
    responseSpec: { kind: "none" },
    priority: "background",
    blocking: false,
    timestamp: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

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

test("suppresses status candidates that match repeated dismissal and suppression patterns", () => {
  const adjusted = heuristics.apply(
    createCandidate(),
    createSummary({
      counts: {
        presented: 8,
        viewed: 0,
        responded: 0,
        dismissed: 6,
        deferred: 3,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      dismissalRate: 0.75,
      deferred: {
        queued: 0,
        suppressed: 3,
        manual: 0,
      },
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, -35);
  assert.deepEqual(adjusted.attentionRationale, [
    "status updates for this task are often dismissed",
    "similar task updates have repeatedly remained ambient",
    "recent task activity suggests attention is already saturated",
  ]);
});

test("keeps critical status work visible despite quieting heuristics", () => {
  const adjusted = heuristics.apply(
    createCandidate({
      tone: "critical",
      consequence: "high",
    }),
    createSummary({
      counts: {
        presented: 8,
        viewed: 0,
        responded: 0,
        dismissed: 6,
        deferred: 2,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      dismissalRate: 0.75,
      deferred: {
        queued: 0,
        suppressed: 2,
        manual: 0,
      },
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, -5);
  assert.ok(adjusted.attentionRationale?.includes("high-consequence status should remain more visible"));
});

test("quiets low-value status work when recent behavior suggests overload", () => {
  const adjusted = heuristics.apply(
    createCandidate(),
    createSummary({
      counts: {
        presented: 2,
        viewed: 0,
        responded: 0,
        dismissed: 1,
        deferred: 3,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 1,
      },
      deferred: {
        queued: 2,
        suppressed: 1,
        manual: 0,
      },
      dismissalRate: 0.5,
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, -25);
  assert.ok(adjusted.attentionRationale?.includes("recent task activity suggests attention is already saturated"));
});

test("quiets low-value status work when overall operator activity is overloaded", () => {
  const adjusted = heuristics.apply(
    createCandidate(),
    createSummary({
      counts: {
        presented: 2,
        viewed: 0,
        responded: 1,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      responseRate: 0.5,
    }),
    createSummary({
      counts: {
        presented: 9,
        viewed: 0,
        responded: 1,
        dismissed: 2,
        deferred: 4,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 3,
      },
      deferred: {
        queued: 2,
        suppressed: 2,
        manual: 0,
      },
      responseRate: 0.11,
      dismissalRate: 0.22,
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, -10);
  assert.ok(adjusted.attentionRationale?.includes("overall operator activity suggests attention is already saturated"));
  assert.ok(adjusted.attentionRationale?.includes("recent attention has already shifted repeatedly across work"));
});

test("boosts blocking interactions when history shows context-seeking and quick response", () => {
  const adjusted = heuristics.apply(
    createCandidate({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: true,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
    createSummary({
      counts: {
        presented: 5,
        viewed: 0,
        responded: 4,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 2,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      responseRate: 0.75,
      averageResponseLatencyMs: 4000,
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, 15);
  assert.deepEqual(adjusted.attentionRationale, [
    "this task often requires deeper context before action",
    "similar blocking interactions usually receive quick responses",
  ]);
});

test("nudges blocking work upward when similar tasks show hesitation", () => {
  const adjusted = heuristics.apply(
    createCandidate({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: true,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
    createSummary({
      counts: {
        presented: 2,
        viewed: 0,
        responded: 2,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 1,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      responseRate: 1,
      averageResponseLatencyMs: 20_000,
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, 5);
  assert.deepEqual(adjusted.attentionRationale, [
    "similar blocking interactions appear to require more deliberation",
  ]);
});

test("quiets low-value status work when attention is fragmented across tasks", () => {
  const adjusted = heuristics.apply(
    createCandidate(),
    createSummary({
      counts: {
        presented: 1,
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
    }),
    createSummary({
      counts: {
        presented: 6,
        viewed: 3,
        responded: 2,
        dismissed: 1,
        deferred: 2,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 1,
        returned: 0,
        attentionShifted: 4,
      },
      responseRate: 2 / 6,
      dismissalRate: 1 / 6,
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, -5);
  assert.ok(adjusted.attentionRationale?.includes("recent attention has already shifted repeatedly across work"));
});

test("boosts blocking work when similar interactions are deferred and later resumed", () => {
  const adjusted = heuristics.apply(
    createCandidate({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "high",
      blocking: true,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
    createSummary({
      counts: {
        presented: 4,
        viewed: 2,
        responded: 2,
        dismissed: 0,
        deferred: 3,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 1,
        returned: 1,
        attentionShifted: 1,
      },
      responseRate: 0.5,
      deferred: {
        queued: 2,
        suppressed: 1,
        manual: 0,
      },
    }),
  );

  assert.equal(adjusted.attentionScoreOffset, 5);
  assert.ok(adjusted.attentionRationale?.includes("similar interactions are often deferred and resumed later"));
});
