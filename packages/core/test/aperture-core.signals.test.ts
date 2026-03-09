import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionSignal } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";

test("submit records a responded interaction signal", () => {
  const core = new ApertureCore();
  const seen: InteractionSignal[] = [];

  core.onSignal((signal) => {
    seen.push(signal);
  });

  core.publish({
    id: "evt:approval",
    taskId: "task:signal",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve merge",
    summary: "A merge requires approval.",
    request: {
      kind: "approval",
    },
  });

  core.submit({
    taskId: "task:signal",
    interactionId: "interaction:approval",
    response: { kind: "approved" },
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.kind, "presented");
  assert.equal(seen[1]?.kind, "responded");
  if (seen[1]?.kind === "responded") {
    assert.equal(seen[1].responseKind, "approved");
  }
  assert.equal(core.getSignals("task:signal").length, 2);
});

test("publish emits a trace for candidate decisions", () => {
  const core = new ApertureCore();
  let seenKind: string | null = null;
  let seenDecision: string | null = null;

  core.onTrace((trace) => {
    seenKind = trace.evaluation.kind;
    if (trace.evaluation.kind === "candidate") {
      seenDecision = trace.coordination.kind;
    }
  });

  core.publish({
    id: "evt:trace",
    taskId: "task:trace",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:trace",
    title: "Approve traced command",
    summary: "A traced interaction is waiting.",
    request: {
      kind: "approval",
    },
  });

  assert.equal(seenKind, "candidate");
  assert.equal(seenDecision, "activate");
});

test("submit records dismissed signals distinctly", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval",
    taskId: "task:dismiss",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:dismiss",
    title: "Approve cleanup",
    summary: "Cleanup needs a response.",
    request: {
      kind: "approval",
    },
  });

  core.submit({
    taskId: "task:dismiss",
    interactionId: "interaction:dismiss",
    response: { kind: "dismissed" },
  });

  const signals = core.getSignals("task:dismiss");
  assert.equal(signals.length, 2);
  assert.equal(signals[0]?.kind, "presented");
  assert.equal(signals[1]?.kind, "dismissed");
});

test("recordSignal stores explicit operator behavior signals", () => {
  const core = new ApertureCore();

  core.recordSignal({
    kind: "presented",
    taskId: "task:presented",
    interactionId: "interaction:presented",
    timestamp: "2026-03-08T12:05:00.000Z",
    surface: "cli",
  });

  core.recordSignal({
    kind: "context_expanded",
    taskId: "task:presented",
    interactionId: "interaction:presented",
    timestamp: "2026-03-08T12:05:05.000Z",
    section: "provenance",
    surface: "cli",
  });

  const signals = core.getSignals("task:presented");
  assert.deepEqual(
    signals.map((signal) => signal.kind),
    ["presented", "context_expanded"],
  );
  assert.equal(core.getSignalSummary("task:presented").counts.contextExpanded, 1);
});

test("core records silent interaction signals through convenience methods", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:view",
    taskId: "task:view",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:view",
    title: "Approve rollout",
    summary: "A rollout is waiting for approval.",
    request: { kind: "approval" },
  });

  core.markViewed("task:view", "interaction:view", { surface: "lab" });
  core.markContextSkipped("task:view", "interaction:view", {
    surface: "lab",
    section: "provenance",
  });
  core.markTimedOut("task:view", "interaction:view", {
    surface: "lab",
    timeoutMs: 15_000,
  });

  const summary = core.getSignalSummary("task:view");
  assert.equal(summary.counts.viewed, 1);
  assert.equal(summary.counts.contextSkipped, 1);
  assert.equal(summary.counts.timedOut, 1);
});

test("queued and ambient decisions record deferred signals", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:queue",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve patch",
    summary: "A patch needs approval.",
    consequence: "high",
    request: {
      kind: "approval",
    },
  });

  core.publish({
    id: "evt:queued",
    taskId: "task:queue",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:queued",
    title: "Choose fallback",
    summary: "A fallback option is needed.",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  core.publish({
    id: "evt:ambient",
    taskId: "task:queue",
    timestamp: "2026-03-08T12:02:00.000Z",
    type: "task.updated",
    title: "Diagnostics ready",
    summary: "Supporting diagnostics are available.",
    status: "running",
    progress: 90,
  });

  const signals = core.getSignals("task:queue");
  assert.deepEqual(
    signals.map((signal) => signal.kind),
    ["presented", "deferred", "deferred"],
  );
  assert.equal(signals[1]?.kind, "deferred");
  if (signals[1]?.kind === "deferred") {
    assert.equal(signals[1].reason, "queued");
  }
  assert.equal(signals[2]?.kind, "deferred");
  if (signals[2]?.kind === "deferred") {
    assert.equal(signals[2].reason, "suppressed");
  }
});

