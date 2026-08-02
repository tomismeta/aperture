import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionJudgmentInput,
  hasActionableBlockedLikeStatusSemantics,
  hasBlockedLikeStatusSemantics,
  hasLimitedFailureStatusJudgmentInput,
  hasLimitedFailureStatusSemantics,
  hasOutcomeOnlyFailureStatusJudgmentInput,
  hasOutcomeOnlyFailureStatusSemantics,
  hasRoutineObservationalStatusConflictSemantics,
  readSemanticRelationEvidenceStrength,
  readSemanticEvidenceStrength,
  resolvePeripheralResolutionFloor,
} from "../src/judgment-input.js";
import { projectObservationJudgmentContract } from "../src/judgment-observation-contract.js";

const timestamp = "2026-04-05T18:30:00.000Z";
const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const successfulTestObservationTranscript =
  "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!";
const abbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import an...";
const proceduralHarnessObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. 1. If you made any changes to your code after running the reproduction script, please run the reproduction script again. 2. Confirm the reproduction script passes before submitting.";
const mixedProceduralFailureObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. The script exited with code 1 and the issue still does not work. 1. Run the reproduction script again after making changes. 2. Confirm the script exits with code 0 before submitting.";

test("judgment input compiles blocked-like waiting statuses into one internal seam", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:blocked-like",
    taskId: "task:judgment-input:blocked-like",
    timestamp,
    type: "task.updated",
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
    semantic: {
      intentFrame: "blocked_work",
      activityClass: "status_update",
      consequence: "low",
      whyNow: "Work is blocked and may require operator attention.",
      factors: ["task.updated", "waiting", "semantic blocking signal"],
      relationHints: [],
      confidence: "medium",
      reasons: ["status wording indicates work cannot continue yet"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, true);
  assert.equal(input.ontology?.blocking, "blocking");
  assert.equal(input.semanticEvidence?.strength, "weak");
});

test("judgment input gives explicit human-input semantics a strong evidence read", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:approval",
    taskId: "task:judgment-input:approval",
    interactionId: "interaction:judgment-input:approval",
    timestamp,
    type: "human.input.requested",
    title: "Approve production deploy",
    summary: "Deploy the prepared release to production.",
    request: { kind: "approval" },
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "high",
      whyNow: "High-consequence deploy needs explicit approval.",
      factors: ["human.input.requested", "approval"],
      relationHints: [],
      confidence: "high",
      reasons: ["request kind establishes an explicit operator decision point"],
      provenance: {
        intentFrame: "source",
        activityClass: "source",
        consequence: "source",
        whyNow: "source",
        confidence: "source",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, false);
  assert.equal(input.semanticEvidence?.source, "explicit");
  assert.equal(input.semanticEvidence?.strength, "strong");
  assert.equal(input.relationEvidence, undefined);
});

test("judgment input exposes outcome-only failed status as named semantic evidence", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:outcome-only-failure",
    taskId: "task:judgment-input:outcome-only-failure",
    timestamp,
    type: "task.updated",
    title: "exec_command failure",
    summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
    status: "failed",
    toolFamily: "exec_command",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "exec_command",
      consequence: "medium",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const candidate = {
    taskId: "task:judgment-input:outcome-only-failure",
    interactionId: "interaction:judgment-input:outcome-only-failure",
    mode: "status" as const,
    tone: "focused" as const,
    consequence: "medium" as const,
    title: "exec_command failure",
    responseSpec: { kind: "acknowledge" as const, label: "Acknowledge" },
    priority: "normal" as const,
    blocking: false,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(Object.hasOwn(input, "failureEvidence"), false);
  assert.deepEqual(input.observation, {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "exec_command" },
    evidenceStrength: "strong",
    subject: "tool",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: "explicit" },
    consequenceBaseline: "medium",
  });
  assert.deepEqual(input.observation && projectObservationJudgmentContract(input.observation), {
    statusEvidence: "limited_failure",
    statusConflictKind: null,
    outcomeOnlyFailureStatus: true,
    limitedFailureStatus: true,
    stableStatusEvidence: true,
    visibleDiagnosticFailure: false,
  });
  assert.equal(hasOutcomeOnlyFailureStatusJudgmentInput(input), true);
  assert.equal(hasOutcomeOnlyFailureStatusSemantics(candidate), true);
});

