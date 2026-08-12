import assert from "node:assert/strict";
import test from "node:test";

import { EventEvaluator } from "../src/event-evaluator.js";
import { projectObservationJudgmentContract } from "../src/judgment-observation-contract.js";
import { hasToolOutputFailureDiagnosticEvidence } from "../src/semantic-diagnostic-shapes.js";
import { readTaskFailureSemanticEvidence } from "../src/semantic-evidence.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { looksLikeSearchResultObservation } from "../src/semantic-search-observation-shapes.js";
import {
  looksLikeBareNonzeroTerminalExitEvidence,
  readPreExecutionControl,
} from "../src/semantic-task-failure-event-facts.js";
import { readTestOutputObservation } from "../src/semantic-test-output-observation-shapes.js";
import { normalizeSemanticText } from "../src/semantic-text.js";

const timestamp = "2026-08-13T00:00:00.000Z";

function readFailure(
  summary: string,
  toolFamily: string,
  title = `${toolFamily} transport failure`,
) {
  return readTaskFailureSemanticEvidence({
    id: `event:${toolFamily}`,
    taskId: `task:${toolFamily}`,
    timestamp,
    type: "task.updated",
    title,
    summary,
    status: "failed",
    toolFamily,
  });
}

function looksLikeSearch(summary: string): boolean {
  return looksLikeSearchResultObservation(normalizeSemanticText(summary), summary);
}

function readCleanPreExecutionControl(summary: string) {
  const read = readControl(summary);
  return read?.conflictingDiagnostic === false ? read.outcome : null;
}

function readControl(summary: string) {
  return readPreExecutionControl(summary, hasToolOutputFailureDiagnosticEvidence(summary, true));
}

test("outcome-only exits require nonzero status and multiple explicitly absent evidence channels", () => {
  for (const summary of [
    "The process exited with code 23; no standard output, error output, or diagnostic text was retained.",
    "Subprocess returned code 7 without stdout and stderr available.",
    "No output command failed with a non-zero exit.",
  ]) {
    assert.equal(looksLikeBareNonzeroTerminalExitEvidence(summary), true, summary);
    assert.equal(readFailure(summary, "bash")?.failureDetail, "outcome_only", summary);
  }

  for (const summary of [
    "The process exited with code 0; no standard output or error output was retained.",
    "The process exited with code 23; no stderr was retained.",
    "The process exited with code 23; RuntimeError was retained in stderr.",
    'Expected text: "the process exited with code 23; no stdout or stderr was retained".',
  ]) {
    assert.equal(looksLikeBareNonzeroTerminalExitEvidence(summary), false, summary);
  }
});

test("direct runtime diagnostics generalize across exact tool families without trusting source prose", () => {
  for (const [toolFamily, summary] of [
    [
      "custom_runner",
      "RuntimeError: decoder accessed a closed stream while processing frame 18; execution terminated before completion.",
    ],
    ["job_executor", "TypeError: handler is not callable. Execution terminated."],
  ] as const) {
    const evidence = readFailure(summary, toolFamily);
    assert.equal(evidence?.kind, "terminal_failure", summary);
    assert.equal(evidence?.failureDetail, "diagnostic", summary);
    assert.equal(evidence?.consequenceBaseline, "high", summary);
  }

  for (const [toolFamily, summary] of [
    [
      "custom_runner",
      'The source record contains the literal text "RuntimeError: expected fixture".',
    ],
    ["custom_runner", "The next run should raise RuntimeError when the fixture is invalid."],
    ["web", "RuntimeError: upstream request failed."],
  ] as const) {
    assert.notEqual(readFailure(summary, toolFamily)?.failureDetail, "diagnostic", summary);
  }
});

