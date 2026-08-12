import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeBareNonzeroTerminalExitEvidence } from "../src/semantic-bare-nonzero-terminal-exit.js";
import { readTaskFailureSemanticEvidence } from "../src/semantic-evidence.js";
import { looksLikeSearchResultObservation } from "../src/semantic-search-observation-shapes.js";
import {
  looksLikeSourceWindowLimitFailure,
  looksLikeSourceWindowLimitMixedDiagnostic,
} from "../src/semantic-source-window-limit-shapes.js";
import { readTestOutputObservation } from "../src/semantic-test-output-observation-shapes.js";
import { normalizeSemanticText } from "../src/semantic-text.js";
import { readToolUseRejectionOutcome } from "../src/semantic-tool-use-rejection-shapes.js";

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

test("bounded source windows require a measured range, an explicit boundary, and omitted remainder", () => {
  for (const summary of [
    "Returned lines 1 through 240 of 913; the remainder was intentionally omitted by the read limit.",
    "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
    "Displaying lines 100-150 of 700. Remainder truncated because of the display limit.",
  ]) {
    assert.equal(looksLikeSourceWindowLimitFailure(summary), true, summary);
    const evidence = readFailure(summary, "read");
    assert.equal(evidence?.failureDetail, "source_window_limit", summary);
    assert.equal(evidence?.consequenceBaseline, "medium", summary);
  }

  for (const summary of [
    "See lines 20 to 40 of 900 for the implementation.",
    "Showing lines 20 to 40 of 40; the read completed.",
    "Showing lines 20 to 40 of 900; permission denied while reading the remainder at the output boundary.",
    'The document says "showing lines 20 to 40 of 900" but includes no truncation envelope.',
  ]) {
    assert.equal(looksLikeSourceWindowLimitFailure(summary), false, summary);
  }
  assert.equal(
    looksLikeSourceWindowLimitMixedDiagnostic(
      "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary; permission denied while reading more.",
    ),
    true,
  );
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
      readToolUseRejectionOutcome(summary),
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
    assert.equal(readToolUseRejectionOutcome(summary), null, summary);
  }
});

test("control authority never consumes contradictory terminal evidence", () => {
  const clean =
    "Authorization was declined before invocation; no tool call occurred and no execution result exists.";
  assert.equal(readFailure(clean, "edit")?.kind, "rejected_tool_use_observation");

  for (const summary of [
    "Authorization was declined before invocation; no tool call occurred. RuntimeError: decoder crashed. No execution result exists.",
    "Authorization was declined before invocation; no tool call occurred and no execution result exists. RuntimeError: decoder crashed.",
    "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and RuntimeError: decoder crashed while waiting for the user to proceed.",
  ]) {
    assert.equal(readToolUseRejectionOutcome(summary), null, summary);
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