test("judgment input treats empty failed payloads as weak limited failure evidence", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:empty-failure-payload",
    taskId: "task:judgment-input:empty-failure-payload",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary: "{}",
    status: "failed",
    toolFamily: "edit",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "edit",
      consequence: "medium",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const candidate = {
    taskId: "task:judgment-input:empty-failure-payload",
    interactionId: "interaction:judgment-input:empty-failure-payload",
    mode: "status" as const,
    tone: "focused" as const,
    consequence: "medium" as const,
    title: "edit failure",
    responseSpec: { kind: "acknowledge" as const },
    priority: "normal" as const,
    blocking: false,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(Object.hasOwn(input, "failureEvidence"), false);
  assert.deepEqual(input.observation, {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "edit" },
    evidenceStrength: "weak",
    subject: "tool",
    evidenceLoss: "absent",
    recoveryHint: "request_evidence",
    provenance: { origin: "semantic_evidence", authority: "explicit" },
    consequenceBaseline: "medium",
  });
  assert.equal(input.semanticEvidence?.confidence, "high");
  assert.equal(input.semanticEvidence?.strength, "weak");
  assert.equal(hasLimitedFailureStatusJudgmentInput(input), true);
  assert.equal(hasLimitedFailureStatusSemantics(candidate), true);
  assert.equal(hasOutcomeOnlyFailureStatusJudgmentInput(input), false);
});

test("high-consequence empty failed payloads do not become limited failures", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:empty-failure-high-risk",
    taskId: "task:judgment-input:empty-failure-high-risk",
    timestamp,
    type: "task.updated",
    title: "prod deploy failure",
    summary: "{}",
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "bash",
      consequence: "high",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });

  assert.equal(Object.hasOwn(input, "failureEvidence"), false);
  assert.equal(input.observation?.kind, "outcome");
  assert.equal(input.observation?.semanticAgreement, "uncertain");
  assert.equal(input.observation?.evidenceLoss, "absent");
  assert.equal(input.semanticEvidence?.strength, "strong");
  assert.equal(hasLimitedFailureStatusJudgmentInput(input), false);
});

test("judgment input keeps unclassified failure observations stable when semantic failure agrees", () => {
  const base = {
    id: "evt:judgment-input:unclassified-failure",
    taskId: "task:judgment-input:unclassified-failure",
    timestamp,
    type: "task.updated" as const,
    title: "Build failed again",
    summary: "The build failed again.",
    status: "failed" as const,
    semantic: {
      intentFrame: "failure" as const,
      activityClass: "tool_failure" as const,
      consequence: "high" as const,
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high" as const,
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred" as const,
        activityClass: "inferred" as const,
        consequence: "inferred" as const,
        whyNow: "inferred" as const,
        confidence: "inferred" as const,
      },
    },
  };
  const input = buildAttentionJudgmentInput(base);
  const mismatchedInput = buildAttentionJudgmentInput({
    ...base,
    id: "evt:judgment-input:unclassified-failure-mismatch",
    semantic: {
      ...base.semantic,
      consequence: "medium",
    },
  });
  const overriddenInput = buildAttentionJudgmentInput({
    ...base,
    id: "evt:judgment-input:unclassified-failure-override",
    semantic: {
      ...base.semantic,
      provenance: {
        ...base.semantic.provenance,
        intentFrame: "source",
      },
    },
  });

  assert.equal(Object.hasOwn(input, "failureEvidence"), false);
  assert.equal(input.observation?.kind, "unknown");
  assert.equal(input.observation?.polarity, "failure");
  assert.equal(input.observation?.evidenceLoss, "unknown");
  assert.equal(input.observation?.recoveryHint, "inspect_original_evidence");
  assert.equal(input.observation?.semanticAgreement, "stable");
  assert.equal(input.observation?.consequenceBaseline, "high");
  assert.equal(mismatchedInput.observation?.semanticAgreement, "uncertain");
  assert.equal(overriddenInput.observation?.semanticAgreement, "overridden");
});