test("complete terminal success envelopes do not require capability-name semantics", () => {
  for (const summary of [
    "Process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing.",
    "Subprocess executed and completed successfully with exit status 0. The record is terminal and complete; no evidence channel is missing.",
  ]) {
    const evidence = readFailure(summary, "Opaque.Executor/9");
    assert.equal(evidence?.kind, "structured_execution_success_observation", summary);
    assert.equal(evidence?.observationSyntax?.kind, "outcome", summary);
    assert.equal(evidence?.observationSyntax?.polarity, "success", summary);
    assert.equal(evidence?.observationSyntax?.subject, "command", summary);
    assert.equal(evidence?.observationSyntax?.origin, "command_output", summary);
    assert.equal(evidence?.toolFamily, "Opaque.Executor/9", summary);
  }

  for (const summary of [
    "Expected result: process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing.",
    "For reference, process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing.",
    "If the process invocation occurred and finished successfully with return code zero, the outcome is complete and terminal; no diagnostic or output channel is missing.",
    "Process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; the diagnostic channel is missing.",
    "Process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing. RuntimeError: worker crashed.",
  ]) {
    assert.notEqual(
      readFailure(summary, "Opaque.Executor/9")?.observationSyntax?.polarity,
      "success",
    );
  }
});

test("complete owned diagnostic envelopes classify their body without phrase enumeration", () => {
  for (const summary of [
    "Process invocation occurred and terminated. Its complete stderr output contains allocator invariant breach at address 71. No error content was omitted.",
    "Subprocess ran and crashed. Complete terminal output shows worker violated a runtime invariant. No diagnostic text was omitted.",
  ]) {
    const evidence = readFailure(summary, "Opaque.Executor/9");
    assert.equal(evidence?.kind, "terminal_failure", summary);
    assert.equal(evidence?.observationSyntax?.kind, "diagnostic", summary);
    assert.equal(evidence?.observationSyntax?.diagnosticClass, "runtime", summary);
    assert.equal(evidence?.observationSyntax?.subject, "command", summary);
    assert.equal(evidence?.observationSyntax?.origin, "command_output", summary);
  }

  for (const summary of [
    'Reference text contains "Process invocation occurred and terminated. Its complete stderr output contains allocator breach. No error content was omitted."',
    "For reference, process invocation occurred and terminated. Its complete stderr output contains allocator breach. No error content was omitted.",
    "The documentation says: process invocation occurred and terminated. Its complete stderr output contains allocator breach. No error content was omitted.",
    "Process invocation occurred and terminated. Its stderr output contains allocator invariant breach. No error content was omitted.",
    "Process invocation occurred and completed successfully. Its complete stderr output contains no failure. No error content was omitted.",
  ]) {
    assert.notEqual(
      readFailure(summary, "Opaque.Executor/9")?.observationSyntax?.kind,
      "diagnostic",
    );
  }
});

test("bounded source windows require a measured range, an explicit boundary, and omitted remainder", () => {
  for (const summary of [
    "Returned lines 1 through 240 of 913; the remainder was intentionally omitted by the read limit.",
    "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
    "Displaying lines 100-150 of 700. Remainder truncated because of the display limit.",
  ]) {
    const evidence = readFailure(summary, "read");
    assert.equal(evidence?.failureDetail, "source_window_limit", summary);
    assert.equal(evidence?.observationSyntax?.diagnosticClass, "source_limit", summary);
    assert.equal(evidence?.consequenceBaseline, "medium", summary);
  }

  for (const summary of [
    "See lines 20 to 40 of 900 for the implementation.",
    "Showing lines 20 to 40 of 40; the read completed.",
    "Showing lines 20 to 40 of 900; permission denied while reading the remainder at the output boundary.",
    'The document says "showing lines 20 to 40 of 900" but includes no truncation envelope.',
  ]) {
    assert.notEqual(readFailure(summary, "read")?.failureDetail, "source_window_limit", summary);
  }
  assert.equal(
    readFailure(
      "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary; permission denied while reading more.",
      "read",
    )?.failureDetail,
    "diagnostic",
  );
});

