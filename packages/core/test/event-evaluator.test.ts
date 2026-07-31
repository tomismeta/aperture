import test from "node:test";
import assert from "node:assert/strict";

import { buildAttentionClaim } from "../src/attention-claim.js";
import { evaluateAttention } from "../src/attention-evaluator.js";
import { EventEvaluator } from "../src/event-evaluator.js";
import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import { normalizePublicEvaluationInput } from "../src/attention-evaluator-input.js";
import { semanticHintsForTruncatedSourceEvidence } from "../src/semantic-source-quality.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";

const evaluation = new EventEvaluator();
const coordinator = new JudgmentCoordinator();
const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const declinedActionMessage =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
const successfulTestObservationTranscript =
  "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!";
const abbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import an...";
const proceduralHarnessObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. 1. If you made any changes to your code after running the reproduction script, please run the reproduction script again. 2. Confirm the reproduction script passes before submitting.";
const mixedProceduralFailureObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. The script exited with code 1 and the issue still does not work. 1. Run the reproduction script again after making changes. 2. Confirm the script exits with code 0 before submitting.";
const editMissObservationTranscript =
  "OBSERVATION: No replacement was performed, old_str `def emit(self, text_gen, margin_char=None):` was not found in the file.";
const failingTestObservationTranscript =
  "OBSERVATION: test_yes_no_for_booleans (tests.test_config.SimpleConfigTestCase) ... ERROR ====================================================================== ERROR: test_yes_no_for_booleans";

test("task.started becomes a background status candidate", () => {
  const result = evaluation.evaluate({
    id: "evt:start",
    taskId: "task:1",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.started",
    title: "Preparing repository scan",
    summary: "Collecting context.",
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.responseSpec.kind, "none");
});

test("task.updated blocked becomes a focused normal-priority status", () => {
  const result = evaluation.evaluate({
    id: "evt:blocked",
    taskId: "task:1",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "task.updated",
    title: "Blocked on credentials",
    summary: "Waiting for operator input.",
    status: "blocked",
    progress: 45,
    context: {
      items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Work is blocked and may require operator attention.",
  );
  assert.deepEqual(result.candidate.context, {
    progress: 45,
    items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
  });
});

test("task.updated failed becomes a critical high-priority status", () => {
  const result = evaluation.evaluate({
    id: "evt:failed",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:00.000Z",
    type: "task.updated",
    title: "Patch application failed",
    summary: "The repository is in a conflicted state.",
    status: "failed",
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
});

test("bare nonzero command exits route as focused medium failed statuses", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-bare-nonzero-exit",
      taskId: "task:failed-bare-nonzero-exit",
      timestamp: "2026-03-08T12:02:05.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "(no output) Command exited with code 1",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.failureEvidence?.semanticAgreement, "stable");
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "failure",
    consequence: "medium",
    blocking: "non_blocking",
    episode: "unknown",
    confidence: "high",
    source: "explicit",
  });

  const explanation = coordinator.explain(null, result.candidate);
  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.policy.mayInterrupt, false);
  assert.equal(explanation.policy.requiresOperatorResponse, false);
  assert.equal(explanation.policy.minimumLane, "next");
  assert.equal(explanation.criterion?.peripheralResolution, "queue");
  assert.equal(explanation.ambiguity, null);
  assert.equal(explanation.reasonCodes.includes("criterion:ambiguity:low_signal"), false);

  const claim = buildAttentionClaim(result.candidate);
  assert.equal(Object.hasOwn(claim.judgment ?? {}, "failureEvidence"), false);
  assert.equal(claim.judgment?.outcomeOnlyFailureStatus, true);
  const publicRecord = evaluateAttention({ claim });
  assert.equal(publicRecord.decision.kind, "queue");
  assert.equal(publicRecord.planning.plannedLane, "next");
  assert.equal(publicRecord.policy.verdict.minimumLane, "next");
  assert.equal(publicRecord.planning.ambiguity, null);
  assert.equal(publicRecord.planning.reasonCodes.includes("criterion:ambiguity:low_signal"), false);
});

test("structured outcome-only nonzero exits route like raw outcome-only failures", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-structured-outcome-only-exit",
      taskId: "task:failed-structured-outcome-only-exit",
      timestamp: "2026-03-08T12:02:06.000Z",
      type: "task.updated",
      title: "exec_command failure",
      summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
      status: "failed",
      toolFamily: "exec_command",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.kind, "terminal_failure");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.failureDetail, "outcome_only");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.semanticAgreement, "stable");

  const explanation = coordinator.explain(null, result.candidate);
  assert.equal(explanation.decision.kind, "queue");
  assert.equal(explanation.policy.minimumLane, "next");
  assert.equal(explanation.ambiguity, null);
});