test("judgment input treats read source-window limits as strong limited failures", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:read-source-window-limit",
    taskId: "task:judgment-input:read-source-window-limit",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary:
      "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    status: "failed",
    toolFamily: "read",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "read",
      consequence: "medium",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const candidate = {
    taskId: "task:judgment-input:read-source-window-limit",
    interactionId: "interaction:judgment-input:read-source-window-limit",
    mode: "status" as const,
    tone: "focused" as const,
    consequence: "medium" as const,
    title: "read failure",
    responseSpec: { kind: "acknowledge" as const },
    priority: "normal" as const,
    blocking: false,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(Object.hasOwn(input, "failureEvidence"), false);
  assert.deepEqual(input.observation, {
    kind: "diagnostic",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "read" },
    evidenceStrength: "strong",
    subject: "source",
    evidenceLoss: "partial",
    diagnosticClass: "source_limit",
    recoveryHint: "narrow_evidence_scope",
    provenance: { origin: "semantic_evidence", authority: "explicit" },
    consequenceBaseline: "medium",
  });
  assert.equal(input.semanticEvidence?.confidence, "high");
  assert.equal(input.semanticEvidence?.strength, "strong");
  assert.equal(hasLimitedFailureStatusJudgmentInput(input), true);
  assert.equal(hasLimitedFailureStatusSemantics(candidate), true);
  assert.equal(hasOutcomeOnlyFailureStatusJudgmentInput(input), false);
});

test("judgment input keeps diagnostic and low-confidence failures out of outcome-only routing", () => {
  const diagnosticInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:diagnostic-failure",
    taskId: "task:judgment-input:diagnostic-failure",
    timestamp,
    type: "task.updated",
    title: "exec_command failure",
    summary: '{"exit_code":2,"wall_time":"0.0510 seconds","output":"sh: foo: command not found"}',
    status: "failed",
    toolFamily: "exec_command",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "exec_command",
      consequence: "high",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const truncatedInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:truncated-outcome-only-failure",
    taskId: "task:judgment-input:truncated-outcome-only-failure",
    timestamp,
    type: "task.updated",
    title: "exec_command failure",
    summary: '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)"}',
    status: "failed",
    toolFamily: "exec_command",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      toolFamily: "exec_command",
      consequence: "high",
      whyNow: "Work has failed and should be reviewed.",
      factors: ["task.updated", "failed", "source evidence truncated"],
      relationHints: [],
      confidence: "low",
      reasons: ["source failure evidence was truncated before Aperture saw the full output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "hint",
        whyNow: "inferred",
        confidence: "hint",
        toolFamily: "source",
      },
    },
  });

  assert.equal(Object.hasOwn(diagnosticInput, "failureEvidence"), false);
  assert.equal(diagnosticInput.observation?.kind, "diagnostic");
  assert.equal(diagnosticInput.observation?.semanticAgreement, "stable");
  assert.equal(diagnosticInput.observation?.diagnosticClass, "runtime");
  assert.equal(diagnosticInput.observation?.recoveryHint, "inspect_diagnostic");
  assert.equal(hasOutcomeOnlyFailureStatusJudgmentInput(diagnosticInput), false);
  assert.equal(Object.hasOwn(truncatedInput, "failureEvidence"), false);
  assert.equal(truncatedInput.observation?.kind, "outcome");
  assert.equal(truncatedInput.observation?.semanticAgreement, "uncertain");
  assert.equal(truncatedInput.observation?.evidenceStrength, "weak");
  assert.equal(hasOutcomeOnlyFailureStatusJudgmentInput(truncatedInput), false);
});