test("balanced complete source envelopes protect diagnostic-looking payload text", () => {
  for (const summary of [
    'A read operation returned this complete bounded source payload and no content lies outside the declared view:\nBEGIN SOURCE VIEW\n"panic: worker aborted"\nEND SOURCE VIEW\nThe sentence is quoted source text.',
    "Source operation delivered a complete document payload; no text was omitted.\nBEGIN DOCUMENT PAYLOAD\nerror: example configuration token\nEND DOCUMENT PAYLOAD",
  ]) {
    for (const toolFamily of ["Opaque.Reader/4", "read"]) {
      const evidence = readFailure(summary, toolFamily);
      assert.equal(evidence?.kind, "observational_payload", summary);
      assert.equal(evidence?.observationSyntax?.kind, "payload", summary);
      assert.equal(evidence?.observationSyntax?.subject, "source", summary);
      assert.equal(evidence?.observationSyntax?.origin, "read_output", summary);
      assert.equal(evidence?.consequenceBaseline, "low", summary);
    }
  }

  for (const summary of [
    "A read operation returned this complete payload and no content lies outside the declared view.\nBEGIN SOURCE VIEW\nvalue\nEND DOCUMENT VIEW",
    "A read operation returned this complete payload and no content lies outside the declared view.\nBEGIN SOURCE VIEW\nBEGIN DOCUMENT VIEW\nvalue\nEND DOCUMENT VIEW\nEND SOURCE VIEW",
    "A read operation returned this complete payload and no content lies outside the declared view.\nBEGIN SOURCE VIEW\nvalue\nEND SOURCE VIEW\nRuntimeError: the read transport crashed.",
    'A read operation returned this complete payload and no content lies outside the declared view.\nconst marker = "BEGIN SOURCE VIEW";',
    "For reference, a read operation returned this complete payload and no content lies outside the declared view.\nBEGIN SOURCE VIEW\nvalue\nEND SOURCE VIEW",
  ]) {
    assert.notEqual(readFailure(summary, "Opaque.Reader/4")?.observationSyntax?.kind, "payload");
  }
});

test("complete document facts require content and yield to asserted outcomes", () => {
  const runtime = readFailure(
    "A complete document read was returned. It contains a status appendix, but RuntimeError: the transport crashed after execution started.",
    "Opaque.Reader/4",
  );
  assert.equal(runtime?.observationSyntax?.kind, "diagnostic");
  assert.equal(runtime?.observationSyntax?.diagnosticClass, "runtime");
  assert.equal(runtime?.consequenceBaseline, "high");

  const outcome = readFailure(
    "A complete document read was returned. It contains a status appendix. The complete command record reports exit code 9; output and diagnostic channels were excluded from the record.",
    "Opaque.Reader/4",
  );
  assert.equal(outcome?.observationSyntax?.kind, "outcome");
  assert.equal(outcome?.observationSyntax?.polarity, "failure");

  for (const summary of [
    "A complete document read was returned.",
    "A complete document read was requested, but no payload was returned.",
    "A complete document read was returned. It contains no content.",
    "A complete document read was returned. It does not contain a payload.",
  ]) {
    assert.notEqual(readFailure(summary, "Opaque.Reader/4")?.observationSyntax?.kind, "payload");
  }
});