test("truncated outcome-only hints keep failed statuses conservative", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-truncated-outcome-only-exit",
      taskId: "task:failed-truncated-outcome-only-exit",
      timestamp: "2026-03-08T12:02:07.000Z",
      type: "task.updated",
      title: "exec_command failure",
      summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
      status: "failed",
      toolFamily: "exec_command",
      metadata: { truncated: true },
      semanticHints: semanticHintsForTruncatedSourceEvidence({ status: "failed" }),
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.failureDetail, "outcome_only");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.semanticAgreement, "uncertain");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
  assert.equal(result.candidate.judgmentInput.ontology?.consequence, "high");
  assert.equal(result.candidate.judgmentInput.ontology?.confidence, "low");
});

test("hinted outcome-only softening is rejected for diagnostic failures", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-forged-outcome-only-softening",
      taskId: "task:failed-forged-outcome-only-softening",
      timestamp: "2026-03-08T12:02:08.000Z",
      type: "task.updated",
      title: "exec_command failure",
      summary: '{"exit_code":2,"wall_time":"0.0510 seconds","output":"sh: foo: command not found"}',
      status: "failed",
      toolFamily: "exec_command",
      semanticHints: {
        consequence: "medium",
        reasons: ["adapter claimed this only needs acknowledgement"],
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.failureDetail, "diagnostic");
  assert.equal(result.candidate.judgmentInput.failureEvidence?.semanticAgreement, "overridden");
});

test("failed-status routine bash observations route as non-interruptive status", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-routine-observation",
      taskId: "task:failed-routine-observation",
      timestamp: "2026-03-08T12:02:15.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.provenance?.whyNow, undefined);
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(result.candidate.judgmentInput.observationalStatusConflict, {
    kind: "command_success_observation",
    toolFamily: "bash",
    baselineConsequence: "low",
  });
  assert.equal(
    buildAttentionClaim(result.candidate).judgment?.routineObservationalStatusConflict,
    true,
  );
  assert.deepEqual(buildAttentionClaim(result.candidate).judgment?.observationalStatusConflict, {
    kind: "command_success_observation",
    toolFamily: "bash",
    baselineConsequence: "low",
  });
  assert.equal(
    normalizePublicEvaluationInput({ claim: buildAttentionClaim(result.candidate) }).candidate
      .judgmentInput.routineObservationalStatusConflict,
    true,
  );
  assert.deepEqual(
    normalizePublicEvaluationInput({ claim: buildAttentionClaim(result.candidate) }).candidate
      .judgmentInput.observationalStatusConflict,
    {
      kind: "command_success_observation",
      toolFamily: "bash",
      baselineConsequence: "low",
    },
  );
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "non_blocking",
    episode: "unknown",
    confidence: "high",
    source: "inferred",
  });
});

test("failed-status missing-tool operation success observations route as non-interruptive status", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-file-created-observation",
      taskId: "task:failed-file-created-observation",
      timestamp: "2026-03-08T12:02:16.000Z",
      type: "task.updated",
      title: "tool failure",
      summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
      status: "failed",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.provenance?.whyNow, undefined);
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(result.candidate.judgmentInput.observationalStatusConflict, {
    kind: "payload_observation",
    baselineConsequence: "low",
  });
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "non_blocking",
    episode: "unknown",
    confidence: "high",
    source: "inferred",
  });
});

test("known command operation success text keeps failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-command-file-created-observation",
      taskId: "task:failed-command-file-created-observation",
      timestamp: "2026-03-08T12:02:17.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.observationalStatusConflict, undefined);
});