test("judgment input marks routine observational failed-status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:routine-observation-conflict",
    taskId: "task:judgment-input:routine-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const candidate = {
    taskId: "task:judgment-input:routine-observation-conflict",
    interactionId: "interaction:judgment-input:routine-observation-conflict",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "bash failure",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.deepEqual(input.observationalStatusConflict, {
    kind: "command_success_observation",
    toolFamily: "bash",
    baselineConsequence: "low",
  });
  assert.deepEqual(input.observation, {
    kind: "outcome",
    polarity: "success",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "bash" },
    evidenceStrength: "qualified",
    subject: "command",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: "inferred" },
    consequenceBaseline: "low",
  });
  assert.equal(input.semanticEvidence?.strength, "qualified");
  assert.equal(hasRoutineObservationalStatusConflictSemantics(candidate), true);
});

test("judgment input derives routine status conflicts from typed observations, not factors", () => {
  const base = {
    id: "evt:judgment-input:factor-independent-observation-conflict",
    taskId: "task:judgment-input:factor-independent-observation-conflict",
    timestamp,
    type: "task.updated" as const,
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed" as const,
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update" as const,
      activityClass: "status_update" as const,
      toolFamily: "bash",
      consequence: "low" as const,
      factors: ["task.updated", "failed", "renamed_observation_factor"],
      relationHints: [],
      confidence: "high" as const,
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  };

  const observationInput = buildAttentionJudgmentInput(base);
  assert.equal(observationInput.routineObservationalStatusConflict, true);
  assert.equal(observationInput.observationalStatusConflict?.kind, "command_success_observation");
  assert.equal(observationInput.observation?.kind, "outcome");
  assert.equal(observationInput.observation?.polarity, "success");
  assert.equal(observationInput.observation?.semanticAgreement, "stable");
  assert.equal(
    buildAttentionJudgmentInput({
      ...base,
      summary: "Error: deployment failed with exit code 1.",
      semantic: {
        ...base.semantic,
        factors: ["task.updated", "failed", "observational_failure"],
      },
    }).routineObservationalStatusConflict,
    undefined,
  );
  assert.equal(
    buildAttentionJudgmentInput({
      ...base,
      summary: "Error: deployment failed with exit code 1.",
      semantic: {
        ...base.semantic,
        factors: ["task.updated", "failed", "observational_failure"],
      },
    }).observationalStatusConflict,
    undefined,
  );
});

test("judgment input marks engine-owned non-bash observations as status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:read-observation-conflict",
    taskId: "task:judgment-input:read-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary: "Observation path /var/log/system.log showing first 20 lines",
    status: "failed",
    toolFamily: "read",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "read",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.deepEqual(input.observationalStatusConflict, {
    kind: "payload_observation",
    toolFamily: "read",
    baselineConsequence: "low",
  });
  assert.equal(input.observation?.kind, "payload");
  assert.equal(input.observation?.polarity, "neutral");
  assert.equal(input.observation?.semanticAgreement, "stable");
  assert.equal(input.observation?.ownership.toolFamily, "read");
  assert.equal(input.observation?.consequenceBaseline, "low");
  assert.equal(input.semanticEvidence?.strength, "qualified");
});

test("judgment input marks absent-family observation transcripts as status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:missing-tool-observation-conflict",
    taskId: "task:judgment-input:missing-tool-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3 2 import sys",
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "high",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
      },
    },
  });

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.deepEqual(input.observationalStatusConflict, {
    kind: "payload_observation",
    baselineConsequence: "high",
  });
  assert.equal(input.observation?.kind, "payload");
  assert.equal(input.observation?.polarity, "neutral");
  assert.equal(input.observation?.semanticAgreement, "stable");
  assert.equal(input.observation?.consequenceBaseline, "high");
  assert.equal(input.ontology?.source, "inferred");
  assert.equal(input.ontology?.activity, "task_progress");
  assert.equal(input.ontology?.consequence, "high");
  assert.equal(input.ontology && "toolFamily" in input.ontology, false);
  assert.equal(input.semanticEvidence?.strength, "qualified");
});

