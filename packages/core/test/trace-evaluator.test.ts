import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";
import { evaluateTraceSession } from "../src/trace-evaluator.js";

test("trace evaluator counts merged episode updates across tasks", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:queued:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fix",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  core.publish({
    id: "evt:queued:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:b",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fallback",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "fallback", label: "Fallback" }],
    },
  });

  const report = evaluateTraceSession(traces);

  assert.equal(report.totalCandidates, 3);
  assert.equal(report.mergedEpisodeUpdates, 1);
  assert.equal(report.activated, 3);
});

test("trace evaluator reports deferred episodes that later activate", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:episode:first",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed",
    summary: "config.ts",
    status: "failed",
  });

  core.publish({
    id: "evt:clear",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.completed",
  });

  core.publish({
    id: "evt:episode:second",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed again",
    summary: "config.ts",
    status: "failed",
  });

  const report = evaluateTraceSession(traces);

  assert.equal(report.deferredThenActivated, 1);
  assert.equal(report.queued, 1);
  assert.equal(report.activated, 2);
});

test("trace evaluator reports surfaced actionable episodes from accumulated evidence", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:episode:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed",
    summary: "config.ts",
    status: "failed",
  });

  core.publish({
    id: "evt:clear",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.completed",
  });

  core.publish({
    id: "evt:episode:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed again",
    summary: "config.ts",
    status: "failed",
  });

  const report = evaluateTraceSession(traces);

  assert.equal(report.actionableEpisodes, 1);
  assert.equal(report.actionableActivated, 1);
  assert.equal(report.actionableSurfaced, 1);
});
