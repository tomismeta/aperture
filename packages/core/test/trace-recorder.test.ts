import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";

function latestCandidateTrace(traces: ApertureTrace[]) {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (trace?.evaluation.kind === "candidate") {
      return trace;
    }
  }

  return null;
}

test("trace recorder captures explanatory-only tool family on question paths", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:question:tool-family",
    type: "human.input.requested",
    taskId: "task:question:tool-family",
    interactionId: "interaction:question:tool-family",
    timestamp: "2026-03-27T20:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.toolFamily, "read");
  assert.equal(trace.semantic?.confidence, "low");
  assert.ok(trace.semantic?.influence.includes("tool family stayed explanatory on the question/form path"));
});

test("trace recorder explains that status remains authoritative on task updates", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:semantic",
    type: "task.updated",
    taskId: "task:status:semantic",
    timestamp: "2026-03-27T20:01:00.000Z",
    source: { id: "custom-agent" },
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.ok(
    trace.semantic?.influence.includes(
      "task status remained authoritative; semantic details stayed bounded to explanation, continuity, and ambiguity handling",
    ),
  );
  assert.equal(trace.semantic?.intentFrame, "status_update");
});