test("inline expectation probes keep failed-status routing while truncated", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-inline-expectation-truncated",
      taskId: "task:failed-inline-expectation-truncated",
      timestamp: "2026-03-08T12:02:18.000Z",
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: Testing _quote_match function: quote_type='single', token_style=single quote -> True (should be True) quote_type='single', token_style=double quote -> False (should be False) ...",
      status: "failed",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.observationalStatusConflict, undefined);
});

test("mixed bash success and terminal failure text keeps failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:mixed-bash-failure",
      taskId: "task:mixed-bash-failure",
      timestamp: "2026-03-08T12:02:20.000Z",
      type: "task.updated",
      title: "bash failure",
      summary:
        "Your command ran successfully and did not produce any output. Traceback follows from the repro step.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("semantic hints cannot forge routine bash status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:forged-observation-conflict",
      taskId: "task:forged-observation-conflict",
      timestamp: "2026-03-08T12:02:22.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Error: deployment failed with exit code 1.",
      status: "failed",
      toolFamily: "bash",
      semanticHints: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        confidence: "high",
        factors: ["observational_failure"],
        reasons: ["adapter claimed observational output"],
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.ontology?.activity, "failure");
});

test("metadata tool family cannot forge routine bash status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:metadata-forged-observation-conflict",
      taskId: "task:metadata-forged-observation-conflict",
      timestamp: "2026-03-08T12:02:23.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      metadata: { toolFamily: "bash" },
      semanticHints: {
        toolFamily: "bash",
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        confidence: "high",
        factors: ["observational_failure"],
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.ontology?.activity, "failure");
});

test("medium-confidence routine bash observations keep failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:medium-confidence-routine-observation",
      taskId: "task:medium-confidence-routine-observation",
      timestamp: "2026-03-08T12:02:25.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
      semanticHints: {
        confidence: "medium",
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("low-consequence failed read observations use observational status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:failed-read-log-observation",
      taskId: "task:failed-read-log-observation",
      timestamp: "2026-03-08T12:02:28.000Z",
      type: "task.updated",
      title: "read failure",
      summary:
        "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
      status: "failed",
      toolFamily: "read",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
});

test("neutral structured output without source shape keeps failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:structured-unclassified-failure",
      taskId: "task:structured-unclassified-failure",
      timestamp: "2026-03-08T12:02:29.000Z",
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"Collected benchmark rows."}',
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.notEqual(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
});

test("observational status-conflict routing preserves high consequence", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:raw-source-high-observation",
      taskId: "task:raw-source-high-observation",
      timestamp: "2026-03-08T12:02:29.500Z",
      type: "task.updated",
      title: "read failure",
      summary: "#include <stdio.h>\nint main() { return 0; }",
      status: "failed",
      toolFamily: "read",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(result.candidate.judgmentInput.observationalStatusConflict, {
    kind: "payload_observation",
    toolFamily: "read",
    baselineConsequence: "high",
  });
});

test("valid source function prefixes preserve observational routing", () => {
  for (const [id, summary] of [
    ["javascript-empty-function-body", "function run() {}"],
    ["javascript-function-body", "function run() { return true; }"],
    ["javascript-function-object-body", "function run() { return { ok: true }; }"],
    ["javascript-function-quoted-brace", 'function run() { return "}"; }'],
    ["typescript-export-async-function", "export async function run(): Promise<void> {"],
    ["javascript-export-default-function", "export default function run() {}"],
  ] as const) {
    const result = evaluation.evaluate(
      normalizeSourceEvent({
        id: `evt:valid-source-function-${id}`,
        taskId: `task:valid-source-function-${id}`,
        timestamp: "2026-03-08T12:02:29.600Z",
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      }),
    );

    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }

    assert.equal(result.candidate.priority, "high");
    assert.equal(result.candidate.tone, "critical");
    assert.equal(result.candidate.consequence, "high");
    assert.equal(result.candidate.responseSpec.kind, "acknowledge");
    assert.equal(result.candidate.activityClass, "status_update");
    assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
    assert.equal(
      result.candidate.judgmentInput.observationalStatusConflict?.kind,
      "payload_observation",
    );
  }
});

