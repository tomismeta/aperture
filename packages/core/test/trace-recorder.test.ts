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
  assert.equal(trace.semantic?.provenance?.toolFamily, "source");
  assert.deepEqual(trace.semantic?.impact, {
    decisionBearing: ["consequence (canonical)"],
    explanatory: ["intent", "tool", "why now", "confidence"],
  });
});

test("trace recorder captures explanatory-only tool family on form paths", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:form:tool-family",
    type: "human.input.requested",
    taskId: "task:form:tool-family",
    interactionId: "interaction:form:tool-family",
    timestamp: "2026-03-27T20:00:30.000Z",
    source: { id: "custom-agent" },
    title: "Fill out the release form",
    summary: "Provide the required deployment fields.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "form",
      fields: [{ id: "reason", label: "Reason", input: { kind: "text" } }],
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
  assert.equal(trace.semantic?.provenance?.toolFamily, "source");
  assert.deepEqual(trace.semantic?.impact, {
    decisionBearing: ["consequence (canonical)"],
    explanatory: ["intent", "tool", "why now", "confidence"],
  });
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
  assert.equal(trace.semantic?.provenance?.intentFrame, "inferred");
  assert.deepEqual(trace.semantic?.impact, {
    decisionBearing: ["confidence (ambiguity)"],
    explanatory: ["intent", "consequence", "why now"],
  });
});

test("trace recorder promotes abstention to ambiguity-bearing impact on non-blocking status work", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:abstained",
    type: "task.updated",
    taskId: "task:status:abstained",
    timestamp: "2026-03-27T20:01:30.000Z",
    source: { id: "custom-agent" },
    title: "Still waiting on dependency fetch",
    summary: "Work is still waiting while the semantic layer abstains for now.",
    status: "waiting",
    semanticHints: {
      abstained: true,
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.abstained, true);
  assert.ok(
    trace.semantic?.influence.includes(
      "semantic abstention can keep non-blocking status work peripheral until clearer evidence arrives",
    ),
  );
  assert.deepEqual(trace.semantic?.impact, {
    decisionBearing: ["abstention (ambiguity)"],
    explanatory: ["intent", "consequence", "confidence"],
  });
});

test("trace recorder preserves hint-driven semantic provenance", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:hinted:approval",
    type: "human.input.requested",
    taskId: "task:hinted:approval",
    interactionId: "interaction:hinted:approval",
    timestamp: "2026-03-27T20:02:00.000Z",
    source: { id: "custom-agent" },
    title: "Approve read",
    summary: "Read a file in the repo.",
    request: { kind: "approval" },
    semanticHints: {
      consequence: "high",
      whyNow: "A policy escalation requires senior review.",
      reasons: ["adapter provided a trusted escalation hint"],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.consequence, "high");
  assert.equal(trace.semantic?.whyNow, "A policy escalation requires senior review.");
  assert.equal(trace.semantic?.provenance?.consequence, "hint");
  assert.equal(trace.semantic?.provenance?.whyNow, "hint");
  assert.deepEqual(trace.semantic?.impact, {
    decisionBearing: ["consequence (canonical)", "tool (approval path)"],
    explanatory: ["intent", "why now", "confidence"],
  });
});