test("signal summaries derive response and deferral metrics", () => {
  const core = new ApertureCore();

  core.recordSignal({
    kind: "presented",
    taskId: "task:summary",
    interactionId: "interaction:1",
    timestamp: "2026-03-08T12:00:00.000Z",
  });
  core.recordSignal({
    kind: "responded",
    taskId: "task:summary",
    interactionId: "interaction:1",
    timestamp: "2026-03-08T12:00:03.000Z",
    responseKind: "approved",
    latencyMs: 3000,
  });
  core.recordSignal({
    kind: "presented",
    taskId: "task:summary",
    interactionId: "interaction:2",
    timestamp: "2026-03-08T12:01:00.000Z",
  });
  core.recordSignal({
    kind: "dismissed",
    taskId: "task:summary",
    interactionId: "interaction:2",
    timestamp: "2026-03-08T12:01:04.000Z",
    latencyMs: 4000,
  });
  core.recordSignal({
    kind: "deferred",
    taskId: "task:summary",
    interactionId: "interaction:3",
    timestamp: "2026-03-08T12:02:00.000Z",
    reason: "queued",
  });

  const summary = core.getSignalSummary("task:summary");
  assert.equal(summary.recentSignals, 5);
  assert.equal(summary.lifetimeSignals, 5);
  assert.equal(summary.counts.presented, 2);
  assert.equal(summary.counts.viewed, 0);
  assert.equal(summary.counts.responded, 1);
  assert.equal(summary.counts.dismissed, 1);
  assert.equal(summary.counts.deferred, 1);
  assert.equal(summary.counts.returned, 0);
  assert.equal(summary.counts.attentionShifted, 0);
  assert.equal(summary.deferred.queued, 1);
  assert.equal(summary.responseRate, 0.5);
  assert.equal(summary.dismissalRate, 0.5);
  assert.equal(summary.averageResponseLatencyMs, 3000);
  assert.equal(summary.averageDismissalLatencyMs, 4000);
  assert.equal(summary.lastSignalAt, "2026-03-08T12:02:00.000Z");
});

test("signal summaries weight recent behavior over stale history", () => {
  const core = new ApertureCore();

  core.recordSignal({
    kind: "presented",
    taskId: "task:recent",
    interactionId: "interaction:old",
    timestamp: "2026-03-08T10:00:00.000Z",
  });
  core.recordSignal({
    kind: "responded",
    taskId: "task:recent",
    interactionId: "interaction:old",
    timestamp: "2026-03-08T10:01:00.000Z",
    responseKind: "approved",
    latencyMs: 60_000,
  });
  core.recordSignal({
    kind: "presented",
    taskId: "task:recent",
    interactionId: "interaction:new",
    timestamp: "2026-03-08T12:00:00.000Z",
  });
  core.recordSignal({
    kind: "responded",
    taskId: "task:recent",
    interactionId: "interaction:new",
    timestamp: "2026-03-08T12:00:01.000Z",
    responseKind: "approved",
    latencyMs: 1000,
  });

  const summary = core.getSignalSummary("task:recent");
  assert.equal(summary.recentSignals, 2);
  assert.equal(summary.lifetimeSignals, 4);
  assert.equal(summary.counts.presented, 1);
  assert.equal(summary.counts.responded, 1);
  assert.equal(summary.averageResponseLatencyMs, 1000);
});

test("publish rejects malformed events with a useful error", () => {
  const core = new ApertureCore();

  assert.throws(
    () =>
      core.publish({
        id: "evt:bad",
        taskId: "",
        timestamp: "not-a-date",
        type: "task.started",
        title: "Bad event",
      }),
    /event\.taskId must be a non-empty string|event\.timestamp must be a valid ISO timestamp/,
  );
});

test("submit rejects malformed responses with a useful error", () => {
  const core = new ApertureCore();

  assert.throws(
    () =>
      core.submit({
        taskId: "task:bad",
        interactionId: "interaction:bad",
        response: { kind: "option_selected", optionIds: [] },
      }),
    /response\.optionIds must contain at least one option id/,
  );
});

test("signal store retains a bounded history per task", () => {
  const core = new ApertureCore();

  for (let index = 0; index < 300; index += 1) {
    const second = String(index % 60).padStart(2, "0");
    const minute = String(Math.floor(index / 60)).padStart(2, "0");
    core.recordSignal({
      kind: "presented",
      taskId: "task:bounded",
      interactionId: `interaction:${index}`,
      timestamp: `2026-03-08T12:${minute}:${second}.000Z`,
    });
  }

  const signals = core.getSignals("task:bounded");
  assert.equal(signals.length, 256);
  assert.equal(signals[0]?.interactionId, "interaction:44");
  assert.equal(signals.at(-1)?.interactionId, "interaction:299");
});

test("promotion from queued work records sequence signals", () => {
  const core = new ApertureCore();
  const seen: InteractionSignal[] = [];

  core.onSignal((signal) => {
    seen.push(signal);
  });

  core.publish({
    id: "evt:primary",
    taskId: "task:sequence",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:primary",
    title: "Approve change",
    summary: "A change needs approval.",
    consequence: "high",
    request: {
      kind: "approval",
    },
  });

  core.publish({
    id: "evt:queued",
    taskId: "task:sequence",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:queued",
    title: "Choose fallback",
    summary: "A fallback option is needed.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  core.submit({
    taskId: "task:sequence",
    interactionId: "interaction:primary",
    response: { kind: "approved" },
  });

  const summary = core.getSignalSummary("task:sequence");
  assert.equal(summary.counts.returned, 1);
  assert.equal(summary.counts.attentionShifted, 1);

  const signals = core.getSignals("task:sequence");
  assert.ok(signals.some((signal) => signal.kind === "returned"));
  assert.ok(signals.some((signal) => signal.kind === "attention_shifted"));

  const responded = seen.find((signal) => signal.kind === "responded");
  const returned = seen.find((signal) => signal.kind === "returned");
  const shifted = seen.find((signal) => signal.kind === "attention_shifted");
  assert.equal(responded?.timestamp, returned?.timestamp);
  assert.equal(returned?.timestamp, shifted?.timestamp);
});

test("core exposes global attention state across tasks", () => {
  const core = new ApertureCore();

  for (let index = 0; index < 5; index += 1) {
    core.recordSignal({
      kind: "deferred",
      taskId: `task:${index}`,
      interactionId: `interaction:${index}`,
      timestamp: `2026-03-08T12:00:${String(index).padStart(2, "0")}.000Z`,
      reason: index % 2 === 0 ? "queued" : "suppressed",
    });
  }

  assert.equal(core.getAttentionState(), "overloaded");
});