test("source-like prose prefixes keep failed-status routing", () => {
  for (const [id, summary] of [
    ["class-prefix", "class schedule needs review before Friday"],
    ["type-prefix", "type the command into the terminal"],
    ["import-prefix", "import the records from the old system"],
    ["title-case-class-prefix", "Class Schedule"],
    ["title-case-interface-prefix", "Interface Status"],
    ["function-prose-parameters", "function run(this through legal first)"],
    ["function-prose-suffix", "function run() this through legal first"],
    ["function-review-suffix", "function review() before Friday"],
    ["python-def-prose-suffix", "def plan() this through legal first"],
    ["python-async-def-prose-suffix", "async def review() before Friday"],
    ["const-prose-assignment", "const plan = review this before Friday"],
  ] as const) {
    const result = evaluation.evaluate(
      normalizeSourceEvent({
        id: `evt:source-like-prose-${id}`,
        taskId: `task:source-like-prose-${id}`,
        timestamp: "2026-03-08T12:02:29.625Z",
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      }),
    );

    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }

    assert.equal(result.candidate.priority, "high");
    assert.equal(result.candidate.tone, "critical");
    assert.equal(result.candidate.consequence, "high");
    assert.equal(result.candidate.responseSpec.kind, "acknowledge");
    assert.equal(result.candidate.activityClass, "tool_failure");
    assert.notEqual(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
    assert.equal(result.candidate.judgmentInput.observationalStatusConflict, undefined);
  }
});

test("missing-tool observation transcripts route through observational status conflict", () => {
  const event = normalizeSourceEvent({
    id: "evt:missing-tool-observation-conflict",
    taskId: "task:missing-tool-observation-conflict",
    timestamp: "2026-03-08T12:02:29.750Z",
    type: "task.updated",
    title: "tool failure",
    summary:
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3 2 import sys",
    status: "failed",
  });
  const result = evaluation.evaluate(event);

  assert.equal(event.toolFamily, undefined);
  assert.equal(event.semantic.toolFamily, undefined);
  assert.equal(event.semantic.activityClass, "status_update");
  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.activityClass, "status_update");
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(
    result.candidate.provenance?.whyNow,
    "A failed status carried high-consequence observation output that should be reviewed.",
  );
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "high",
    blocking: "non_blocking",
    episode: "unknown",
    confidence: "high",
    source: "inferred",
  });
});

test("missing-tool successful test and abbreviated file-view transcripts route quietly", () => {
  for (const [id, summary] of [
    ["successful-test", successfulTestObservationTranscript],
    ["abbreviated-file-view", abbreviatedFileViewObservationTranscript],
    ["procedural-harness", proceduralHarnessObservationTranscript],
  ] as const) {
    const event = normalizeSourceEvent({
      id: `evt:${id}-observation-transcript`,
      taskId: `task:${id}-observation-transcript`,
      timestamp: "2026-03-08T12:02:29.800Z",
      type: "task.updated",
      title: "tool failure",
      summary,
      status: "failed",
    });
    const result = evaluation.evaluate(event);

    assert.equal(event.toolFamily, undefined);
    assert.equal(event.semantic.toolFamily, undefined);
    assert.equal(event.semantic.activityClass, "status_update");
    assert.equal(event.semantic.consequence, "low");
    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }

    assert.equal(result.candidate.toolFamily, undefined);
    assert.equal(result.candidate.activityClass, "status_update");
    assert.equal(result.candidate.priority, "background");
    assert.equal(result.candidate.tone, "ambient");
    assert.equal(result.candidate.consequence, "low");
    assert.equal(result.candidate.responseSpec.kind, "none");
    assert.equal(result.candidate.provenance?.whyNow, undefined);
    assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
    assert.equal(result.candidate.judgmentInput.ontology?.activity, "task_progress");
    assert.equal(result.candidate.judgmentInput.ontology?.consequence, "low");
  }
});