test("event fact families share one Observation-to-judgment path", () => {
  const cases = [
    {
      id: "absent-failure",
      summary:
        "The command failed. The standard output field is present and empty. The standard error field is present and empty. No diagnostic payload was returned.",
      observation: ["outcome", "failure", "command", "command_output", undefined],
      judgment: ["limited_failure", "evidence_required", null],
    },
    {
      id: "authorization-control",
      summary:
        "Authorization was declined before invocation; no tool call occurred and no execution result exists.",
      observation: ["control", "neutral", "tool", "status_text", undefined],
      judgment: ["stable_observation", "authorization_required", "rejected_tool_use_observation"],
    },
    {
      id: "document-payload",
      summary:
        "A complete document read was returned. It explains a hypothetical response and quotes execution failed with code 74 as documentation, not as a report of this event.",
      observation: ["payload", "neutral", "document", "read_output", undefined],
      judgment: ["stable_observation", "none", "payload_observation"],
    },
    {
      id: "outcome-failure",
      summary:
        "The complete command record reports exit code 9; output and diagnostic channels were excluded from the record.",
      observation: ["outcome", "failure", "command", "command_output", undefined],
      judgment: ["limited_failure", "none", null],
    },
    {
      id: "runtime-diagnostic",
      summary:
        "Process invocation occurred and terminated. Its complete stderr output contains allocator invariant breach at address 71. No error content was omitted.",
      observation: ["diagnostic", "failure", "command", "command_output", "runtime"],
      judgment: ["visible_diagnostic_failure", "diagnostic_inspection", null],
    },
    {
      id: "source-diagnostic",
      summary:
        "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary; permission denied while reading more.",
      observation: ["diagnostic", "failure", "source", "read_output", "runtime"],
      judgment: ["visible_diagnostic_failure", "diagnostic_inspection", null],
    },
    {
      id: "source-limit",
      summary: "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
      observation: ["diagnostic", "failure", "source", "read_output", "source_limit"],
      judgment: ["limited_failure", "evidence_scope_required", null],
    },
    {
      id: "terminal-success",
      summary:
        "Process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing.",
      observation: ["outcome", "success", "command", "command_output", undefined],
      judgment: ["stable_observation", "none", "command_success_observation"],
    },
  ] as const;
  const evaluator = new EventEvaluator();

  for (const testCase of cases) {
    const result = evaluator.evaluate(
      normalizeSourceEvent({
        id: `event:${testCase.id}`,
        taskId: `task:${testCase.id}`,
        timestamp,
        type: "task.updated",
        title: "Opaque transport failure",
        summary: testCase.summary,
        status: "failed",
        toolFamily: "Opaque.Executor/9",
      }),
    );
    assert.equal(result.kind, "candidate", testCase.id);
    if (result.kind !== "candidate") continue;
    const observation = result.candidate.judgmentInput.observation;
    assert.ok(observation, testCase.id);
    assert.deepEqual(
      [
        observation.kind,
        observation.polarity,
        observation.subject,
        observation.provenance.origin,
        observation.diagnosticClass,
      ],
      testCase.observation,
      testCase.id,
    );
    const judgment = projectObservationJudgmentContract(observation);
    assert.deepEqual(
      [judgment.statusEvidence, judgment.recoveryPosture, judgment.statusConflictKind],
      testCase.judgment,
      testCase.id,
    );
  }
});

test("search result observations require completed retrieval and concrete locators", () => {
  for (const summary of [
    "Search returned three matches for the requested phrase at lines 14, 88, and 203.",
    "Search found 2 results in files src/a.ts:12 and src/b.ts:20.",
    "Search returned several matches in docs/guide.md:44.",
  ]) {
    assert.equal(looksLikeSearch(summary), true, summary);
    const evidence = readFailure(summary, "search");
    assert.equal(evidence?.kind, "routine_search_output", summary);
    assert.equal(evidence?.consequenceBaseline, "low", summary);
  }

  for (const summary of [
    "Search returned three errors because the request failed.",
    "Search will return three matches after indexing completes.",
    "Search returned three matches for the requested phrase.",
    "Search returned no results because the backend was unavailable.",
  ]) {
    assert.equal(looksLikeSearch(summary), false, summary);
  }
});

test("pre-invocation authorization controls require both non-execution and absent result", () => {
  for (const summary of [
    "Authorization was declined before invocation; no tool call occurred and no execution result exists.",
    "Permission denied before execution: no invocation was performed and no result was produced.",
    "Approval was rejected before tool invocation. No execution occurred and no result was created.",
  ]) {
    assert.deepEqual(
      readCleanPreExecutionControl(summary),
      { kind: "authorization_control", executionEvidence: "absent" },
      summary,
    );
    assert.equal(readFailure(summary, "edit")?.kind, "rejected_tool_use_observation", summary);
  }

  for (const summary of [
    "Authorization was declined after invocation; the tool returned an error.",
    "Authorization was declined before invocation; the tool call occurred and returned a result.",
    "Authorization was declined before invocation; no tool call occurred.",
    'The log contained "authorization was declined before invocation".',
  ]) {
    assert.equal(readCleanPreExecutionControl(summary), null, summary);
  }
});

