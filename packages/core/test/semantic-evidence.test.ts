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

test("semantic text evidence handles terminal polarity conservatively", () => {
  const exitCodeZero = readSemanticTextEvidence("bash failure Process exited with code 0.", "bash");
  const exitCodeZeroWithIssue = readSemanticTextEvidence(
    "bash failure Tests failed. Process exited with code 0.",
    "bash",
  );
  const exitCodeZeroWithConnector = readSemanticTextEvidence(
    "bash failure Process exit code was 0.",
    "bash",
  );
  const jsonExitCodeZero = readSemanticTextEvidence(
    '{"exit_code":0,"wall_time":"0 seconds","output":"ok"}',
    "bash",
  );
  const nonzeroExitCode = readSemanticTextEvidence(
    "bash failure Process exited with code 2.",
    "bash",
  );
  const nonzeroExitCodeWithConnector = readSemanticTextEvidence(
    "bash failure Process exit code was 2.",
    "bash",
  );
  const jsonNonzeroExitCode = readSemanticTextEvidence(
    '{"exit_code":1,"output":"Traceback (most recent call last): RuntimeError"}',
    "bash",
  );
  const negatedException = readSemanticTextEvidence("OBSERVATION: No exception occurred.", "bash");
  const expectedException = readSemanticTextEvidence(
    "OBSERVATION: Expected exception was caught.",
    "bash",
  );
  const realTraceback = readSemanticTextEvidence(
    "OBSERVATION: No exception occurred earlier. Traceback follows from retry.",
    "bash",
  );
  const benignThenRealException = readSemanticTextEvidence(
    "OBSERVATION: No exception occurred during setup; an exception escaped during cleanup.",
    "bash",
  );
  const benignThenRealPermissionDenied = readSemanticTextEvidence(
    "OBSERVATION: No permission denied during setup; deploy failed: permission denied.",
    "bash",
  );

  assert.equal(exitCodeZero.routineSuccessObservation, true);
  assert.equal(exitCodeZero.terminalFailureEvidence, false);
  assert.equal(exitCodeZeroWithIssue.routineSuccessObservation, false);
  assert.equal(exitCodeZeroWithIssue.terminalFailureEvidence, true);
  assert.equal(exitCodeZeroWithConnector.routineSuccessObservation, true);
  assert.equal(exitCodeZeroWithConnector.terminalFailureEvidence, false);
  assert.equal(jsonExitCodeZero.routineSuccessObservation, true);
  assert.equal(jsonExitCodeZero.terminalFailureEvidence, false);
  assert.equal(nonzeroExitCode.routineSuccessObservation, false);
  assert.equal(nonzeroExitCode.terminalFailureEvidence, true);
  assert.equal(nonzeroExitCodeWithConnector.routineSuccessObservation, false);
  assert.equal(nonzeroExitCodeWithConnector.terminalFailureEvidence, true);
  assert.equal(jsonNonzeroExitCode.routineSuccessObservation, false);
  assert.equal(jsonNonzeroExitCode.terminalFailureEvidence, true);
  assert.equal(negatedException.expectedDiagnosticFailure, true);
  assert.equal(negatedException.terminalFailureEvidence, false);
  assert.equal(expectedException.expectedDiagnosticFailure, true);
  assert.equal(expectedException.terminalFailureEvidence, false);
  assert.equal(realTraceback.expectedDiagnosticFailure, false);
  assert.equal(realTraceback.terminalFailureEvidence, true);
  assert.equal(benignThenRealException.expectedDiagnosticFailure, false);
  assert.equal(benignThenRealException.terminalFailureEvidence, true);
  assert.equal(benignThenRealPermissionDenied.terminalFailureEvidence, true);
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

test("task failure evidence separates zero exit and expected diagnostics from terminal failures", () => {
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exit-zero",
      taskId: "task:evidence:exit-zero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Process exited with code 0.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "routine_bash_success_observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:no-exception",
      taskId: "task:evidence:no-exception",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "No exception occurred.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "expected_diagnostic_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:json-exit-zero",
      taskId: "task:evidence:json-exit-zero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"exit_code":0,"wall_time":"0 seconds","output":"ok"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "low",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:expected-exception",
      taskId: "task:evidence:expected-exception",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Expected exception was caught.",
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:nonzero-exit",
      taskId: "task:evidence:nonzero-exit",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Process exited with code 2.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:zero-exit-with-failed-tests",
      taskId: "task:evidence:zero-exit-with-failed-tests",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Tests failed. Process exited with code 0.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:nonzero-exit-connector",
      taskId: "task:evidence:nonzero-exit-connector",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Process exit code was 2.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
  );
});

test("task failure evidence classifies structured tool output without treating it as success", () => {
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-output",
      taskId: "task:evidence:structured-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"Collected 42 rows from the benchmark."}',
      status: "failed",
      toolFamily: "bash",
    }),
    {
      kind: "unclassified_failure",
      toolFamily: "bash",
      readsAsObservation: false,
      consequenceBaseline: "high",
      text: {
        routineSuccessObservation: false,
        terminalFailureEvidence: false,
        expectedDiagnosticFailure: false,
        observationalReadback: false,
        taggedFileObservation: false,
        readObservationPayload: false,
        searchResultOutput: false,
        sourceCodeObservation: false,
        logObservation: false,
        buildMetadataObservation: false,
      },
    },
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-source-output",
      taskId: "task:evidence:structured-source-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdexcept>\\nint main() { throw new Error(); return 0; }"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "structured source output should stay a high-consequence observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-string-zero-exit",
      taskId: "task:evidence:structured-string-zero-exit",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"exit_code":"0","wall_time":"0.0510 seconds","output":"ok"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "routine_bash_success_observation",
    "structured zero exit should stay routine success",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-nonzero-source-output",
      taskId: "task:evidence:structured-nonzero-source-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":"2","wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured nonzero exit should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-traceback",
      taskId: "task:evidence:structured-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Traceback (most recent call last): RuntimeError"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured traceback should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-failed-tests",
      taskId: "task:evidence:structured-failed-tests",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"Tests failed: 3 assertions failed."}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured failed tests should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-npm-error",
      taskId: "task:evidence:structured-npm-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"npm ERR! code EACCES"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured package-manager errors should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-compiler-error",
      taskId: "task:evidence:structured-compiler-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"src/main.cc:42:7: error: use of undeclared identifier x"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured compiler errors should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-node-error",
      taskId: "task:evidence:structured-node-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Error: connect ECONNREFUSED 127.0.0.1:5432"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured Node connection errors should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-rust-panic",
      taskId: "task:evidence:structured-rust-panic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"thread main panicked at index out of bounds"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured Rust panics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-git-fatal",
      taskId: "task:evidence:structured-git-fatal",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"fatal: repository not found"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured git fatal errors should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-unshaped-output",
      taskId: "task:evidence:structured-unshaped-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"hello world"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "a structured wrapper alone should not downgrade failed status",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-positive-prefix-real-failure",
      taskId: "task:evidence:structured-positive-prefix-real-failure",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Loaded configuration, then request failed because the service rejected it"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "positive structured prefixes must not hide later failure wording",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-operation-not-permitted",
      taskId: "task:evidence:structured-operation-not-permitted",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"rm: /protected/file: Operation not permitted"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "prefixed operation-permission failures should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-source-plus-traceback",
      taskId: "task:evidence:structured-source-plus-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }\\nTraceback (most recent call last): RuntimeError"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured source plus traceback should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-source-plus-test-failed",
      taskId: "task:evidence:structured-source-plus-test-failed",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }\\ntest failed: expected 1"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured source plus singular test failure should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-source-plus-negative-exit",
      taskId: "task:evidence:structured-source-plus-negative-exit",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }\\nprocess exited with code -1"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured source plus negative exit should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-structured-source",
      taskId: "task:evidence:truncated-structured-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#!/usr/bin/env python3\\nimport torch\\nfrom pathlib import Path',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "truncated structured source output should become observational evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-structured-nonzero",
      taskId: "task:evidence:truncated-structured-nonzero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":2,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "truncated structured nonzero exit should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:marked-truncated-structured-source",
      taskId: "task:evidence:marked-truncated-structured-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }...","truncated":true}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "marked truncated source output should become observational evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:marked-truncated-structured-nonzero",
      taskId: "task:evidence:marked-truncated-structured-nonzero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":2,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }...","truncated":true}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "marked truncated nonzero exit should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:marked-truncated-loader-error",
      taskId: "task:evidence:marked-truncated-loader-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"library load error: libbitsandbytes_cpu.so: cannot open shared object file...","truncated":true}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "marked truncated visible diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-structured-loader-error",
      taskId: "task:evidence:truncated-structured-loader-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"4.5 seconds","output":"library load error: libbitsandbytes_cpu.so: cannot open shared object file',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "truncated structured loader diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-structured-neutral",
      taskId: "task:evidence:truncated-structured-neutral",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"Collected 42 rows from the benchmark',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "truncated structured neutral output should not downgrade failed status",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-output-only-source",
      taskId: "task:evidence:truncated-output-only-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "output-only recovery is allowed for strong source-shaped payloads",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-output-first-nonzero",
      taskId: "task:evidence:truncated-output-first-nonzero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts","exit_code":2',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "visible output-first nonzero exit metadata remains terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-output-first-invalid-wall-time",
      taskId: "task:evidence:truncated-output-first-invalid-wall-time",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts","wall_time":"later"',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "visible output-first invalid wall time blocks recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-output-first-unknown-key",
      taskId: "task:evidence:truncated-output-first-unknown-key",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts","status":"ok"',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "visible output-first unknown fields block recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-wall-exit-output-source",
      taskId: "task:evidence:truncated-wall-exit-output-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","exit_code":0,"output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "permuted wall-time and exit-code prefixes can recover source-shaped output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-output-only-plain",
      taskId: "task:evidence:truncated-output-only-plain",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"output":"hello world',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "output-only recovery should not classify plain text wrappers",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:complete-output-only-source",
      taskId: "task:evidence:complete-output-only-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "complete JSON output-only wrappers are not repaired as structured envelopes",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:output-embedded-exit-code",
      taskId: "task:evidence:output-embedded-exit-code",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"output":"{\\"exit_code\\":0,\\"output\\":\\"ok\\"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "exit_code text inside output should not count as envelope metadata",
  );
  for (const [id, summary] of [
    ["truncated-empty-output-zero-exit", '{"exit_code":0,"wall_time":"0.0510 seconds","output":"'],
    [
      "truncated-whitespace-output-zero-exit",
      '{"exit_code":0,"wall_time":"0.0510 seconds","output":"   ',
    ],
    [
      "truncated-invalid-wall-time-zero-exit",
      '{"exit_code":0,"wall_time":"later","output":"#include <stdio.h>',
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary,
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "unclassified_failure",
      `${id} should not become routine success`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-structured-extra-key",
      taskId: "task:evidence:truncated-structured-extra-key",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"status":"failed","wall_time":"0.0510 seconds","output":"#include <stdio.h>',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "truncated recovery should not repair arbitrary JSON-like payloads",
  );
});