test("procedural observation recovery stays bounded", () => {
  for (const [id, summary] of [
    ["edit-miss", editMissObservationTranscript],
    ["failing-test", failingTestObservationTranscript],
    ["mixed-procedural-failure", mixedProceduralFailureObservationTranscript],
  ] as const) {
    const event = normalizeSourceEvent({
      id: `evt:${id}-not-procedural-observation`,
      taskId: `task:${id}-not-procedural-observation`,
      timestamp: "2026-03-08T12:02:29.810Z",
      type: "task.updated",
      title: "tool failure",
      summary,
      status: "failed",
    });
    const result = evaluation.evaluate(event);

    assert.equal(event.semantic.activityClass, "tool_failure");
    assert.equal(event.semantic.intentFrame, "failure");
    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }
    assert.equal(result.candidate.activityClass, "tool_failure");
    assert.equal(result.candidate.priority, "high");
    assert.equal(result.candidate.tone, "critical");
    assert.equal(result.candidate.consequence, "high");
    assert.equal(result.candidate.responseSpec.kind, "acknowledge");
    assert.equal(result.candidate.judgmentInput.observationalStatusConflict, undefined);
    if (id === "mixed-procedural-failure") {
      assert.deepEqual(
        result.candidate.relationHints?.map((hint) => hint.kind),
        ["same_issue", "repeats"],
      );
      assert.equal(result.candidate.judgmentInput.ontology?.episode, "resurfaced");
    }
  }
});

test("read and search corpus output fragments route through observational status conflict", () => {
  const readEvent = normalizeSourceEvent({
    id: "evt:read-technical-doc-observation-conflict",
    taskId: "task:read-technical-doc-observation-conflict",
    timestamp: "2026-03-08T12:02:29.825Z",
    type: "task.updated",
    title: "read failure",
    summary:
      "2783\u2192## 7.6. Dual Issue VALU 2784\u2192 2785\u2192The VOPD instruction encoding allows a single shader instruction to encode two separate VALU operations that are executed in parallel. The two operations must be independent of each other. This ins...",
    status: "failed",
    toolFamily: "read",
  });
  const readResult = evaluation.evaluate(readEvent);

  assert.equal(readEvent.semantic.activityClass, "status_update");
  assert.equal(readEvent.semantic.consequence, "high");
  assert.equal(readResult.kind, "candidate");
  if (readResult.kind !== "candidate") {
    return;
  }
  assert.equal(readResult.candidate.activityClass, "status_update");
  assert.equal(readResult.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(readResult.candidate.judgmentInput.observationalStatusConflict, {
    kind: "payload_observation",
    toolFamily: "read",
    baselineConsequence: "high",
  });

  const searchEvent = normalizeSourceEvent({
    id: "evt:search-grep-context-observation-conflict",
    taskId: "task:search-grep-context-observation-conflict",
    timestamp: "2026-03-08T12:02:29.850Z",
    type: "task.updated",
    title: "search failure",
    summary:
      "2255-- VOP3SD has an SDST field 2256- - V_ADD_CO_U32 adds with carry-out 2257- - V_DIV_SCALE_F32 uses the same encoding",
    status: "failed",
    toolFamily: "search",
  });
  const searchResult = evaluation.evaluate(searchEvent);

  assert.equal(searchEvent.semantic.activityClass, "status_update");
  assert.equal(searchEvent.semantic.consequence, "low");
  assert.equal(searchResult.kind, "candidate");
  if (searchResult.kind !== "candidate") {
    return;
  }
  assert.equal(searchResult.candidate.priority, "background");
  assert.deepEqual(searchResult.candidate.judgmentInput.observationalStatusConflict, {
    kind: "search_output_observation",
    toolFamily: "search",
    baselineConsequence: "low",
  });
});

test("adversarial read and search fragments do not forge observational conflicts", () => {
  for (const [id, toolFamily, title, summary] of [
    [
      "search-numbered-list",
      "search",
      "search failure",
      "1- first item 2- second item 3- third item",
    ],
    [
      "read-acronym-prose",
      "read",
      "read failure",
      "101\u2192## 7.6. API SDK Notes 102\u2192 103\u2192The API and SDK entries are discussed here without an emitted read-window clipping boundary.",
    ],
  ] as const) {
    const event = normalizeSourceEvent({
      id: `evt:${id}`,
      taskId: `task:${id}`,
      timestamp: "2026-03-08T12:02:29.860Z",
      type: "task.updated",
      title,
      summary,
      status: "failed",
      toolFamily,
    });
    const result = evaluation.evaluate(event);

    assert.equal(event.semantic.activityClass, "tool_failure");
    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }
    assert.equal(result.candidate.activityClass, "tool_failure");
    assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
    assert.equal(result.candidate.judgmentInput.observationalStatusConflict, undefined);
  }
});

