import assert from "node:assert/strict";

import {
  evaluateApertureKernelEvent,
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

const result = evaluateApertureKernelEvent(event);

assert.equal(result.evaluation.kind, "candidate");
assert.equal(result.event.semantic.capabilityFamily, "exec_command");
assert.equal(result.observation?.kind, "outcome");
assert.equal(result.observation?.polarity, "success");
assert.equal(result.observation?.ownership.capabilityFamily, "exec_command");
assert.equal(result.observationJudgment?.statusConflictKind, "command_success_observation");
assert.equal(result.observationJudgment?.stableStatusEvidence, true);
assert.deepEqual(result.explanation.flow, ["normalize", "observe", "judge"]);
assert.ok(result.explanation.reasonCodes.includes("kernel:observe:kind:outcome"));
assert.ok(
  result.explanation.reasonCodes.includes(
    "kernel:judge:status_conflict:command_success_observation",
  ),
);

console.log("kernel entrypoint example passed");
