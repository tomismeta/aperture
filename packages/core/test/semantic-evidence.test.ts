import assert from "node:assert/strict";
import test from "node:test";

import {
  hasRoutineObservationalStatusConflictSemanticRead,
  readTaskFailureSemanticEvidence,
  readSemanticTextEvidence,
} from "../src/semantic-evidence.js";

const timestamp = "2026-04-05T18:45:00.000Z";

test("semantic text evidence classifies exact routine bash success observations", () => {
  const evidence = readSemanticTextEvidence(
    "OBSERVATION: Your command ran successfully and did not produce any output.",
    "bash",
  );

  assert.equal(evidence.routineSuccessObservation, true);
  assert.equal(evidence.terminalFailureEvidence, false);
});

test("routine success observations stay tool-family bounded", () => {
  const evidence = readSemanticTextEvidence(
    "Your command ran successfully and did not produce any output.",
    "read",
  );

  assert.equal(evidence.routineSuccessObservation, false);
});

test("semantic text evidence separates routine success from terminal failure evidence", () => {
  const traceback = readSemanticTextEvidence(
    "Your command ran successfully and did not produce any output. Traceback follows.",
    "bash",
  );
  const exitCode = readSemanticTextEvidence(
    "Your command ran successfully and did not produce any output. Error: deployment failed with exit code 1.",
    "bash",
  );

  assert.equal(traceback.routineSuccessObservation, false);
  assert.equal(traceback.terminalFailureEvidence, true);
  assert.equal(exitCode.routineSuccessObservation, false);
  assert.equal(exitCode.terminalFailureEvidence, true);
});

test("semantic text evidence classifies readback observations without treating source dumps as routine", () => {
  const log = readSemanticTextEvidence(
    "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
    "read",
  );
  const source = readSemanticTextEvidence(
    "<path>/repo/src/kernel/process.c</path> <type>file</type> <content>1622: static struct process *create_process(void) 1623: { 1624: return 0; }",
    "read",
  );

  assert.equal(log.taggedFileObservation, true);
  assert.equal(log.readObservationPayload, false);
  assert.equal(log.logObservation, true);
  assert.equal(log.sourceCodeObservation, false);
  assert.equal(source.taggedFileObservation, true);
  assert.equal(source.readObservationPayload, true);
  assert.equal(source.sourceCodeObservation, true);
  assert.equal(source.logObservation, false);
});

test("semantic text evidence classifies search outputs and build metadata", () => {
  const search = readSemanticTextEvidence(
    "OBSERVATION: Found 12 matches in 3 files. Showing first 10 results from /repo/src/app.ts",
    "search",
  );
  const buildMetadata = readSemanticTextEvidence(
    "<path>/repo/Makefile</path> <type>file</type> <content>1: SPDX-License-Identifier: GPL-2.0 2: VERSION = 6 3: PATCHLEVEL = 16</content>",
    "read",
  );

  assert.equal(search.searchResultOutput, true);
  assert.equal(buildMetadata.buildMetadataObservation, true);
});

test("semantic text evidence classifies expected diagnostic failure apart from tracebacks", () => {
  const diagnostic = readSemanticTextEvidence(
    "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
    "bash",
  );
  const traceback = readSemanticTextEvidence(
    "OBSERVATION: Form is valid: False. Exception traceback while running the repro.",
    "bash",
  );

  assert.equal(diagnostic.expectedDiagnosticFailure, true);
  assert.equal(diagnostic.terminalFailureEvidence, false);
  assert.equal(traceback.expectedDiagnosticFailure, false);
  assert.equal(traceback.terminalFailureEvidence, true);
});

test("task failure evidence applies terminal evidence before positive observations", () => {
  const evidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:mixed-failure",
    taskId: "task:evidence:mixed-failure",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary:
      "Your command ran successfully and did not produce any output. Error: deployment failed with exit code 1.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(evidence?.kind, "terminal_failure");
  assert.equal(evidence?.readsAsObservation, false);
  assert.equal(evidence?.consequenceBaseline, "high");
});