test("command execution aliases preserve family while using command observation routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:exec-command-routine-observation",
      taskId: "task:exec-command-routine-observation",
      timestamp: "2026-03-08T12:02:29.875Z",
      type: "task.updated",
      title: "exec_command failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "exec_command",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, "exec_command");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
  assert.equal(result.candidate.judgmentInput.ontology?.activity, "task_progress");
});

test("tool-use rejection outcomes route as background status updates", () => {
  for (const [id, title, summary, toolFamily] of [
    ["bash", "bash failure", rejectedToolUseMessage, "bash"],
    ["edit", "edit failure", rejectedToolUseMessage, "edit"],
    ["web", "web failure", rejectedToolUseMessage, "web"],
    ["absent", "tool failure", rejectedToolUseMessage, undefined],
    ["declined-action", "bash failure", declinedActionMessage, "bash"],
  ] as const) {
    const result = evaluation.evaluate(
      normalizeSourceEvent({
        id: `evt:${id}:tool-use-rejection`,
        taskId: `task:${id}:tool-use-rejection`,
        timestamp: "2026-03-08T12:02:29.925Z",
        type: "task.updated",
        title,
        summary,
        status: "failed",
        ...(toolFamily !== undefined ? { toolFamily } : {}),
      }),
    );

    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      return;
    }

    assert.equal(result.candidate.toolFamily, toolFamily);
    assert.equal(result.candidate.priority, "background");
    assert.equal(result.candidate.tone, "ambient");
    assert.equal(result.candidate.consequence, "low");
    assert.equal(result.candidate.responseSpec.kind, "none");
    assert.equal(result.candidate.activityClass, "status_update");
    assert.equal(result.candidate.provenance?.whyNow, undefined);
    assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
    assert.equal(result.candidate.judgmentInput.ontology?.activity, "task_progress");
    assert.equal(result.candidate.judgmentInput.ontology?.consequence, "low");
  }
});

test("tool-use rejection hints cannot forge status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:hinted-tool-use-rejection",
      taskId: "task:hinted-tool-use-rejection",
      timestamp: "2026-03-08T12:02:29.950Z",
      type: "task.updated",
      title: "tool failure",
      summary: rejectedToolUseMessage,
      status: "failed",
      semanticHints: {
        toolFamily: "edit",
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("successful-test observation hints cannot forge status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:hinted-successful-test-observation",
      taskId: "task:hinted-successful-test-observation",
      timestamp: "2026-03-08T12:02:29.960Z",
      type: "task.updated",
      title: "tool failure",
      summary: successfulTestObservationTranscript,
      status: "failed",
      semanticHints: {
        toolFamily: "bash",
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.ontology?.activity, "failure");
});

test("nonmatching rejection prose keeps failed-status routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:service-rejection",
      taskId: "task:service-rejection",
      timestamp: "2026-03-08T12:02:29.975Z",
      type: "task.updated",
      title: "bash failure",
      summary: "The remote service rejected the request after the command retried.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.consequence, "high");
  assert.equal(result.candidate.responseSpec.kind, "acknowledge");
  assert.equal(result.candidate.activityClass, "tool_failure");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
});

test("mismatched command alias hints cannot forge status-conflict routing", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:mismatched-command-alias-observation",
      taskId: "task:mismatched-command-alias-observation",
      timestamp: "2026-03-08T12:02:29.900Z",
      type: "task.updated",
      title: "exec_command failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "exec_command",
      semanticHints: {
        toolFamily: "bash",
      },
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, "exec_command");
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.tone, "critical");
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, undefined);
  assert.equal(result.candidate.judgmentInput.ontology?.activity, "failure");
});