test("judgment input marks low missing-tool transcript subclasses only on typed observation agreement", () => {
  for (const [id, summary] of [
    ["successful-test", successfulTestObservationTranscript],
    ["abbreviated-file-view", abbreviatedFileViewObservationTranscript],
    ["procedural-harness", proceduralHarnessObservationTranscript],
  ] as const) {
    const input = buildAttentionJudgmentInput({
      id: `evt:judgment-input:${id}-observation-conflict`,
      taskId: `task:judgment-input:${id}-observation-conflict`,
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary,
      status: "failed",
      semantic: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high",
        reasons: ["task status indicates failure but the update reads like observational output"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          confidence: "inferred",
        },
      },
    });

    assert.equal(input.routineObservationalStatusConflict, true);
    assert.deepEqual(input.observationalStatusConflict, {
      kind: "payload_observation",
      baselineConsequence: "low",
    });
    assert.equal(input.observation?.kind, "payload");
    assert.equal(input.observation?.polarity, "neutral");
    assert.equal(input.observation?.semanticAgreement, "stable");
    assert.equal(input.observation?.consequenceBaseline, "low");
    assert.equal(input.ontology?.source, "inferred");
    assert.equal(input.ontology?.activity, "task_progress");
    assert.equal(input.ontology?.consequence, "low");
    assert.equal(input.ontology && "toolFamily" in input.ontology, false);
    assert.equal(input.semanticEvidence?.strength, "qualified");
  }

  const mismatchedFamilyInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:hinted-successful-test-observation-conflict",
    taskId: "task:judgment-input:hinted-successful-test-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: successfulTestObservationTranscript,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic hint claimed bash ownership"],
    },
  });
  const liftedConsequenceInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:lifted-successful-test-observation-conflict",
    taskId: "task:judgment-input:lifted-successful-test-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: successfulTestObservationTranscript,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "high",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic consequence was lifted"],
    },
  });

  assert.equal(mismatchedFamilyInput.routineObservationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.routineObservationalStatusConflict, undefined);
  assert.equal(mismatchedFamilyInput.observationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.observationalStatusConflict, undefined);

  const mixedFailureInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:mixed-procedural-failure",
    taskId: "task:judgment-input:mixed-procedural-failure",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: mixedProceduralFailureObservationTranscript,
    status: "failed",
    semantic: {
      intentFrame: "failure",
      activityClass: "tool_failure",
      consequence: "high",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure"],
    },
  });

  assert.equal(mixedFailureInput.routineObservationalStatusConflict, undefined);
  assert.equal(mixedFailureInput.observationalStatusConflict, undefined);
  assert.equal(Object.hasOwn(mixedFailureInput, "failureEvidence"), false);
  assert.equal(mixedFailureInput.observation?.kind, "diagnostic");
  assert.equal(mixedFailureInput.observation?.diagnosticClass, "runtime");
});

test("judgment input marks tool-use rejection outcomes as status conflicts only on typed observation agreement", () => {
  const bashInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:bash-tool-use-rejection",
    taskId: "task:judgment-input:bash-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  });
  const absentInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:absent-tool-use-rejection",
    taskId: "task:judgment-input:absent-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  });
  const mismatchedInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:mismatched-tool-use-rejection",
    taskId: "task:judgment-input:mismatched-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "edit",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic hint claimed edit ownership"],
    },
  });
  const liftedConsequenceInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:lifted-tool-use-rejection",
    taskId: "task:judgment-input:lifted-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "medium",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic consequence was lifted"],
    },
  });

  assert.equal(bashInput.routineObservationalStatusConflict, true);
  assert.equal(absentInput.routineObservationalStatusConflict, true);
  assert.deepEqual(bashInput.observationalStatusConflict, {
    kind: "rejected_tool_use_observation",
    toolFamily: "bash",
    baselineConsequence: "low",
  });
  assert.deepEqual(bashInput.observation, {
    kind: "control",
    polarity: "neutral",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "bash" },
    evidenceStrength: "qualified",
    subject: "tool",
    evidenceLoss: "none",
    recoveryHint: "await_authorization",
    provenance: { origin: "status_text", authority: "inferred" },
    consequenceBaseline: "low",
  });
  assert.deepEqual(absentInput.observationalStatusConflict, {
    kind: "rejected_tool_use_observation",
    baselineConsequence: "low",
  });
  assert.equal(mismatchedInput.routineObservationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.routineObservationalStatusConflict, undefined);
  assert.equal(mismatchedInput.observationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.observationalStatusConflict, undefined);
});