test("task failure evidence preserves current observational classes", () => {
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:routine-bash",
      taskId: "task:evidence:routine-bash",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "routine_bash_success_observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:diagnostic",
      taskId: "task:evidence:diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "expected_diagnostic_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-log",
      taskId: "task:evidence:read-log",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "<path>/tmp/tool-output/kernel.log</path> <type>file</type> <content>1190: [ 4.998830] amdgpu ring comp_1.2.1 uses VM inv eng 10 on hub 0",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-source",
      taskId: "task:evidence:read-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "<path>/repo/src/kernel/process.c</path> <type>file</type> <content>1622: static struct process *create_process(void) 1623: { 1624: return 0; }",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:search-output",
      taskId: "task:evidence:search-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        "OBSERVATION: Found 12 matches in 3 files. Showing first 10 results from /repo/src/app.ts",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
});

test("task failure evidence uses explicit context tool family without text inference", () => {
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:context-tool",
      taskId: "task:evidence:context-tool",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      context: {
        items: [{ id: "tool_family", label: "Tool Family", value: "bash" }],
      },
    })?.kind,
    "routine_bash_success_observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:inferred-only",
      taskId: "task:evidence:inferred-only",
      timestamp,
      type: "task.updated",
      title: "wants to run shell command",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
    })?.kind,
    "unclassified_failure",
  );
});

test("task failure evidence does not use audit metadata as tool-family evidence", () => {
  const evidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:metadata-tool-family",
    taskId: "task:evidence:metadata-tool-family",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    metadata: { toolFamily: "bash" },
  });

  assert.equal(evidence?.kind, "unclassified_failure");
  assert.equal(evidence?.toolFamily, undefined);
});

test("routine observational status-conflict evidence is a narrow semantic read", () => {
  const semantic = {
    intentFrame: "status_update" as const,
    activityClass: "status_update" as const,
    toolFamily: "bash",
    consequence: "low" as const,
    factors: ["task.updated", "failed", "observational_failure"],
    relationHints: [],
    confidence: "high" as const,
    reasons: ["task status indicates failure but the update reads like observational output"],
  };
  const event = {
    id: "evt:evidence:routine-observation-conflict",
    taskId: "task:evidence:routine-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
  };

  assert.equal(hasRoutineObservationalStatusConflictSemanticRead(event, semantic), true);
  assert.equal(
    hasRoutineObservationalStatusConflictSemanticRead(event, {
      ...semantic,
      confidence: "medium",
    }),
    false,
  );
  assert.equal(
    hasRoutineObservationalStatusConflictSemanticRead(event, {
      ...semantic,
      toolFamily: "read",
    }),
    false,
  );
  assert.equal(hasRoutineObservationalStatusConflictSemanticRead(event, semantic, true), false);
});

test("routine observational status-conflict cannot be created by explanatory factors alone", () => {
  const event = {
    id: "evt:evidence:forged-observation-conflict",
    taskId: "task:evidence:forged-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Error: deployment failed with exit code 1.",
    status: "failed",
    toolFamily: "bash",
  };
  const semantic = {
    intentFrame: "status_update" as const,
    activityClass: "status_update" as const,
    toolFamily: "bash",
    consequence: "low" as const,
    factors: ["task.updated", "failed", "observational_failure"],
    relationHints: [],
    confidence: "high" as const,
    reasons: ["adapter claimed observational output"],
  };

  assert.equal(hasRoutineObservationalStatusConflictSemanticRead(event, semantic), false);
});

test("routine observational status-conflict does not depend on explanatory factor naming", () => {
  const event = {
    id: "evt:evidence:factor-independent-observation-conflict",
    taskId: "task:evidence:factor-independent-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
  };
  const semantic = {
    intentFrame: "status_update" as const,
    activityClass: "status_update" as const,
    toolFamily: "bash",
    consequence: "low" as const,
    factors: ["task.updated", "failed", "renamed_observation_factor"],
    relationHints: [],
    confidence: "high" as const,
    reasons: ["task status indicates failure but the update reads like observational output"],
  };

  assert.equal(hasRoutineObservationalStatusConflictSemanticRead(event, semantic), true);
});