test("task failure evidence keeps invalid structured output high and unclassified", () => {
  for (const [id, summary] of [
    ["malformed-json", '{"wall_time":"0.1 seconds","output":"ok"'],
    ["array-json", '["0.1 seconds", "ok"]'],
    ["missing-output", '{"wall_time":"0.1 seconds"}'],
    ["wrong-output-type", '{"wall_time":"0.1 seconds","output":12}'],
    ["wrong-wall-time-type", '{"wall_time":0.1,"output":"ok"}'],
    ["empty-wall-time", '{"wall_time":"","output":"ok"}'],
    ["arbitrary-wall-time", '{"wall_time":"later","output":"ok"}'],
    ["trailing-wall-time", '{"wall_time":"0.1 seconds later","output":"ok"}'],
    ["invalid-exit-code", '{"exit_code":"ok","wall_time":"0.1 seconds","output":"ok"}'],
    ["extra-status-key", '{"status":"failed","wall_time":"0.1 seconds","output":"ok"}'],
    [
      "extra-status-key-zero-exit",
      '{"status":"ok","exit_code":0,"wall_time":"0.1 seconds","output":"patch applied successfully"}',
    ],
    [
      "marked-truncated-output-without-wall-time",
      '{"exit_code":0,"output":"patch applied successfully","truncated":true}',
    ],
    [
      "marked-truncated-extra-key",
      '{"exit_code":0,"wall_time":"0.1 seconds","output":"#include <stdio.h>","status":"ok","truncated":true}',
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary,
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "unclassified_failure",
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:empty-object",
      taskId: "task:evidence:empty-object",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "{}",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "empty_failure_payload",
    "empty payloads should be classified but not downgraded",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:empty-object-unknown-tool",
      taskId: "task:evidence:empty-object-unknown-tool",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "{}",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "empty payload classification requires explicit tool-family evidence",
  );
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
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source",
      taskId: "task:evidence:raw-read-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '#include <stdexcept>\nint main() { throw new Error("permission denied"); return 0; }',
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-quoted-terminal-literal",
      taskId: "task:evidence:raw-read-source-quoted-terminal-literal",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '#include <stdio.h>\nconst char *message = "no such file or directory";\nint main() { return 0; }',
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-runtime-error-literal",
      taskId: "task:evidence:raw-read-source-runtime-error-literal",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '#include <stdio.h>\nconst char *message = "RuntimeError";\nint main() { return 0; }',
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-status-error-literal",
      taskId: "task:evidence:raw-read-source-status-error-literal",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '#include <stdio.h>\nconst char *message = "status: error";\nint main() { return 0; }',
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-traceback",
      taskId: "task:evidence:raw-read-source-plus-traceback",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "#include <stdexcept>\nint main() { return 0; }\nTraceback (most recent call last): RuntimeError",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-cpp-crash",
      taskId: "task:evidence:raw-read-source-plus-cpp-crash",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "#include <stdexcept>\nint main() { return 0; }\nterminate called after throwing an instance of 'std::runtime_error'",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-permission-denied",
      taskId: "task:evidence:raw-read-source-plus-permission-denied",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "#include <stdexcept>\nint main() { return 0; }\nPermission denied",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-operation-not-permitted",
      taskId: "task:evidence:raw-read-source-plus-operation-not-permitted",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "#include <stdexcept>\nint main() { return 0; }\nrm: /protected/file: Operation not permitted",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-uncaught-exception",
      taskId: "task:evidence:raw-read-source-plus-uncaught-exception",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "#include <stdexcept>\nint main() { return 0; }\nUncaught exception: RuntimeError",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-source-plus-compiler-error",
      taskId: "task:evidence:raw-read-source-plus-compiler-error",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "#include <stdio.h>\nint main() { return 0; }\nsrc/main.cc:42:7: error: use of undeclared identifier x",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:single-source-keyword",
      taskId: "task:evidence:single-source-keyword",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "return",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
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
    })?.readsAsObservation,
    true,
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-output",
      taskId: "task:evidence:web-search-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        'Web search results for "llvm 14 intrinsic round": LLVM includes constrained rounding intrinsics.',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-query-network-error",
      taskId: "task:evidence:web-search-query-network-error",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        'Web search results for "network error": troubleshooting guides and protocol references.',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-network-error-content",
      taskId: "task:evidence:web-search-network-error-content",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: 'Web search results for "network error": A network error occurs when packets drop.',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure",
      taskId: "task:evidence:web-search-backend-failure",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query failed because the backend is unavailable.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-network-failure",
      taskId: "task:evidence:web-search-network-failure",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query could not be retrieved due to a network error.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-colon-request-failure",
      taskId: "task:evidence:web-search-colon-request-failure",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: request failed due to a network error.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-quoted-colon-backend-failure",
      taskId: "task:evidence:web-search-quoted-colon-backend-failure",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: 'Web search results for "query": backend is unavailable.',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure-colon-payload",
      taskId: "task:evidence:web-search-backend-failure-colon-payload",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable: retry later.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure-comma-payload",
      taskId: "task:evidence:web-search-backend-failure-comma-payload",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable, retry later.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure-hyphen-payload",
      taskId: "task:evidence:web-search-backend-failure-hyphen-payload",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable - retry later.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure-paren-payload",
      taskId: "task:evidence:web-search-backend-failure-paren-payload",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable (retry later).",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-failure-newline-payload",
      taskId: "task:evidence:web-search-backend-failure-newline-payload",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable\nRetry later.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-unavailable-content",
      taskId: "task:evidence:web-search-backend-unavailable-content",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        'Web search results for "backend unavailable": Backend unavailable pages should return HTTP 503.',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-unavailable-handling",
      taskId: "task:evidence:web-search-backend-unavailable-handling",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable handling request.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-unavailable-response",
      taskId: "task:evidence:web-search-backend-unavailable-response",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable response from upstream.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-search-backend-unavailable-message",
      taskId: "task:evidence:web-search-backend-unavailable-message",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Web search results for query: Backend unavailable message from provider.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "terminal_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:grep-context-output",
      taskId: "task:evidence:grep-context-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "2126-| S_MIN_F32 | S_CMP_LE_F32 |\n2127-| S_MAX_F32 | S_CMP_GT_F32 |",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:inline-grep-context-output",
      taskId: "task:evidence:inline-grep-context-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "2126-| S_MIN_F32 | S_CMP_LE_F32 | 2127-| S_MAX_F32 | S_CMP_GT_F32 |",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:search-result-terminal-content",
      taskId: "task:evidence:search-result-terminal-content",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: 'Web search results for "tests failed": tests failed in /repo/src/app.test.ts.',
      status: "failed",
      toolFamily: "search",
    }),
    {
      kind: "routine_search_output",
      toolFamily: "search",
      readsAsObservation: true,
      consequenceBaseline: "high",
      text: {
        routineSuccessObservation: false,
        terminalFailureEvidence: true,
        expectedDiagnosticFailure: false,
        observationalReadback: false,
        taggedFileObservation: false,
        readObservationPayload: false,
        searchResultOutput: true,
        sourceCodeObservation: true,
        logObservation: false,
        buildMetadataObservation: false,
      },
    },
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:grep-false-positive",
      taskId: "task:evidence:grep-false-positive",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "Search backend unavailable; retry windows 2- pending and 3- aborted.",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "unclassified_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:single-grep-line",
      taskId: "task:evidence:single-grep-line",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "2126-| S_MIN_F32 | S_CMP_LE_F32 |",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "unclassified_failure",
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