test("judgment input gives hinted relation semantics their own continuity strength", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:relation-hint",
    taskId: "task:judgment-input:relation-hint",
    interactionId: "interaction:judgment-input:relation-hint",
    timestamp,
    type: "human.input.requested",
    title: "Approve rollback instead",
    summary: "Use the rollback plan instead for the same deploy.",
    request: { kind: "approval" },
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "high",
      whyNow: "A high-risk action needs explicit operator approval.",
      factors: ["human.input.requested", "approval"],
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:prod" },
        { kind: "supersedes", target: "issue:deploy:prod" },
      ],
      confidence: "low",
      reasons: ["request kind establishes an explicit operator decision point"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        relationHints: "hint",
      },
    },
  });

  const candidate = {
    taskId: "task:judgment-input:relation-hint",
    interactionId: "interaction:judgment-input:relation-hint",
    mode: "approval" as const,
    tone: "critical" as const,
    consequence: "high" as const,
    title: "Approve rollback instead",
    responseSpec: { kind: "approval" as const, actions: [] },
    priority: "high" as const,
    blocking: true,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(input.semanticEvidence?.strength, "weak");
  assert.equal(input.relationEvidence?.source, "hinted");
  assert.equal(input.relationEvidence?.strength, "qualified");
  assert.equal(readSemanticRelationEvidenceStrength(candidate), "qualified");
});

test("judgment-input helpers preserve the blocked-like status peripheral floor", () => {
  const candidate = {
    taskId: "task:blocked-like",
    interactionId: "interaction:blocked-like",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "Cannot continue until credentials are provided",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: buildAttentionJudgmentInput({
      id: "evt:judgment-input:blocked-like-floor",
      taskId: "task:blocked-like",
      timestamp,
      type: "task.updated",
      title: "Cannot continue until credentials are provided",
      summary: "Work is waiting but cannot proceed until the operator provides credentials.",
      status: "waiting",
      semantic: {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        consequence: "low",
        whyNow: "Work is blocked and may require operator attention.",
        factors: ["task.updated", "waiting", "semantic blocking signal"],
        relationHints: [],
        confidence: "medium",
        reasons: ["status wording indicates work cannot continue yet"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          whyNow: "inferred",
          confidence: "inferred",
        },
      },
    }),
  };

  assert.equal(hasBlockedLikeStatusSemantics(candidate), true);
  assert.equal(hasActionableBlockedLikeStatusSemantics(candidate), true);
  assert.equal(readSemanticEvidenceStrength(candidate), "weak");
  assert.equal(resolvePeripheralResolutionFloor(candidate, "ambient"), "queue");
});

test("judgment-input does not treat low-confidence blocked-like status as actionable", () => {
  const candidate = {
    taskId: "task:blocked-like-low",
    interactionId: "interaction:blocked-like-low",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "Might be waiting",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: {
      blockedLikeStatus: true,
      semanticEvidence: {
        confidence: "low" as const,
        source: "inferred" as const,
        strength: "weak" as const,
        abstained: false,
      },
    },
  };

  assert.equal(hasBlockedLikeStatusSemantics(candidate), true);
  assert.equal(hasActionableBlockedLikeStatusSemantics(candidate), false);
});