test("task.updated semantics enrich provenance without overriding status routing", () => {
  const result = evaluation.evaluate({
    id: "evt:waiting-semantic",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      consequence: "high",
      whyNow: "Waiting for operator approval before continuing.",
      factors: ["task.updated", "waiting", "implied operator ask"],
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "low",
      reasons: ["status text implies an operator ask"],
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Waiting for operator approval before continuing.",
  );
  assert.deepEqual(
    result.candidate.relationHints?.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
});

test("diagnostic status semantics do not change task.updated routing", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status:baseline",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      factors: ["task.updated", "waiting"],
      relationHints: [],
      confidence: "high",
      reasons: ["baseline semantic read"],
    },
  });

  const diagnosticVariant = evaluation.evaluate({
    id: "evt:status:diagnostic",
    taskId: "task:1",
    timestamp: "2026-03-08T12:02:30.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "status_update",
      whyNow: "Status text implies the operator may need to respond.",
      factors: ["task.updated", "waiting", "implied operator ask"],
      relationHints: [],
      confidence: "low",
      reasons: ["diagnostic semantic read"],
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(diagnosticVariant.kind, "candidate");
  if (baseline.kind !== "candidate" || diagnosticVariant.kind !== "candidate") {
    return;
  }

  assert.equal(diagnosticVariant.candidate.priority, baseline.candidate.priority);
  assert.equal(diagnosticVariant.candidate.tone, baseline.candidate.tone);
  assert.equal(diagnosticVariant.candidate.consequence, baseline.candidate.consequence);
  assert.equal(diagnosticVariant.candidate.responseSpec.kind, baseline.candidate.responseSpec.kind);
});

test("semantic blocking on waiting statuses lifts status posture without making it a request", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:status:blocking-diagnostic",
      taskId: "task:status:blocking-diagnostic",
      timestamp: "2026-03-08T12:02:35.000Z",
      type: "task.updated",
      title: "Cannot continue until credentials are provided",
      summary: "Work is waiting but cannot proceed until the operator provides credentials.",
      status: "waiting",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.blocking, false);
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.tone, "focused");
  assert.equal(result.candidate.consequence, "medium");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "medium",
    blocking: "blocking",
    episode: "unknown",
    confidence: "medium",
    source: "inferred",
  });
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Work is blocked and may require operator attention.",
  );
});

test("request-like semantic hints on running statuses stay status-shaped during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:status:running-approval-hint",
    taskId: "task:status:running-approval-hint",
    timestamp: "2026-03-08T12:02:36.000Z",
    type: "task.updated",
    title: "Approval checkpoint reached",
    summary: "A higher-level source marked this as an approval checkpoint.",
    status: "running",
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "low",
      whyNow: "A higher-level source marked this as an approval checkpoint.",
      factors: ["task.updated", "running", "semantic approval checkpoint"],
      relationHints: [],
      confidence: "high",
      reasons: ["source marked the status as an approval checkpoint"],
      provenance: {
        intentFrame: "hint",
        activityClass: "hint",
        consequence: "hint",
        whyNow: "hint",
        confidence: "hint",
      },
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.blocking, false);
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(result.candidate.judgmentInput.ontology, {
    ask: "approval",
    activity: "decision_request",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "high",
    source: "hinted",
  });
});