test("pending authorization controls use the same complete pre-execution grammar", () => {
  for (const summary of [
    "Authorization is required before capability invocation. The capability has not been invoked, execution has not started, and an execution result is absent.",
    "Permission remains pending before tool execution. No tool call occurred, execution did not start, and no result exists.",
  ]) {
    assert.deepEqual(
      readCleanPreExecutionControl(summary),
      { kind: "authorization_control", executionEvidence: "absent" },
      summary,
    );
    assert.equal(readFailure(summary, "Opaque.Control/2")?.kind, "rejected_tool_use_observation");
  }

  for (const summary of [
    "Authorization is required before capability invocation. The capability has not been invoked.",
    "Authorization is required before capability invocation. The capability was invoked and a result was returned.",
    'The log contains "Authorization is required before capability invocation. The capability has not been invoked and no result exists."',
    "For reference, authorization is required before capability invocation. The capability has not been invoked and no result exists.",
    "If authorization is required before capability invocation, the capability has not been invoked and no result exists.",
    "Documentation says authorization is required before capability invocation. The capability has not been invoked and no result exists.",
    "Quoted reference: authorization is required before capability invocation. The capability has not been invoked and no result exists.",
    "Authorization is required before capability invocation. Execution has not started and no result exists. RuntimeError: controller crashed.",
  ]) {
    assert.equal(readCleanPreExecutionControl(summary), null, summary);
    assert.notEqual(readFailure(summary, "Opaque.Control/2")?.observationSyntax?.kind, "control");
  }
});

test("control authority never consumes contradictory terminal evidence", () => {
  const clean =
    "Authorization was declined before invocation; no tool call occurred and no execution result exists.";
  assert.equal(readFailure(clean, "edit")?.kind, "rejected_tool_use_observation");

  for (const summary of [
    "Authorization was declined before invocation; no tool call occurred. RuntimeError: decoder crashed. No execution result exists.",
    "Authorization was declined before invocation; no tool call occurred and no execution result exists. RuntimeError: decoder crashed.",
    "Authorization was declined before invocation; no tool call occurred and no execution result exists. TypeError: controller crashed.",
    "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and RuntimeError: decoder crashed while waiting for the user to proceed.",
  ]) {
    assert.equal(readControl(summary)?.conflictingDiagnostic, true, summary);
    const evidence = readFailure(summary, "edit");
    assert.equal(evidence?.kind, "terminal_failure", summary);
    assert.equal(evidence?.consequenceBaseline, "high", summary);
  }

  const contradictoryTitle = readFailure(
    clean,
    "edit",
    "Traceback (most recent call last): RuntimeError: edit transport executed and crashed",
  );
  assert.equal(contradictoryTitle?.kind, "terminal_failure");
  assert.equal(contradictoryTitle?.consequenceBaseline, "high");
});

test("verified expected diagnostics remain successful test payloads", () => {
  for (const summary of [
    'The test passed with zero failures; it intentionally emitted "ParseError: sample token rejected" and verified that exact diagnostic.',
    "Tests passed with 0 failures. The fixture expectedly raised TypeError and matched the diagnostic.",
  ]) {
    assert.deepEqual(readTestOutputObservation(summary), { consequenceBaseline: "low" }, summary);
    const evidence = readFailure(summary, "exec_command");
    assert.equal(evidence?.kind, "observational_payload", summary);
    assert.equal(evidence?.consequenceBaseline, "low", summary);
  }

  for (const summary of [
    "Tests passed with zero failures but RuntimeError terminated the runner.",
    "Tests passed with zero failures and intentionally emitted RuntimeError.",
    "Tests passed with 2 failures; it intentionally emitted ParseError and verified the diagnostic.",
    "The test should pass with zero failures and intentionally emit ParseError for verification.",
  ]) {
    assert.equal(readTestOutputObservation(summary), null, summary);
  }
});
