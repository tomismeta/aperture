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
      id: "evt:evidence:structured-rg-io-error",
      taskId: "task:evidence:structured-rg-io-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log: Input/output error"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured ripgrep IO diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-rg-io-error",
      taskId: "task:evidence:truncated-rg-io-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log: Input/output...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "recovered ripgrep IO diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-rg-io-error",
      taskId: "task:evidence:read-rg-io-error",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log: Input/output error",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "raw reads do not inherit structured tool-output ripgrep diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-rg-io-error-prose",
      taskId: "task:evidence:structured-rg-io-error-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"The note says rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log."}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "ripgrep IO diagnostics must be anchored at the diagnostic line start",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-rg-io-error-source-string",
      taskId: "task:evidence:structured-rg-io-error-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log\\";\\nreturn message;"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "source string literals mentioning ripgrep diagnostics stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-rg-warning",
      taskId: "task:evidence:structured-rg-warning",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"rg: warning: /tmp/dmesg.log was ignored by a glob pattern"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "ripgrep warnings without the IO diagnostic phrase stay unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-grep-io-error",
      taskId: "task:evidence:structured-grep-io-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"grep: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log: Input/output error"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "non-ripgrep prefixes are not promoted by the ripgrep-specific diagnostic",
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
      id: "evt:evidence:truncated-listing-total-lines",
      taskId: "task:evidence:truncated-listing-total-lines",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 106\\n\\nsrc/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "parser-recovered total-output listings should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-doc-listing-total-lines",
      taskId: "task:evidence:truncated-doc-listing-total-lines",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 42\\n\\n/repo/README.md:17:Build the project from a clean checkout',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "parser-recovered doc path listings with total-output markers should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-two-line-listing",
      taskId: "task:evidence:truncated-two-line-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31\\nsrc/runtime/trap_handler.s:72:s_mov_b32 ttmp6, ttmp6',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "parser-recovered repeated listing entries should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-two-line-doc-listing",
      taskId: "task:evidence:truncated-two-line-doc-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build the project from a clean checkout\\nconfig/settings.json:21:{\\"mode\\":\\"debug\\"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "parser-recovered repeated doc/config path listings should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-source-intro",
      taskId: "task:evidence:truncated-line-numbered-source-intro",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\timport os\\n2\\tfrom pathlib import Path\\n3\\tclass Runner:',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "repeated line-numbered source intro syntax should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-python-imports",
      taskId: "task:evidence:truncated-line-numbered-python-imports",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 import functools\\n2 import os\\n3 import sys',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "repeated line-numbered Python imports should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-ts-exports",
      taskId: "task:evidence:truncated-line-numbered-ts-exports",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 export const value = 1;\\n2 export function run() {\\n3 return value;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "repeated line-numbered TypeScript exports should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-ts-interface",
      taskId: "task:evidence:truncated-line-numbered-ts-interface",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 interface Options {\\n2 type Config = Options\\n3 const value = 1;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "repeated line-numbered TypeScript declarations should become observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-single-source-line",
      taskId: "task:evidence:truncated-single-source-line",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "one source-location line plus ellipsis is not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-single-doc-listing",
      taskId: "task:evidence:truncated-single-doc-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build the project from a clean checkout',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "one doc/config path line without total-output marker is not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-zero-exit-single-listing",
      taskId: "task:evidence:truncated-zero-exit-single-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build failed is documented here...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "zero-exit metadata does not promote one listing row",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:complete-total-lines-listing",
      taskId: "task:evidence:complete-total-lines-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 106\\n\\nsrc/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "complete structured envelopes can carry listing observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:complete-total-lines-doc-listing",
      taskId: "task:evidence:complete-total-lines-doc-listing",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 42\\n\\n/repo/README.md:17:Build the project from a clean checkout"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "complete structured envelopes can carry doc/config listing observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-prose-path-reference",
      taskId: "task:evidence:truncated-prose-path-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 2\\nsee /repo/README.md line 17 for build notes',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "prose path references are not listing entries",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-uri-path-reference",
      taskId: "task:evidence:truncated-uri-path-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 2\\nhttps://example.test/docs/readme.md:17:Build notes',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "URI path references are not listing entries",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-log-path-reference",
      taskId: "task:evidence:truncated-log-path-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 2\\n/var/log/build.log:17:Compilation failed',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "log path line references are not listing entries",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-listing-plus-traceback",
      taskId: "task:evidence:truncated-listing-plus-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"src/app.ts:10:export const value = 1;\\nsrc/app.ts:11:throw new Error();\\nTraceback (most recent call last): RuntimeError',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "visible diagnostics after listing lines remain terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-doc-listing-plus-error",
      taskId: "task:evidence:truncated-doc-listing-plus-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build the project from a clean checkout\\ndocs/guide.md:18:Run tests\\nError: permission denied',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "visible diagnostics after doc listing lines remain terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-ordered-list-prose",
      taskId: "task:evidence:truncated-ordered-list-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1. import packages before running the project\\n2. from the report, copy the settings',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "markdown ordered-list prose is not line-numbered source",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-single-weak-source-intro",
      taskId: "task:evidence:truncated-single-weak-source-intro",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: '{"wall_time":"0.0510 seconds","output":"1 import os',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "one weak line-numbered source intro is not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-import-prose",
      taskId: "task:evidence:truncated-line-numbered-import-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 import packages before running the project\\n2 import settings before testing',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered import prose is not source intro syntax",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-from-prose",
      taskId: "task:evidence:truncated-line-numbered-from-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 from report import settings before running\\n2 from notes import values before testing',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered from/import prose is not source intro syntax",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-export-prose",
      taskId: "task:evidence:truncated-line-numbered-export-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 export const packages before running the project\\n2 export const settings before testing',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered export prose is not source intro syntax",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-interface-prose",
      taskId: "task:evidence:truncated-line-numbered-interface-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 interface with the terminal before running\\n2 interface with settings before testing',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered interface prose is not source intro syntax",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-line-numbered-prose",
      taskId: "task:evidence:truncated-line-numbered-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 type the command into the terminal\\n2 from the report, copy the settings',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered prose is not source intro syntax",
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
      id: "evt:evidence:malformed-structured-final-brace-source",
      taskId: "task:evidence:malformed-structured-final-brace-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app\\.ts b/src/app\\.ts\\n--- a/src/app\\.ts","wall_time":"0.0510 seconds"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "malformed structured envelopes can recover allowed suffix fields before the final brace",
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
      id: "evt:evidence:malformed-output-first-nonzero-final-brace",
      taskId: "task:evidence:malformed-output-first-nonzero-final-brace",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app\\.ts b/src/app\\.ts\\n--- a/src/app\\.ts","exit_code":2}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "visible output-first nonzero exit metadata remains terminal with final-brace recovery",
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
      id: "evt:evidence:malformed-output-first-invalid-wall-time-final-brace",
      taskId: "task:evidence:malformed-output-first-invalid-wall-time-final-brace",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app\\.ts b/src/app\\.ts\\n--- a/src/app\\.ts","wall_time":"later"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "invalid wall time still blocks final-brace recovery",
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
      id: "evt:evidence:malformed-output-first-unknown-key-final-brace",
      taskId: "task:evidence:malformed-output-first-unknown-key-final-brace",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"diff --git a/src/app\\.ts b/src/app\\.ts\\n--- a/src/app\\.ts","status":"ok"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "unknown suffix fields still block final-brace recovery",
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
      id: "evt:evidence:malformed-structured-line-numbered-document",
      taskId: "task:evidence:malformed-structured-line-numbered-document",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# PC Sampling GFX1151\\n2\\t\\n3\\t## Goal\\n4\\t- produce a non-empty host-trap csv\\n5\\t- avoid GPU reset\\n6\\t```sh\\n7\\tmake test"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured line-numbered markdown documents require headings plus list or fence structure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-document",
      taskId: "task:evidence:truncated-clipped-line-numbered-document",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# PC Sampling GFX1151\\n2\\t\\n3\\t## Goal\\n4\\t- produce a non-empty host-trap csv...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "visibly clipped line-numbered markdown documents can use one list anchor",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-document-fence",
      taskId: "task:evidence:truncated-clipped-line-numbered-document-fence",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# PC Sampling GFX1151\\n2\\t\\n3\\t## Repro\\n4\\t```sh...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "visibly clipped line-numbered markdown documents can use fence structure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:malformed-structured-line-numbered-document-prose",
      taskId: "task:evidence:malformed-structured-line-numbered-document-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# Project Notes\\n2\\tordinary text only\\n3\\t## Details\\n4\\twithout repeated list or fence structure"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered markdown headings alone are not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-document-one-heading",
      taskId: "task:evidence:truncated-clipped-line-numbered-document-one-heading",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# Project Notes\\n2\\t\\n3\\t- item one\\n4\\t- item two...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped line-numbered markdown documents still need two headings",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-document-no-list",
      taskId: "task:evidence:truncated-clipped-line-numbered-document-no-list",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# Project Notes\\n2\\tordinary text\\n3\\t## Details\\n4\\twithout list structure...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped line-numbered markdown headings alone are still not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:malformed-structured-line-numbered-document-nonmonotone",
      taskId: "task:evidence:malformed-structured-line-numbered-document-nonmonotone",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# Project Notes\\n3\\t## Goal\\n2\\t- item one\\n4\\t- item two"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "line-numbered markdown documents require monotone line numbers",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-document-nonmonotone",
      taskId: "task:evidence:truncated-clipped-line-numbered-document-nonmonotone",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t# Project Notes\\n3\\t## Goal\\n2\\t- item one\\n4\\titem tail...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped line-numbered markdown documents still require monotone line numbers",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-line-numbered-prose",
      taskId: "task:evidence:truncated-clipped-line-numbered-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\tfirst step\\n2\\tsecond step\\n3\\tthird step\\n4\\tfourth step...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped generic line-numbered prose is not a markdown document observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:malformed-structured-kernel-diagnostic",
      taskId: "task:evidence:malformed-structured-kernel-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0516 seconds","output":"[ 226.262885] amdxdna: *ERROR* SVA bind failed\\\\.\\n[ 226.287574] amdgpu: cleanup ready"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "malformed structured kernel diagnostics are terminal evidence",
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
      id: "evt:evidence:read-flattened-build-log",
      taskId: "task:evidence:read-flattened-build-log",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "DKMS (dkms-3.2.0) make.log for amdgpu/1.0 Building module(s) # command: 'make' KERNELVER=6.19.0 checking for a BSD-compatible install... /usr/bin/install -c",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
    "flattened build logs need multiple build/log markers",
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
      id: "evt:evidence:raw-read-truncated-listing",
      taskId: "task:evidence:raw-read-truncated-listing",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "src/app.ts:10:export const value = 1;\nsrc/app.ts:11:export const next = 2;\nsrc/app.ts:12:export const last = 3;...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
    "raw reads can recover only repeated truncated listing entries",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-listing-runtime-error",
      taskId: "task:evidence:raw-read-listing-runtime-error",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "## Runtime log\n- request id: 123\n- state: rejected\nError: request rejected...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "raw-read listing recovery must not bypass strong diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-single-listing-line",
      taskId: "task:evidence:raw-read-single-listing-line",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "src/app.ts:10:export const value = 1;...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "one raw-read listing line plus ellipsis is not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-single-doc-listing-line",
      taskId: "task:evidence:raw-read-single-doc-listing-line",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "/repo/README.md:17:Build the project from a clean checkout...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "one raw-read doc/config listing line plus ellipsis is not enough",
  );
  for (const [id, summary] of [
    ["read-log-checking-prose", "Could not open /tmp/make.log while checking for a replacement"],
    [
      "read-log-building-prose",
      "Could not open /tmp/make.log while building module(s) for replacement notes",
    ],
    [
      "read-log-building-command-prose",
      "Could not open /tmp/make.log while building module(s) command: make",
    ],
    [
      "read-log-failed-read-prose",
      "Failed to read DKMS make.log while building module(s) KERNELVER=6.19",
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      })?.kind,
      "terminal_failure",
      `${id} should remain a read failure diagnostic`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-markdown-read-failed",
      taskId: "task:evidence:raw-read-markdown-read-failed",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "# Read failed\n- /tmp/make.log\n- building module(s)\n- command: make...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "markdown read-failed envelopes should not become listing observations",
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

test("task failure evidence classifies explicit missing-tool observation transcripts", () => {
  const catReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-cat-readback",
    taskId: "task:evidence:missing-tool-cat-readback",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3 2 import sys 3 def main(): return 0",
    status: "failed",
  });

  assert.equal(catReadback?.kind, "observational_payload");
  assert.equal(catReadback.readsAsObservation, true);
  assert.equal(catReadback.consequenceBaseline, "high");
  assert.equal(catReadback.toolFamily, undefined);
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-edited-file-readback",
      taskId: "task:evidence:missing-tool-edited-file-readback",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: The file /testbed/reproduce.py has been edited. Here's the result of running `cat -n` on a snippet of /testbed/reproduce.py: 1 #!/usr/bin/env python3 2 import sys",
      status: "failed",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-search-output",
      taskId: "task:evidence:missing-tool-search-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: Found 12 matches in 3 files. Showing first 10 results from /repo/src/app.ts",
      status: "failed",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-command-success-observation",
      taskId: "task:evidence:missing-tool-command-success-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        'OBSERVATION: Running yamllint... Output: ./normal.yaml 1:1 warning missing document start "---" (document-start) Test PASSED: expected warnings were reported.',
      status: "failed",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-empty-observation",
      taskId: "task:evidence:missing-tool-empty-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "OBSERVATION: {}",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "empty observation transcripts stay unclassified without tool-family evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-generic-observation-path",
      taskId: "task:evidence:missing-tool-generic-observation-path",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "OBSERVATION: Found a problem in /repo/file.txt.",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "OBSERVATION prefix plus a path is not enough",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-rejected-use",
      taskId: "task:evidence:missing-tool-rejected-use",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and wait.",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "rejected tool-use prose is not an observation transcript",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-diagnostic-observation",
      taskId: "task:evidence:missing-tool-diagnostic-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "OBSERVATION: Traceback (most recent call last): RuntimeError",
      status: "failed",
    })?.kind,
    "terminal_failure",
    "terminal diagnostics stay terminal before missing-tool observation recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-rg-diagnostic-observation",
      taskId: "task:evidence:missing-tool-rg-diagnostic-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log: Input/output error",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "tool-output diagnostics are not downgraded by missing-tool observation recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-nonprefixed-readback",
      taskId: "task:evidence:missing-tool-nonprefixed-readback",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "missing-tool readback recovery requires an explicit observation prefix",
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
    "terminal_failure",
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