test("approval requests become blocking approval candidates", () => {
  const result = evaluation.evaluate({
    id: "evt:approval",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve workspace write",
    summary: "This change modifies production configuration.",
    request: {
      kind: "approval",
      requireReason: true,
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "approval");
  assert.equal(result.candidate.blocking, true);
  assert.equal(result.candidate.priority, "high");
  assert.equal(result.candidate.responseSpec.kind, "approval");
  assert.equal(result.candidate.responseSpec.requireReason, true);
  assert.deepEqual(
    result.candidate.responseSpec.actions.map((action) => action.id),
    ["approve", "reject"],
  );
});

test("low-risk approvals become normal-priority blocking candidates", () => {
  const result = evaluation.evaluate({
    id: "evt:approval:read",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:read",
    title: "Approve read",
    summary: "Read src/index.ts",
    consequence: "low",
    request: {
      kind: "approval",
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.mode, "approval");
  assert.equal(result.candidate.blocking, true);
  assert.equal(result.candidate.priority, "normal");
  assert.equal(result.candidate.consequence, "low");
});

test("event provenance whyNow remains authoritative over semantic whyNow on human input", () => {
  const result = evaluation.evaluate({
    id: "evt:approval:provenance",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:provenance",
    title: "Approve deploy",
    summary: "A deploy is waiting for approval.",
    consequence: "medium",
    provenance: {
      whyNow: "Adapter says release train is blocked.",
      factors: ["adapter release gate"],
    },
    semantic: {
      intentFrame: "approval_request",
      whyNow: "Semantic layer inferred a generic approval checkpoint.",
      factors: ["human.input.requested", "approval"],
      relationHints: [],
      confidence: "medium",
      reasons: ["request kind establishes an explicit operator decision point"],
    },
    request: {
      kind: "approval",
    },
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.candidate.provenance?.whyNow, "Adapter says release train is blocked.");
  assert.deepEqual(result.candidate.provenance?.factors, [
    "adapter release gate",
    "human.input.requested",
    "approval",
  ]);
});

test("human-input explanation semantics do not change routing shape", () => {
  const baseline = evaluation.evaluate({
    id: "evt:approval:baseline",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:45.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:baseline",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    request: {
      kind: "approval",
    },
  });

  const explained = evaluation.evaluate({
    id: "evt:approval:explained",
    taskId: "task:1",
    timestamp: "2026-03-08T12:03:45.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval:explained",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    semantic: {
      intentFrame: "approval_request",
      whyNow: "This deploy is waiting on an explicit approval checkpoint.",
      factors: ["approval", "deploy"],
      relationHints: [],
      confidence: "low",
      reasons: ["request kind establishes an explicit operator decision point"],
    },
    request: {
      kind: "approval",
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(explained.kind, "candidate");
  if (baseline.kind !== "candidate" || explained.kind !== "candidate") {
    return;
  }

  assert.equal(explained.candidate.mode, baseline.candidate.mode);
  assert.equal(explained.candidate.priority, baseline.candidate.priority);
  assert.equal(explained.candidate.tone, baseline.candidate.tone);
  assert.equal(explained.candidate.consequence, baseline.candidate.consequence);
  assert.equal(explained.candidate.blocking, baseline.candidate.blocking);
  assert.equal(explained.candidate.responseSpec.kind, baseline.candidate.responseSpec.kind);
  assert.equal(
    explained.candidate.provenance?.whyNow,
    "This deploy is waiting on an explicit approval checkpoint.",
  );
  assert.equal(explained.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("question wording about a tool does not project a tool family without explicit source truth", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:question:read-wording",
    taskId: "task:question:read-wording",
    timestamp: "2026-03-08T12:03:50.000Z",
    type: "human.input.requested",
    interactionId: "interaction:question:read-wording",
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type !== "human.input.requested") {
    return;
  }

  const result = evaluation.evaluate(normalized);
  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.mode, "choice");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("explicit question tool families stay semantic-only during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:question:explicit-tool-family",
    taskId: "task:question:explicit-tool-family",
    timestamp: "2026-03-08T12:03:40.000Z",
    type: "human.input.requested",
    interactionId: "interaction:question:explicit-tool-family",
    toolFamily: "read",
    activityClass: "question_request",
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
    semantic: {
      intentFrame: "question_request",
      activityClass: "question_request",
      toolFamily: "read",
      consequence: "medium",
      factors: ["human.input.requested", "choice"],
      relationHints: [],
      confidence: "low",
      reasons: ["tool family was supplied by the source or context"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("explicit form tool families stay semantic-only during evaluation", () => {
  const result = evaluation.evaluate({
    id: "evt:form:explicit-tool-family",
    taskId: "task:form:explicit-tool-family",
    timestamp: "2026-03-08T12:03:50.000Z",
    type: "human.input.requested",
    interactionId: "interaction:form:explicit-tool-family",
    toolFamily: "read",
    activityClass: "question_request",
    title: "Fill out the release form",
    summary: "Provide the required deployment fields.",
    request: {
      kind: "form",
      fields: [{ id: "reason", label: "Reason", input: { kind: "text" } }],
    },
    semantic: {
      intentFrame: "question_request",
      activityClass: "question_request",
      toolFamily: "read",
      consequence: "medium",
      factors: ["human.input.requested", "form"],
      relationHints: [],
      confidence: "low",
      reasons: ["tool family was supplied by the source or context"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.toolFamily, undefined);
  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.mode, "form");
  assert.equal(result.candidate.judgmentInput.semanticEvidence?.confidence, "low");
});

test("completed tasks clear current interaction state", () => {
  const result = evaluation.evaluate({
    id: "evt:complete",
    taskId: "task:1",
    timestamp: "2026-03-08T12:04:00.000Z",
    type: "task.completed",
  });

  assert.deepEqual(result, { kind: "clear", taskId: "task:1" });
});
