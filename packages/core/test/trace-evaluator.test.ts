import assert from "node:assert/strict";
import test from "node:test";

import { ApertureCore } from "../src/aperture-core.js";
import { subscribeInternalTrace, type ApertureTrace } from "../src/internal-contract.js";
import { semanticHintsForTruncatedSourceEvidence } from "../src/semantic.js";
import { evaluateTraceSession } from "../src/trace-evaluator.js";

test("trace evaluator counts merged episode updates across tasks", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
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
    id: "evt:next:first",
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
    id: "evt:next:second",
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
  const core = new ApertureCore({ operatorPresence: "absent" });
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:episode:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "human.input.requested",
    source: { id: "session:1", kind: "claude-code" },
    interactionId: "interaction:episode:a",
    title: "Choose config fix",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  core.setOperatorPresence("present");

  core.publish({
    id: "evt:episode:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    source: { id: "session:1", kind: "claude-code" },
    interactionId: "interaction:episode:b",
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

  assert.equal(report.deferredThenActivated, 1);
  assert.equal(report.next, 1);
  assert.equal(report.activated, 1);
});

test("trace evaluator reports surfaced actionable episodes from accumulated evidence", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
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

test("trace evaluator reports ambiguous next-lane work that later surfaces in now", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:anchor",
    taskId: "task:anchor",
    timestamp: "2026-03-21T18:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:anchor",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:uncertain:first",
    type: "task.updated",
    taskId: "task:uncertain",
    timestamp: "2026-03-21T18:00:10.000Z",
    source: { id: "custom-agent" },
    title: "Build failed",
    summary: "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
    status: "failed",
    semanticHints: semanticHintsForTruncatedSourceEvidence({ status: "failed" }),
  });

  core.publish({
    id: "evt:anchor:clear",
    taskId: "task:anchor",
    timestamp: "2026-03-21T18:00:20.000Z",
    type: "task.completed",
  });

  core.publishSourceEvent({
    id: "src:uncertain:second",
    type: "task.updated",
    taskId: "task:uncertain",
    timestamp: "2026-03-21T18:00:30.000Z",
    source: { id: "custom-agent" },
    title: "Build failed again",
    summary: "The latest build failed again and should be reviewed.",
    status: "failed",
  });

  const report = evaluateTraceSession(traces);

  assert.equal(report.ambiguousDecisions, 1);
  assert.equal(report.ambiguousNext, 1);
  assert.equal(report.ambiguousAmbient, 0);
  assert.equal(report.ambiguousLowConfidence, 1);
  assert.equal(report.ambiguousAbstained, 0);
  assert.equal(report.ambiguousNextThenActivated, 1);
  assert.equal(report.ambiguousAmbientThenActivated, 0);
});

test("trace evaluator reports ambiguous ambient work that later activates", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:anchor:ambient",
    taskId: "task:anchor:ambient",
    timestamp: "2026-03-21T18:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:anchor:ambient",
    title: "Approve schema migration",
    summary: "A schema migration is waiting for approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:abstained:first",
    type: "task.updated",
    taskId: "task:abstained",
    timestamp: "2026-03-21T18:01:10.000Z",
    source: { id: "custom-agent" },
    title: "Dependency fetch blocked",
    summary:
      "Dependency fetch is blocked, but the semantic read abstains until clearer evidence arrives.",
    status: "blocked",
    semanticHints: {
      abstained: true,
    },
  });

  core.publish({
    id: "evt:anchor:ambient:clear",
    taskId: "task:anchor:ambient",
    timestamp: "2026-03-21T18:01:20.000Z",
    type: "task.completed",
  });

  core.publishSourceEvent({
    id: "src:abstained:second",
    type: "task.updated",
    taskId: "task:abstained",
    timestamp: "2026-03-21T18:01:30.000Z",
    source: { id: "custom-agent" },
    title: "Dependency fetch failed",
    summary: "The dependency fetch failed and should now be reviewed.",
    status: "failed",
    semanticHints: {
      confidence: "high",
    },
  });

  const report = evaluateTraceSession(traces);

  assert.equal(report.ambiguousDecisions, 1);
  assert.equal(report.ambiguousNext, 0);
  assert.equal(report.ambiguousAmbient, 1);
  assert.equal(report.ambiguousLowConfidence, 0);
  assert.equal(report.ambiguousAbstained, 1);
  assert.equal(report.ambiguousNextThenActivated, 0);
  assert.equal(report.ambiguousAmbientThenActivated, 1);
});

test("candidate traces expose semantic summaries with routing influence", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:semantic:choice",
    type: "human.input.requested",
    taskId: "task:semantic:choice",
    interactionId: "interaction:semantic:choice",
    timestamp: "2026-03-27T18:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    toolFamily: "read",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  const trace = traces.at(-1);
  assert(trace);
  assert.equal(trace.evaluation.kind, "candidate");
  if (trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.intentFrame, "question_request");
  assert.equal(trace.semantic?.toolFamily, "read");
  assert.equal(trace.semantic?.confidence, "low");
  assert.equal(trace.semantic?.ontology.ask, "choice");
  assert.equal(trace.semantic?.ontology.blocking, "blocking");
  assert.ok(trace.semantic?.reasons.includes("tool family was supplied by the source event"));
  assert.equal(trace.semantic?.impact.routingAuthority, "request");
  assert.deepEqual(trace.semantic?.impact.canonical, [
    "activity (canonical)",
    "consequence (canonical)",
  ]);
  assert.deepEqual(trace.semantic?.impact.ambiguity, []);
  assert.deepEqual(trace.semantic?.impact.contextOnly, ["intent", "tool", "why now", "confidence"]);
  assert.ok(
    trace.semantic?.influence.includes(
      "tool family stayed semantic-only on the question/form path",
    ),
  );
  assert.ok(
    trace.semantic?.influence.includes(
      "semantic low confidence stayed visible but did not downgrade blocking work",
    ),
  );
});