test("observational status-conflict evidence includes corpus-derived event shapes conservatively", () => {
  const readTruncationNotice =
    "IMPORTANT: The file content has been truncated. Status: Showing lines 1-2000 of 5755 total lines. Action: To read more of the file, you can use the 'offset' and 'limit' parameters.";
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-truncation-protocol",
      taskId: "task:evidence:raw-read-truncation-protocol",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: readTruncationNotice,
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
    "raw read truncation protocol notices are low-consequence observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-read-truncation-protocol",
      taskId: "task:evidence:structured-read-truncation-protocol",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: `{"wall_time":"0.0510 seconds","output":"${readTruncationNotice}"}`,
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured read truncation protocol notices are medium-consequence observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-truncation-protocol-with-continuation",
      taskId: "task:evidence:raw-read-truncation-protocol-with-continuation",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "IMPORTANT: The file content has been truncated. Status: Showing lines 191-200 of 385 total lines. Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section, call read_file with offset 200 and limit 100...",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
    "official read_file continuation text is part of the truncation protocol",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-truncation-protocol-with-truncated-continuation",
      taskId: "task:evidence:raw-read-truncation-protocol-with-truncated-continuation",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "IMPORTANT: The file content has been truncated. Status: Showing lines 827-1050 of 2562 total lines. Action: To read more of the file, you can use the 'start_line' and 'end_line' parameters in a subsequent 'read_file' call. For example, t...",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "low",
    "corpus-truncated official read_file continuation text is still protocol-shaped",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-multiple-includes",
      taskId: "task:evidence:structured-multiple-includes",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <torch/extension.h>\\n#include <ATen/cuda/CUDAContext.h>"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "line-anchored include clusters are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-flattened-include-source",
      taskId: "task:evidence:structured-flattened-include-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include \\"vector_codegen.h\\" #include <cmath> #include <iostream> #include \\"debug.h\\" std::unique_ptr<Node> Parser::parse() { return nullptr; }"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "flattened include clusters need source-shaped structure",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-spdx-header",
      taskId: "task:evidence:structured-spdx-header",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"// SPDX-License-Identifier: GPL-2.0 OR MIT\\n/* driver declarations follow */"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "SPDX headers are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-block-spdx-license-header",
      taskId: "task:evidence:structured-block-spdx-license-header",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"/* SPDX-License-Identifier: GPL-2.0 OR MIT */\\n/*\\n * Copyright 2014-2022 Advanced Micro Devices, Inc.\\n * Permission is hereby granted"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "block SPDX license headers are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-banner-license-header",
      taskId: "task:evidence:structured-banner-license-header",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"////////////////////////////////////////////////////////////////////////////////\\n//\\n// The University of Illinois/NCSA\\n// Open Source License (NCSA)\\n// Copyright (c) 2024 Example"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "banner line-comment license headers are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-flattened-license-header",
      taskId: "task:evidence:raw-read-flattened-license-header",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "// Copyright (c) 2010-2024 Example. Produced // at the Example Laboratory. // This file is part of the Example project.",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
    "flattened source comment license headers are raw read source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-line-numbered-license-header",
      taskId: "task:evidence:structured-line-numbered-license-header",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t// SPDX-License-Identifier: GPL-2.0 OR MIT\\n2\\t/*\\n3\\t * Copyright 2023 Example\\n4\\t * Permission is hereby granted"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "line-numbered license headers are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-embedded-git-patch",
      taskId: "task:evidence:structured-embedded-git-patch",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"commit b878abc1234\\nAuthor: dev\\n\\nfix driver\\n\\ndiff --git a/drivers/gpu.c b/drivers/gpu.c\\nindex beb9d12..fd79abc 100644\\n--- a/drivers/gpu.c\\n+++ b/drivers/gpu.c"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "embedded commit patches require commit, diff, and index anchors",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-embedded-git-patch-without-commit",
      taskId: "task:evidence:structured-embedded-git-patch-without-commit",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Patch follows\\n\\ndiff --git a/drivers/gpu.c b/drivers/gpu.c\\nindex beb9d12..fd79abc 100644\\n--- a/drivers/gpu.c\\n+++ b/drivers/gpu.c"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "embedded patches require diff and index anchors without requiring a commit header",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-flattened-numbered-source",
      taskId: "task:evidence:structured-flattened-numbered-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"520 temp = get_value(); 521 if (temp > limit) 522 break;"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "flattened numbered source requires monotone spans and source statement grammar",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-clipped-line-numbered-source-default-context",
      taskId: "task:evidence:structured-clipped-line-numbered-source-default-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"430\\trocp_pcs_config.method = ROCPROFILER_PC_SAMPLING_METHOD_STOCHASTIC;\\n431\\tbreak;\\n432\\tdefault:\\n433\\t// Sampling method unsupported, return the error\\n434\\treturn ROCPROFILE...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "clipped line-numbered source accepts source labels and comments as structural context",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-clipped-line-numbered-source-function-context",
      taskId: "task:evidence:structured-clipped-line-numbered-source-function-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"260\\t\\n261\\tstatic inline struct v11_sdma_mqd *get_sdma_mqd(void *mqd)\\n262\\t{\\n263\\treturn (struct v11_sdma_mqd *)mqd;\\n264\\t}\\n265\\t\\n266\\tstatic int hqd_load_v11(struct amdgpu_device *ad...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "clipped line-numbered source accepts multi-row function context",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-clipped-line-numbered-source-commented-function",
      taskId: "task:evidence:structured-clipped-line-numbered-source-commented-function",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"3570\\t}\\n3571\\t\\n3572\\tvoid GpuAgent::PcSamplingThread(pcs_data_t& pcs_data, const char* thread_name) {\\n3573\\t// TODO: Implement lost sample count\\n3574\\t// TODO: Implement latency\\n3575\\t...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "clipped line-numbered source accepts function headers followed by source comments",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-clipped-line-numbered-python-import-context",
      taskId: "task:evidence:structured-clipped-line-numbered-python-import-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t#!/usr/bin/env python3\\n2\\t\\n3\\timport torch\\n4\\tfrom torch._inductor import config\\n5\\t\\n6\\tfrom kernel.hip.hip_kernel_prepacked import (\\n7\\t_PREPACKED_CONFIGS,\\n8\\tprepack_b_for_scal...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "clipped line-numbered source accepts multiline Python import context",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-line-numbered-shell-source",
      taskId: "task:evidence:structured-line-numbered-shell-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1\\t#!/bin/bash\\n2\\tset -euo pipefail\\n4\\tROOT_DIR=\\"$(cd \\"$(dirname \\"${BASH_SOURCE[0]}\\")\\" && pwd)\\""}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "line-numbered source fragments require monotone source-shaped spans",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-line-numbered-assembly-source",
      taskId: "task:evidence:structured-line-numbered-assembly-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"480\\t s_mov_b32 ttmp6, ttmp13\\n482\\t.pc_sampling_exit:\\n485\\t s_getreg_b32 ttmp2, hwreg(HW_REG_TRAPSTS)"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "line-numbered assembly excerpts are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-plain-assembly-source",
      taskId: "task:evidence:structured-plain-assembly-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"s_mul_i32 ttmp13, ttmp13, ttmp7\\ns_mul_i32 ttmp4, ttmp13, 0x40\\ns_mul_hi_u32 ttmp5, ttmp13, 0x40\\n.endif\\ns_add_u32 ttmp4, ttmp4, 0x40"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "plain assembly excerpts need repeated instruction and directive evidence",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-assembly-source",
      taskId: "task:evidence:raw-read-assembly-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "v_mov_b32 v2, ttmp8\nflat_store_dword v[0:1], v2 glc slc\ns_add_u32 ttmp0, ttmp0, 0x4\ns_addc_u32 ttmp1, ttmp1, 0",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
    "raw read assembly excerpts are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-c-like-return-source",
      taskId: "task:evidence:structured-c-like-return-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"}\\n/* Allocation not found */\\ninfo->type = HSA_EXT_POINTER_TYPE_UNKNOWN;\\nreturn HSA_STATUS_ERROR;\\n}\\nhsa_status_t status = HSA_STATUS_SUCCESS;"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "mid-block C-like return fragments are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-c-like-diagnostic-string-source",
      taskId: "task:evidence:structured-c-like-diagnostic-string-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"dev_err(dev, \\"Failed to flush TC\\\\n\\");\\nkfd_flush_tlb(qpd_to_pdd(qpd), TLB_FLUSH_LEGACY);\\nset_pasid_vmid_mapping(dqm, 0, qpd->vmid);\\ndqm->vmid = qpd->vmid;"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "diagnostic words inside C-like source strings do not make the source readback terminal",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-c-like-std-source",
      taskId: "task:evidence:structured-c-like-std-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"std::memset(&ret, 0, sizeof(PcSamplingRecordT));\\nret.size = sizeof(PcSamplingRecordT);\\nret.wave_in_group = sample.wave_id;\\nret.dispatch_id = correlation_id;"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "std/member C-like fragments are source observations",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-c-like-access-source",
      taskId: "task:evidence:structured-c-like-access-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"private:\\nstd::unordered_map<DispatchPkt, dispatch_correlation_ids_t> dispatch_to_correlation{};\\nstd::atomic<size_t> cache_reset_count{1};\\nsize_t object_id = 0;\\nstd::mutex mut;"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "C++ access-label fragments with declarations are source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-assignment-source",
      taskId: "task:evidence:truncated-clipped-c-like-assignment-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"std::memset(&ret, 0, sizeof(PcSamplingRecordT));\\nret.size = sizeof(PcSamplingRecordT);\\nret.wave_in_group = sample...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "visibly clipped C-like final assignments are source observations with strong anchors",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-call-source",
      taskId: "task:evidence:truncated-clipped-c-like-call-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"dqm->vmid = qpd->vmid;\\nret.size = sizeof(PcSamplingRecordT);\\nCHECK_HIP(hipStreamSynchronize(stream...',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "visibly clipped C-like final calls are source observations with strong anchors",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-diagnostic-string-source",
      taskId: "task:evidence:truncated-clipped-c-like-diagnostic-string-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"dev_err(dev, \\"Failed to flush TC\\");\\nkfd_flush_tlb(qpd_to_pdd(qpd), TLB_FLUSH_LEGACY);\\ndqm->vmid = qpd->vmid;\\nret.wave_in_group = sample...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "diagnostic words inside clipped C-like source strings do not make the source terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-nonzero",
      taskId: "task:evidence:truncated-clipped-c-like-nonzero",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":2,"wall_time":"0.0510 seconds","output":"std::memset(&ret, 0, sizeof(PcSamplingRecordT));\\nret.size = sizeof(PcSamplingRecordT);\\nret.wave_in_group = sample...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "clipped C-like source still respects visible nonzero exit metadata",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-invalid-wall-time",
      taskId: "task:evidence:truncated-clipped-c-like-invalid-wall-time",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"later","output":"std::memset(&ret, 0, sizeof(PcSamplingRecordT));\\nret.size = sizeof(PcSamplingRecordT);\\nret.wave_in_group = sample...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped C-like source still rejects invalid visible wall time metadata",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-clipped-c-like-unknown-suffix",
      taskId: "task:evidence:truncated-clipped-c-like-unknown-suffix",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"output":"std::memset(&ret, 0, sizeof(PcSamplingRecordT));\\nret.size = sizeof(PcSamplingRecordT);\\nret.wave_in_group = sample...","status":"ok"',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped C-like source still rejects unknown visible suffix metadata",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-no-space-grep-context",
      taskId: "task:evidence:structured-no-space-grep-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"2265:hsa_status_t GpuAgent::UpdateTrapHandlerWithPCS() {\\n2266: /* source context follows */"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "line-numbered grep context allows no space after the colon",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-no-space-technical-doc-context",
      taskId: "task:evidence:structured-no-space-technical-doc-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1450:TRAPSTS\\n1622:relative to S_TRAP and PC[47:0]\\n2044:TRAP_EN"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "line-numbered technical grep context uses structural tokens rather than plain prose",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-no-space-marker-log-context",
      taskId: "task:evidence:structured-no-space-marker-log-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"25:PcSamplingStart: entry, isActive=0\\n26:PcSamplingStart: method=0"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "line-numbered marker logs use camel-case and key/value body shape",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-tabbed-line-numbered-source-context",
      taskId: "task:evidence:structured-tabbed-line-numbered-source-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"3570\\t}\\n3572\\tvoid GpuAgent::PcSamplingThread(pcs_data_t& pcs_data) {\\n3573\\t// TODO: Implement lost sample count"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "high",
    "line-numbered source fragments can include structural brace context",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-kernel-log",
      taskId: "task:evidence:structured-kernel-log",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"[ 510.963965] amdgpu ring comp_1 uses VM inv eng 10 [ 511.002010] amdgpu ring gfx_0 uses VM inv eng 0"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "flattened kernel logs require repeated dmesg timestamp entries",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-numbered-kernel-log",
      taskId: "task:evidence:structured-numbered-kernel-log",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 464 1:[ 187.250342] amdgpu started 2:[ 187.260342] amdgpu ready"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "numbered flattened kernel logs accept total-output with repeated dmesg entries",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-numbered-kernel-log-without-total-lines",
      taskId: "task:evidence:structured-numbered-kernel-log-without-total-lines",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1227:[ 360.591683] amdgpu trigger_pc_sample_trap\\n1228:[ 360.591693] amdgpu sweep complete"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured numbered kernel logs need repeated timestamp entries, not total-output",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-cmake-warning-log",
      taskId: "task:evidence:structured-cmake-warning-log",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Total output lines: 431\\nBuilding ROCr Runtime\\nCMake Deprecation Warning at CMakeLists.txt:44 (cmake_minimum_required): compatibility note"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "CMake warning logs require total-output and CMake warning location grammar",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-cmake-warning-without-total-lines",
      taskId: "task:evidence:structured-cmake-warning-without-total-lines",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Building ROCr Runtime...\\nCMake Deprecation Warning at CMakeLists.txt:44 (cmake_minimum_required): compatibility note"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured CMake warning logs do not require a total-output wrapper",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-make-warning-log",
      taskId: "task:evidence:structured-make-warning-log",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"13.2677 seconds","output":"make[1]: Entering directory \'/repo/driver\'\\nwarning: the compiler differs from the one used to build the kernel\\n  CC [M] module.o"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured make warning logs need build-log grammar",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-markdown-table",
      taskId: "task:evidence:structured-markdown-table",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"| Counter | Description |\\n|---------|-------------|\\n| LDSBankConflict | LDS bank conflicts |\\n| L2CacheHit | L2 cache hit rate |"}',
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured markdown tables are document observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-markdown-table-one-body-row",
      taskId: "task:evidence:structured-markdown-table-one-body-row",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"| Counter | Description |\\n|---------|-------------|\\n| LDSBankConflict | LDS bank conflicts |"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "structured markdown tables need at least two body rows",
  );

  for (const [id, summary] of [
    [
      "invalid-read-truncation-bounds",
      readTruncationNotice.replace("1-2000 of 5755", "2000-1 of 5755"),
    ],
    [
      "overflow-read-truncation-bounds",
      readTruncationNotice.replace("1-2000 of 5755", "1-2000 of 1999"),
    ],
    [
      "mixed-read-truncation-parameters",
      readTruncationNotice.replace("'offset' and 'limit'", "'offset' and 'end_line'"),
    ],
    ["trailing-read-truncation-prose", `${readTruncationNotice} This may need review.`],
    [
      "arbitrary-read-truncation-continuation",
      "IMPORTANT: The file content has been truncated. Status: Showing lines 1-2 of 3 total lines. Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read this unrelated prose should still be rejected.",
    ],
    [
      "arbitrary-read-truncation-ellipsis",
      "IMPORTANT: The file content has been truncated. Status: Showing lines 1-2 of 3 total lines. Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to review...",
    ],
    [
      "raw-read-markdown-table",
      "| Counter | Description |\n|---------|-------------|\n| A | one |\n| B | two |",
    ],
    ["single-include", "#include <torch/extension.h>"],
    ["include-prose", "Please add #include <a.h> and #include <b.h> before rebuilding"],
    ["short-flattened-include-cluster", '#include "a.h" #include "b.h" before rebuilding'],
    ["bare-license-prose", "Copyright 2026 Example. Permission is hereby granted."],
    ["markdown-license-prose", "# Copyright Notes\nPermission is hereby granted in prose."],
    ["unclosed-license-comment", "/* Copyright 2026 Example. Permission is hereby granted."],
    ["single-numbered-license-line", "1 // SPDX-License-Identifier: GPL-2.0 OR MIT"],
    [
      "patch-prose-without-index",
      "Patch includes diff --git a/src/app.ts b/src/app.ts but no index line",
    ],
    ["short-numbered-source", "520 temp = get_value(); 521 if (temp > limit)"],
    ["nonmonotone-numbered-source", "520 temp = get_value(); 519 if (temp > limit) 521 break;"],
    [
      "nonmonotone-numbered-c-like-source-fragment",
      "3 info->type = HSA_EXT_POINTER_TYPE_UNKNOWN;\n1 return HSA_STATUS_ERROR;\n2 dqm->vmid = qpd->vmid;\n4 std::memset(&ret, 0, sizeof(PcSamplingRecordT));",
    ],
    ["two-span-line-numbered-source", "1 #!/bin/bash\n2 set -euo pipefail"],
    ["nonmonotone-line-numbered-source", '1 #!/bin/bash\n3 set -euo pipefail\n2 ROOT_DIR="$PWD"'],
    ["numbered-assignment-prose", "1 task = pending 2 status = ready 3 return to menu;"],
    ["single-keyword-numbered-prose", "1 int this is prose"],
    [
      "three-line-numbered-return-prose",
      "1 int this is prose\n2 return to menu\n3 continue with setup",
    ],
    [
      "three-line-numbered-call-prose",
      "1 Please call Foo()\n2 Then run Bar()\n3 Please call Baz()",
    ],
    ["numbered-prose-with-brace", "1 int this is prose\n2 }\n3 continue with setup"],
    ["single-assembly-directive", ".set VALUE, 1"],
    ["single-assembly-label", "trap_entry:"],
    ["two-line-assembly-looking-source", "s_mov_b32 ttmp6, ttmp13\ns_waitcnt lgkmcnt(0)"],
    [
      "nonmonotone-numbered-assembly",
      "1 s_mov_b32 ttmp6, ttmp13\n3 s_waitcnt lgkmcnt(0)\n2 s_branch .done",
    ],
    ["numbered-assembly-prose", "1 mov forward\n2 add context\n3 return later"],
    [
      "markdown-directive-prose",
      "# Assembly Notes\n.if is discussed here\n- mov means move in prose",
    ],
    [
      "shell-set-log",
      "set -euo pipefail\nmake[1]: Entering directory '/repo'\nwarning: compiler differs",
    ],
    [
      "ordered-list-source-words",
      "1. if the value is high\\n2. return to the menu\\n3. break the work apart",
    ],
    ["json-numeric-keys", '{"1":"return 0","2":"break","3":"continue"}'],
    ["version-number-context", "1 2.3.4 release 2 10:30 build 3 notes only"],
    [
      "generic-colon-context",
      "1450: context before line\\n1451: context after line\\n1452: context tail",
    ],
    ["single-no-space-grep-context", "2265:hsa_status_t GpuAgent::UpdateTrapHandlerWithPCS() {"],
    ["no-space-prose-context", "1:Introduction\n2:Details"],
    ["no-space-function-call-prose", "1:Please call Foo()\n2:Then call Bar()"],
    ["no-space-domain-context", "1:docs.example.com\n2:api.example.com"],
    ["three-row-no-space-domain-context", "1:docs.example.com\n2:api.example.com\n3:ordinary tail"],
    ["three-row-space-domain-context", "1 docs.example.com\n2 api.example.com\n3 ordinary tail"],
    ["three-row-tab-domain-context", "1\tdocs.example.com\n2\tapi.example.com\n3\tordinary tail"],
    ["no-space-json-context", '1:{"state":"ready"}\n2:{"state":"done"}'],
    ["no-space-url-context", "1:https://example.test/a\n2:https://example.test/b"],
    ["no-space-clock-context", "1:12:30\n2:13:00"],
    [
      "nonmonotone-no-space-grep-context",
      "2265:hsa_status_t GpuAgent::UpdateTrapHandlerWithPCS() {\\n2264: /* older context */",
    ],
    [
      "unnumbered-mid-block-source-fragment",
      'dev_err(dev, "Failed to flush TC");\\nkfd_flush_tlb(qpd, TLB_FLUSH_LEGACY);\\nset_pasid_vmid_mapping(dqm, 0, qpd->vmid);',
    ],
    [
      "three-line-c-like-source-fragment",
      "info->type = HSA_EXT_POINTER_TYPE_UNKNOWN;\nreturn HSA_STATUS_ERROR;\n}",
    ],
    [
      "three-line-c-like-source-fragment-without-clipping",
      "std::memset(&ret, 0, sizeof(PcSamplingRecordT));\nret.size = sizeof(PcSamplingRecordT);\nret.wave_in_group = sample",
    ],
    [
      "two-line-clipped-c-like-source-fragment",
      "ret.size = sizeof(PcSamplingRecordT);\nret.wave_in_group = sample...",
    ],
    [
      "numbered-clipped-c-like-source-fragment",
      "1 std::memset(&ret, 0, sizeof(PcSamplingRecordT));\n2 ret.size = sizeof(PcSamplingRecordT);\n3 ret.wave_in_group = sample...",
    ],
    [
      "c-like-prose-functions",
      "Please call reset_queue(dev);\nThen call flush(dev);\nNow return later;",
    ],
    ["markdown-c-like-list", "- if (ready) {\n- return ok;\n- flush_queue(dev);"],
    [
      "markdown-clipped-c-like-list",
      "- std::memset(&ret, 0, sizeof(PcSamplingRecordT));\n- ret.size = sizeof(PcSamplingRecordT);\n- ret.wave_in_group = sample...",
    ],
    ["markdown-c-like-fence", "```c\nif (ready) {\nreturn ok;\n}\n```"],
    ["single-source-location-row", "/tmp/source.cpp:12: flush_queue(dev);"],
    ["source-location-clipped-c-like-row", "/tmp/source.cpp:12: ret.wave_in_group = sample..."],
    ["json-c-like-fragment", '{"output":"ret.size = sizeof(PcSamplingRecordT);"}'],
    ["single-kernel-timestamp", "[ 510.963965] amdgpu ring comp_1 uses VM inv eng 10"],
    [
      "kernel-timestamp-clipped-c-like",
      "[ 510.963965] amdgpu ret.size = sizeof(PcSamplingRecordT); ret.wave_in_group = sample...",
    ],
    [
      "shell-build-clipped-c-like",
      "set -euo pipefail\nmake[1]: Entering directory '/repo'\nret.wave_in_group = sample...",
    ],
    [
      "markdown-table-with-one-body-row",
      "| Counter | Description |\n|---------|-------------|\n| A | one |",
    ],
    [
      "kernel-log-diagnostic",
      "[ 226.262885] amdxdna 0000:c6:00.1: [drm] *ERROR* amdxdna_drm_open: SVA bind device failed, ret -19 [ 226.287574] amdgpu: pcs hosttrap: set target vmid=0",
    ],
    [
      "cmake-warning-without-total-lines",
      "CMake Deprecation Warning at CMakeLists.txt:44 (cmake_minimum_required): compatibility note",
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      })?.kind,
      "unclassified_failure",
      `${id} should remain unclassified`,
    );
  }

  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:source-string-cmake-error",
      taskId: "task:evidence:source-string-cmake-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"CMake Error at CMakeLists.txt:44 (project)\\";"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "CMake error text inside source code is not a runtime diagnostic",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-kernel-log-diagnostic",
      taskId: "task:evidence:structured-kernel-log-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0516 seconds","output":"[ 226.262885] amdxdna 0000:c6:00.1: [drm] *ERROR* amdxdna_drm_open: SVA bind device failed, ret -19\\n[ 226.287574] amdgpu: pcs hosttrap: set target vmid=0"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "diagnostic kernel logs are terminal evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-numbered-kernel-log-diagnostic",
      taskId: "task:evidence:structured-numbered-kernel-log-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0516 seconds","output":"Total output lines: 2 1:[ 226.262885] amdxdna: *ERROR* SVA bind device failed 2:[ 226.287574] amdgpu: cleanup ready"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "numbered diagnostic kernel logs are terminal evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-kernel-panic-log-diagnostic",
      taskId: "task:evidence:structured-kernel-panic-log-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0516 seconds","output":"1:[ 226.262885] Kernel panic - not syncing\\n2:[ 226.287574] CPU: 0 PID: 1"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "numbered kernel panic logs are terminal evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-kernel-bug-lockup-diagnostic",
      taskId: "task:evidence:structured-kernel-bug-lockup-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0516 seconds","output":"1:[ 226.262885] BUG: soft lockup - CPU#0 stuck\\n2:[ 226.287574] watchdog: soft lockup pending"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "numbered kernel BUG lockup logs are terminal evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:assembly-error-label",
      taskId: "task:evidence:assembly-error-label",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "error:\nfatal:\nwarning:\ns_mov_b32 ttmp6, ttmp13",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "error and fatal labels must not become source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:c-like-compiler-diagnostic",
      taskId: "task:evidence:c-like-compiler-diagnostic",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "src/source.cpp:12: error: expected ';'\nsrc/source.cpp:13: warning: unused value",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "compiler diagnostics must not become source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:clipped-error-label-c-like",
      taskId: "task:evidence:clipped-error-label-c-like",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "error:\nstd::memset(&ret, 0, sizeof(PcSamplingRecordT));\nret.size = sizeof(PcSamplingRecordT);\nret.wave_in_group = sample...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "clipped source-like text after an error label remains terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:clipped-warning-compiler-diagnostic",
      taskId: "task:evidence:clipped-warning-compiler-diagnostic",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "src/source.cpp:12: warning: unused value\nstd::memset(&ret, 0, sizeof(PcSamplingRecordT));\nret.wave_in_group = sample...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "warning-only clipped compiler diagnostics stay non-observational",
  );

  for (const [id, output] of [
    [
      "nonzero-flattened-source",
      '{"exit_code":2,"wall_time":"0.0510 seconds","output":"520 temp = get_value(); 521 if (temp > limit) 522 break;"}',
    ],
    [
      "nonzero-single-listing",
      '{"exit_code":2,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build failed is documented here..."}',
    ],
    [
      "source-plus-traceback",
      '{"wall_time":"0.0510 seconds","output":"520 temp = get_value(); 521 if (temp > limit) 522 break;\\nTraceback (most recent call last): RuntimeError"}',
    ],
    [
      "cmake-error",
      '{"wall_time":"0.0510 seconds","output":"Total output lines: 431\\nCMake Error at CMakeLists.txt:44 (project): failed"}',
    ],
    [
      "cmake-warning-plus-error",
      '{"wall_time":"0.0510 seconds","output":"Total output lines: 431\\nCMake Warning at CMakeLists.txt:44 (project): compatibility note\\nCMake Error at CMakeLists.txt:45 (add_library): failed"}',
    ],
    [
      "flattened-cmake-warning-plus-error",
      '{"wall_time":"0.0510 seconds","output":"Total output lines: 431 CMake Warning at CMakeLists.txt:44 (project): compatibility note CMake Error at CMakeLists.txt:45 (add_library): failed"}',
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary: output,
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "terminal_failure",
      `${id} should stay terminal`,
    );
  }
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