test("observational status-conflict evidence includes structured, read, and search observations", () => {
  assert.equal(
    hasRoutineObservationalStatusConflictSemanticRead(
      {
        id: "evt:evidence:structured-observation-conflict",
        taskId: "task:evidence:structured-observation-conflict",
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary:
          '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
        status: "failed",
        toolFamily: "bash",
      },
      {
        intentFrame: "status_update" as const,
        activityClass: "status_update" as const,
        toolFamily: "bash",
        consequence: "high" as const,
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["task status indicates failure but the update reads like observational output"],
      },
    ),
    true,
  );
  assert.equal(
    hasRoutineObservationalStatusConflictSemanticRead(
      {
        id: "evt:evidence:read-observation-conflict",
        taskId: "task:evidence:read-observation-conflict",
        timestamp,
        type: "task.updated",
        title: "read failure",
        summary: "#include <stdio.h>\nint main() { return 0; }",
        status: "failed",
        toolFamily: "read",
      },
      {
        intentFrame: "status_update" as const,
        activityClass: "status_update" as const,
        toolFamily: "read",
        consequence: "high" as const,
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["task status indicates failure but the update reads like observational output"],
      },
    ),
    true,
  );
  assert.equal(
    hasRoutineObservationalStatusConflictSemanticRead(
      {
        id: "evt:evidence:search-observation-conflict",
        taskId: "task:evidence:search-observation-conflict",
        timestamp,
        type: "task.updated",
        title: "search failure",
        summary:
          'Web search results for "llvm 14 intrinsic round": LLVM includes constrained rounding intrinsics.',
        status: "failed",
        toolFamily: "search",
      },
      {
        intentFrame: "status_update" as const,
        activityClass: "status_update" as const,
        toolFamily: "search",
        consequence: "low" as const,
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["task status indicates failure but the update reads like observational output"],
      },
    ),
    true,
  );
});

