import assert from "node:assert/strict";

import { ApertureCore } from "@tomismeta/aperture-core";
import { isCandidateTrace, type ApertureTrace } from "@tomismeta/aperture-core/trace";

const core = new ApertureCore();
const traces: ApertureTrace[] = [];

core.onTrace((trace) => {
  traces.push(trace);
});

core.publishSourceEvent({
  id: "src:trace-example",
  type: "human.input.requested",
  taskId: "task:trace-example",
  interactionId: "interaction:trace-example",
  timestamp: "2026-04-04T18:30:00.000Z",
  source: { id: "custom-agent" },
  title: "Should we inspect the config first?",
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

const trace = traces.at(-1);
assert.ok(trace);
assert.equal(trace?.evaluation.kind, "candidate");
if (!trace || !isCandidateTrace(trace)) {
  assert.fail("expected a candidate trace");
}

assert.equal(trace.semantic?.toolFamily, "read");
assert.equal(trace.coordination.kind, "activate");
assert.deepEqual(trace.semantic?.impact.decisionBearing, [
  "activity (canonical)",
  "consequence (canonical)",
]);

console.log("trace entrypoint example passed");
