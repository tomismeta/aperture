import assert from "node:assert/strict";

import {
  projectApertureKernelEvent,
  type ApertureKernelEvent,
} from "@tomismeta/aperture-core/kernel";

const event: ApertureKernelEvent = {
  id: "evt:kernel:command-success",
  workId: "work:kernel:command-success",
  occurredAt: "2026-04-22T18:30:00.000Z",
  kind: "work.updated",
  title: "Command observation",
  summary: "Your command ran successfully and did not produce any output.",
  status: "failed",
  facts: {
    capabilityFamily: "exec_command",
  },
};

const projection = projectApertureKernelEvent(event);

assert.equal(projection.evaluation.kind, "candidate");
assert.equal(projection.event.semantic.capabilityFamily, "exec_command");
assert.equal(projection.observation?.kind, "outcome");
assert.equal(projection.observation?.polarity, "success");
assert.equal(projection.observation?.ownership.capabilityFamily, "exec_command");
assert.equal(projection.judgment?.statusConflictKind, "command_success_observation");
assert.equal(projection.judgment?.stableStatusEvidence, true);

console.log("kernel entrypoint example passed");