test("observational status-conflict evidence includes truncated structural output observations", () => {
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-zero-exit",
      taskId: "task:evidence:truncated-zero-exit",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0 seconds","output":"dict[str, torch.Tensor]\\nA dictionary containing converted weights.',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "routine_bash_success_observation",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-source-output",
      taskId: "task:evidence:truncated-source-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0509 seconds","output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-edit-output",
      taskId: "task:evidence:truncated-edit-output",
      timestamp,
      type: "task.updated",
      title: "edit failure",
      summary:
        '{"wall_time":"0.0509 seconds","output":"src/kernel.cu:12:__global__ void run() {}\\nsrc/kernel.cu:13:return;',
      status: "failed",
      toolFamily: "edit",
    })?.kind,
    "structured_tool_output_observation",
  );
});

test("observational status-conflict evidence includes structural read documents and logs", () => {
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-markdown-document",
      taskId: "task:evidence:read-markdown-document",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "# Project Guide\n## Build\n1. Configure the project with the documented cache settings\n2. Run the build from a clean directory\n3. Copy the resulting module into the local plugin directory\n```sh\ncmake -B build\ncmake --build build\n```",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-build-log",
      taskId: "task:evidence:read-build-log",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "DKMS make.log for module 1.0\nBuilding module(s)\nchecking for a BSD-compatible install... /usr/bin/install -c check",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-log-filename-only",
      taskId: "task:evidence:read-log-filename-only",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "Could not open /tmp/make.log",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:output-log-filename-only",
      taskId: "task:evidence:output-log-filename-only",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"output":"Could not open pytest run.log',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
  );
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
