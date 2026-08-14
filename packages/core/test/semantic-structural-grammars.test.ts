import assert from "node:assert/strict";
import test from "node:test";

import { EventEvaluator } from "../src/event-evaluator.js";
import { buildAttentionJudgmentInput } from "../src/judgment-input.js";
import { judgeObservation } from "../src/judgment-observation-contract.js";
import { hasToolOutputFailureDiagnosticEvidence } from "../src/semantic-diagnostic-shapes.js";
import { readTaskFailureSemanticEvidence } from "../src/semantic-evidence.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { looksLikeSearchResultObservation } from "../src/semantic-search-observation-shapes.js";
import { splitAssertions } from "../src/semantic-task-failure-assertion-scope.js";
import { parseTaskFailureEventFact } from "../src/semantic-task-failure-event-facts.js";
import { looksLikeBareNonzeroTerminalExitEvidence } from "../src/semantic-failure-detail.js";
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

const readCleanAuthorizationControl = (summary: string) =>
  parseTaskFailureEventFact(summary) === "authorization_control" &&
  !hasToolOutputFailureDiagnosticEvidence(summary, true)
    ? "authorization_control"
    : null;
const hasConflictingAuthorizationDiagnostic = (summary: string) =>
  parseTaskFailureEventFact(summary) === "authorization_control" &&
  hasToolOutputFailureDiagnosticEvidence(summary, true);

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
    [
      "job_executor",
      "The process terminated after memory allocation failed. Exit code 71 and the full runtime diagnostic were returned.",
    ],
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
    assert.equal(evidence?.toolFamily, "opaque.executor/9", summary);
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
    "A complete document read was returned. It says execution started and RuntimeError was returned in a complete diagnostic record.",
    "The complete document payload was returned in full and reports that execution started with RuntimeError in a complete diagnostic record.",
    "A complete document read was returned. The returned document reports execution started with RuntimeError in a complete diagnostic record.",
    "A complete document read was returned. Within it, the contents state execution started with RuntimeError in a complete diagnostic record.",
    "A complete document read was returned. Its contents state execution started with RuntimeError in a complete diagnostic record.",
  ]) {
    assert.equal(readFailure(summary, "Opaque.Reader/4")?.observationSyntax?.kind, "payload");
  }

  const assertedAfterPayload = readFailure(
    "A complete document read was returned. It says RuntimeError is an example, but execution started and RuntimeError was returned in a complete runtime diagnostic.",
    "Opaque.Reader/4",
  );
  assert.equal(assertedAfterPayload?.observationSyntax?.kind, "diagnostic");

  for (const summary of [
    "A complete document read was returned.",
    "A complete document read was requested, but no payload was returned.",
    "A complete document read might be returned. It contains example text.",
    "A complete document read was not returned. It contains example text.",
    "A complete document read is not available. It contains example text.",
    "A complete document read was never delivered. It contains example text.",
    "A complete document read was unavailable. It contains example text.",
    "A complete document read was returned. It contains no content.",
    "A complete document read was returned. It does not contain a payload.",
  ]) {
    assert.notEqual(readFailure(summary, "Opaque.Reader/4")?.observationSyntax?.kind, "payload");
  }
});

test("event facts compose complete boundaries without sentence-template coupling", () => {
  const cases = [
    [
      "terminal_success",
      "Execution finished and the terminal record is complete. Return status 0 was reported; stdout contains a completion marker and stderr is empty.",
    ],
    [
      "outcome_failure",
      "Execution completed with return status 27. This is the complete outcome-only record, and diagnostic content is excluded from it.",
    ],
    [
      "absent_failure",
      "Execution completed and failed with return status 9. The expected failure output is explicitly empty, and no diagnostic text was supplied.",
    ],
    [
      "runtime_diagnostic",
      "The worker terminated with exit status 71 after allocator exhaustion. The complete runtime diagnostic was returned.",
    ],
    [
      "runtime_diagnostic",
      "The process executed and ended with a segmentation fault. A complete stderr diagnostic record was returned.",
    ],
    [
      "source_limit",
      "The read returned a bounded partial view of 75 lines starting at offset 25 from 600 total lines.",
    ],
    [
      "expected_source_diagnostic",
      "The bounded diagnostic check completed. Its expected observation is a failed source validation for an unmatched delimiter.",
    ],
    [
      "expected_source_diagnostic",
      "The validation record is complete. The requested diagnostic reports a parse error in the document.",
    ],
    [
      "expected_source_diagnostic",
      "The validation record is complete. Expected diagnostic reports a parse error in the document.",
    ],
    [
      "document_payload",
      'The complete document payload was returned in full and includes the quoted example "runtime failure: exit code 88" as source text, not an event outcome.',
    ],
    [
      "authorization_control",
      "A decision is required before the operation. Execution has not started, and no result exists.",
    ],
  ] as const;

  for (const [expected, summary] of cases) {
    assert.equal(parseTaskFailureEventFact(summary), expected, summary);
  }
});

test("structural fallback facts lower terminal and bounded evidence through one grammar", () => {
  const cases = [
    ["terminal_success", "Command: npm run verify\nExit code: 0\nResult: completed successfully."],
    [
      "runtime_diagnostic",
      "Command output:\nTypeError: Cannot read properties of undefined\n    at loadConfiguration (/workspace/app/config.js:47:19)\nProcess exited with code 1.",
    ],
    [
      "absent_failure",
      "Process exited with code 2.\nstdout: empty\nstderr: empty\nNo diagnostic payload was captured.",
    ],
    [
      "source_limit",
      "Read failed: source limit reached.\nReturned lines 401-480 of 1500; additional source was omitted.\nRequest a narrower line range to continue.",
    ],
    [
      "document_payload",
      'A complete source read was returned. It contains the bounded source payload "throw new Error(\\"fixture text only\\");" and a complete source view.',
    ],
    [
      "runtime_diagnostic",
      "$ verify-index\nfatal: index checksum mismatch\nProcess exited with code 0; stderr capture complete.",
    ],
  ] as const;

  for (const [expected, summary] of cases) {
    assert.equal(parseTaskFailureEventFact(summary), expected, summary);
  }
});

test("fatal diagnostics remain stable when log lines are flattened", () => {
  for (const summary of [
    "$ verify-index\nfatal: index checksum mismatch\nProcess exited with code 1; stderr capture complete.",
    "$ verify-index\nerror: index checksum mismatch\nProcess exited with code 1; stderr capture complete.",
  ]) {
    const flattened = summary.replaceAll("\n", " ");
    assert.equal(parseTaskFailureEventFact(summary), "runtime_diagnostic", summary);
    assert.equal(parseTaskFailureEventFact(flattened), "runtime_diagnostic", flattened);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "$ verify-index\nfatal: stale index text\nProcess executed and completed successfully with exit code 0; stderr capture complete.",
    ),
    "runtime_diagnostic",
  );
  assert.equal(
    parseTaskFailureEventFact(
      'The documentation quotes "error: expected fixture"; the process did not run and no result exists.',
    ),
    null,
  );

  for (const summary of [
    "$ verify-index\nfatal: stale index text\nProcess executed and completed successfully with exit code 0; stderr capture complete.",
    "$ verify-index\nerror: stale index text\nProcess executed and completed successfully with exit code 0; stderr capture complete.",
  ]) {
    const evidence = readFailure(summary, "bash");
    assert.equal(evidence?.failureDetail, "diagnostic", summary);
    assert.equal(evidence?.observationSyntax?.kind, "diagnostic", summary);
    assert.equal(evidence?.observationSyntax?.diagnosticClass, "runtime", summary);
  }
});

test("incomplete diagnostic envelopes do not promote direct runtime words", () => {
  for (const summary of [
    "Execution terminated. The record contains an incomplete diagnostic with a RuntimeError note.",
    "The process ended. A partial runtime diagnostic reports that the worker crashed.",
    "The command completed. An abbreviated diagnostic includes a fatal: checksum mismatch marker.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
    const evidence = readFailure(summary, "Opaque.Executor/9");
    assert.notEqual(evidence?.failureDetail, "diagnostic", summary);
    assert.notEqual(evidence?.observationSyntax?.diagnosticClass, "runtime", summary);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "The prior record contains an incomplete diagnostic. However, execution terminated with RuntimeError: worker crashed and a complete runtime diagnostic was returned.",
    ),
    "runtime_diagnostic",
  );
});

test("modal diagnostics abstain without suppressing later asserted diagnostics", () => {
  for (const summary of [
    "Execution would have failed with TypeError: cannot read properties of undefined at line 5 if it had run.",
    "The command could have crashed with Traceback (most recent call last) at startup.",
    "A hypothetical process might emit fatal: checksum mismatch during startup.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
    assert.notEqual(readFailure(summary, "bash")?.failureDetail, "diagnostic", summary);
  }

  const laterDiagnostic =
    "Execution would have failed with TypeError if it had run, but execution later crashed with RuntimeError: worker exited and a complete runtime diagnostic was returned.";
  assert.equal(parseTaskFailureEventFact(laterDiagnostic), "runtime_diagnostic");
  assert.equal(readFailure(laterDiagnostic, "bash")?.failureDetail, "diagnostic");
});

test("asserted terminal diagnostics survive omitted subject continuation", () => {
  for (const summary of [
    "Execution would have failed with TypeError if the guard had not caught it, but it actually crashed with RuntimeError at line 5 and the complete diagnostic was returned.",
    "The command was expected to fail, but it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    "The command was expected to fail, but it crashed with RuntimeError at line 5.",
    "The command might fail, but it crashed with fatal: checksum mismatch. Exit code 1.",
    "Execution could have failed earlier. However, it actually terminated with TypeError at line 5.",
    "The process was expected to fail. The prior diagnostic was incomplete. However, it crashed with RuntimeError at line 5 and returned a complete runtime diagnostic.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), "runtime_diagnostic", summary);
    const evidence = readFailure(summary, "bash");
    assert.equal(evidence?.failureDetail, "diagnostic", summary);
    assert.equal(evidence?.observationSyntax?.diagnosticClass, "runtime", summary);
  }

  for (const summary of [
    "It would have crashed with RuntimeError at line 5.",
    "It could have terminated with TypeError at line 5.",
    "It did not crash with RuntimeError at line 5.",
    "The documentation says that it crashed with RuntimeError at line 5.",
    "It crashed with an incomplete diagnostic containing RuntimeError.",
    "It crashed with RuntimeError at line 5.",
    "The command was expected to fail, but the documentation says that it crashed with RuntimeError at line 5.",
    "The command was expected to fail, but the example says that it crashed with RuntimeError at line 5.",
    "The command was expected to fail, but the fixture says that it crashed with RuntimeError at line 5.",
    "The command was expected to fail, but the example fixture says it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    "The command was expected to fail, but an example says it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    "The command was expected to fail, but the example template says it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    "It crashed with RuntimeError at line 5. Separately, the command was expected to fail.",
  ]) {
    assert.notEqual(parseTaskFailureEventFact(summary), "runtime_diagnostic", summary);
    assert.notEqual(readFailure(summary, "bash")?.failureDetail, "diagnostic", summary);
  }
});

test("structural fallback facts remain conservative around incomplete or contradictory evidence", () => {
  for (const summary of [
    "Command: npm run verify\nExit code: 0\nResult: completed successfully. RuntimeError: a prior example failed.",
    "Read returned lines 401-480 of 1500; the remaining source may be omitted.",
    'BEGIN SOURCE PAYLOAD\nthrow new Error("fixture text only");\nEND SOURCE PAYLOAD',
    "Authorization may be required before a future invocation; no execution result is available.",
    "Expected output: Process exited with code 1\n    at verify.js:12:4",
    "The process did not exit with code 1. The result is unknown.",
    "Previous process exited with code 1; current process exited with code 0 and completed successfully.",
    "Returned lines 480-401 of 1500; additional source was omitted.",
    "Returned lines 1-1500 of 1500; additional source was omitted.",
    "The command failed. The returned record contains an incomplete diagnostic with a crash note.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
  }
});

test("structural terminal success is invariant under ordinary log flattening", () => {
  for (const summary of [
    "Command: npm run verify\nExit code: 0\nResult: completed successfully.",
    "Command: npm run verify Exit code: 0 Result: completed successfully.",
    "Command: npm notify Exit code: 0 Result: completed successfully.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), "terminal_success", summary);
    const evidence = readFailure(summary, "Opaque.Executor/9");
    assert.equal(evidence?.observationSyntax?.polarity, "success", summary);
    assert.notEqual(evidence?.failureDetail, "diagnostic", summary);
  }
});

test("reference-frame diagnostics cannot override asserted terminal success", () => {
  for (const summary of [
    "Example fixture: TypeError: decoder failed at x. Process exited with code 0. Result: completed successfully.",
    "Process exited with code 0. Result: completed successfully. Example fixture: TypeError: decoder failed at x.",
    "fatal: checksum mismatch was a previous example. The current command completed successfully with exit code 0.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), "terminal_success", summary);
  }
});

test("reference-frame context cannot license a pronoun diagnostic continuation", () => {
  for (const [title, summary] of [
    [
      "The documentation says execution failed.",
      "It crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    ],
    [
      "For reference, the command was expected to fail.",
      "It crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    ],
    [
      "Reference material: the command was expected to fail.",
      "It crashed with RuntimeError at line 5 and returned the complete diagnostic.",
    ],
  ] as const) {
    assert.notEqual(parseTaskFailureEventFact([title, summary]), "runtime_diagnostic");
    assert.notEqual(readFailure(summary, "bash", title)?.failureDetail, "diagnostic");
  }
});

test("quoted and incomplete diagnostics cannot re-enter terminal fallback", () => {
  for (const summary of [
    'The template quotes "runtime failure: exit code 71" without an asserted diagnostic.',
    "The command failed. The returned record contains an incomplete diagnostic with a crash note.",
    '"no output command exit code 7"',
  ]) {
    const evidence = readFailure(summary, "Opaque.Executor/9");
    assert.notEqual(evidence?.failureDetail, "diagnostic", summary);
    assert.notEqual(evidence?.failureDetail, "outcome_only", summary);
    assert.notEqual(evidence?.observationSyntax?.diagnosticClass, "runtime", summary);
  }
});

test("structural facts are invariant under presentation-only changes", () => {
  const cases = [
    {
      expected: "terminal_success",
      text: "Command: npm run verify\nExit code: 0\nResult: completed successfully.",
      transforms: [
        (value: string) => value.replaceAll("\n", " "),
        (value: string) => value.replace("npm run verify", "npm run notify"),
      ],
    },
    {
      expected: "runtime_diagnostic",
      text: "Command output:\nTypeError: Cannot read properties of undefined\n    at loadConfiguration (/workspace/app/config.js:47:19)\nProcess exited with code 1.",
      transforms: [
        (value: string) => value.replaceAll("\n", " "),
        (value: string) =>
          value.replace("/workspace/app/config.js:47:19", "/tmp/other/config.ts:9:4"),
      ],
    },
    {
      expected: "source_limit",
      text: "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
      transforms: [
        (value: string) => value.replace("to", "through"),
        (value: string) => value.replace("the rest", "the remainder"),
      ],
    },
  ] as const;

  for (const testCase of cases) {
    assert.equal(parseTaskFailureEventFact(testCase.text), testCase.expected, testCase.text);
    for (const transform of testCase.transforms) {
      const variant = transform(testCase.text);
      assert.equal(parseTaskFailureEventFact(variant), testCase.expected, variant);
    }
  }
});

test("fallback abstention applies independently to title and summary fields", () => {
  for (const [title, summary] of [
    ["The template quotes RuntimeError", 'The source says "runtime failure: exit code 71".'],
    ["The command contains an incomplete diagnostic", "The transport returned no further details."],
  ]) {
    const evidence = readFailure(summary, "Opaque.Executor/9", title);
    assert.notEqual(evidence?.failureDetail, "diagnostic", `${title}: ${summary}`);
    assert.notEqual(
      evidence?.observationSyntax?.diagnosticClass,
      "runtime",
      `${title}: ${summary}`,
    );
  }
});

test("event facts preserve uncertainty for incomplete and non-asserted shapes", () => {
  for (const summary of [
    'The template quotes "runtime failure: exit code 71" without an asserted diagnostic.',
    "A timeout might occur if execution starts, but no timeout occurred.",
    "Execution may have completed, but no result boundary is available.",
    "The read returned some lines from a larger source.",
    "A decision may be required before a future operation.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
  }
});

test("event facts preserve assertion scope across negation, modality, and fields", () => {
  for (const summary of [
    "Execution started and no segmentation fault occurred. A complete stderr diagnostic record was returned.",
    "The complete outcome-only record reports exit code 9 was not returned; output channels were excluded from it.",
    "The validation record is complete. The requested diagnostic reports no parse error.",
    "Authorization is required before operation only in a hypothetical scenario. Execution has not started and no result exists.",
    "Authorization was declined before invocation. No tool call occurred and no result exists. The operation subsequently ran.",
    "The record denies a segmentation fault. Execution started. A complete stderr diagnostic record was returned.",
    "The validation record is complete. The requested diagnostic failed to report a parse error in the document.",
    "A complete document read is not available. It contains a report that execution started and RuntimeError was returned in a complete diagnostic record.",
    "A complete document read was never delivered. It reports that execution started and RuntimeError was returned in a complete diagnostic record.",
    "The command was not a failure. No diagnostic payload was returned.",
    "The process might fail because it cannot read the configuration. No result is available.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "No runtime failure occurred initially, but execution later crashed and a complete runtime diagnostic was returned.",
    ),
    "runtime_diagnostic",
  );
  assert.equal(
    parseTaskFailureEventFact(
      "Execution started and did not stop before RuntimeError was returned. A complete stderr diagnostic record was returned.",
    ),
    "runtime_diagnostic",
  );
  assert.equal(
    parseTaskFailureEventFact(
      "Execution was not prevented and later crashed. A complete runtime diagnostic was returned.",
    ),
    "runtime_diagnostic",
  );
  assert.equal(
    parseTaskFailureEventFact([
      "Hypothetical diagnostic",
      "Execution started. RuntimeError was returned in a complete stderr diagnostic record.",
    ]),
    null,
  );
  assert.equal(
    parseTaskFailureEventFact([
      "Segmentation fault was not observed",
      "Execution started. A complete stderr diagnostic record was returned.",
    ]),
    null,
  );
  assert.equal(
    parseTaskFailureEventFact([
      "The operation subsequently ran",
      "Authorization was declined before invocation. No tool call occurred and no result exists.",
    ]),
    null,
  );
});

test("assertion boundaries keep temporal and quantitative yet/but clauses intact", () => {
  assert.deepEqual(
    splitAssertions("The file is not ready yet. Read the source window before editing."),
    ["The file is not ready yet.", "Read the source window before editing."],
  );
  for (const summary of [
    "The result includes all but the final line of the document.",
    "The transcript contains nothing but the command output.",
    "The operation failed yet the returned diagnostic is incomplete.",
  ]) {
    assert.deepEqual(splitAssertions(summary), [summary], summary);
    assert.doesNotThrow(() => parseTaskFailureEventFact(summary), summary);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "Authorization was declined before invocation. No tool call occurred and no result exists. STOP and wait for the user to proceed.",
    ),
    "authorization_control",
  );
});

test("and/while negation boundaries retain their prior single-clause behavior", () => {
  for (const summary of [
    "Execution started and no failure occurred.",
    "The deploy build is fixed and no longer blocked.",
    "The operation continued while no result existed.",
  ]) {
    assert.deepEqual(splitAssertions(summary), [summary], summary);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "Process exited with code 2. stdout: empty. stderr: empty. TypeError: Cannot read properties of undefined\n    at loadConfiguration (/workspace/app/config.js:47:19)",
    ),
    "runtime_diagnostic",
  );
});

test("adversative boundaries preserve later authoritative runtime diagnostics", () => {
  for (const conjunction of ["but", "however", "yet"] as const) {
    for (const separator of [", ", " "] as const) {
      const summary = `The operation could fail${separator}${conjunction} execution later crashed and a complete runtime diagnostic was returned.`;
      assert.equal(parseTaskFailureEventFact(summary), "runtime_diagnostic", summary);
    }
  }

  assert.equal(
    parseTaskFailureEventFact(
      "No runtime failure occurred during setup, but the process then crashed with RuntimeError: worker exited. Exit code 2.",
    ),
    "runtime_diagnostic",
  );
});

test("document-scoped adversatives preserve later authoritative runtime diagnostics", () => {
  const evaluator = new EventEvaluator();
  for (const conjunction of ["but", "however", "yet"] as const) {
    for (const separator of [", ", " "] as const) {
      const summary = `A complete document read describes how execution could fail${separator}${conjunction} execution later crashed and a complete runtime diagnostic was returned.`;
      assert.equal(parseTaskFailureEventFact(summary), "runtime_diagnostic", summary);

      const result = evaluator.evaluate(
        normalizeSourceEvent({
          id: `event:document-adversative:${conjunction}:${separator.length}`,
          taskId: `task:document-adversative:${conjunction}:${separator.length}`,
          timestamp,
          type: "task.updated",
          title: "document-scoped runtime diagnostic",
          summary,
          status: "failed",
          toolFamily: "Opaque.Executor/9",
        }),
      );
      assert.equal(result.kind, "candidate", summary);
      if (result.kind !== "candidate") continue;
      const observation = result.candidate.judgmentInput.observation;
      assert.ok(observation, summary);
      assert.equal(
        judgeObservation(observation).statusEvidence,
        "visible_diagnostic_failure",
        summary,
      );
    }
  }
});

test("command-success routes converge on one canonical observation shape", () => {
  const cases = [
    {
      summary: "Your command ran successfully and did not produce any output.",
      toolFamily: "exec_command",
      origin: "semantic_evidence" as const,
    },
    {
      summary:
        "Process invocation occurred and finished successfully with return code zero. The outcome is complete and terminal; no diagnostic or output channel is missing.",
      toolFamily: "Opaque.Executor/9",
      origin: "command_output" as const,
    },
  ];
  const observations = cases.map((input) => {
    const normalized = normalizeSourceEvent({
      id: `event:${input.toolFamily}`,
      taskId: `task:${input.toolFamily}`,
      timestamp,
      type: "task.updated",
      title: "command failure",
      summary: input.summary,
      status: "failed",
      toolFamily: input.toolFamily,
    });
    const observation = buildAttentionJudgmentInput(normalized).observation;
    assert.ok(observation);
    return { ...observation, expectedOrigin: input.origin };
  });

  assert.deepEqual(
    observations.map(
      ({ provenance: _provenance, expectedOrigin: _expectedOrigin, ...observation }) => observation,
    ),
    [
      {
        kind: "outcome",
        polarity: "success",
        semanticAgreement: "stable",
        ownership: { owner: "tool", capabilityFamily: "exec_command" },
        evidenceStrength: "qualified",
        subject: "command",
        evidenceLoss: "none",
        consequenceBaseline: "low",
      },
      {
        kind: "outcome",
        polarity: "success",
        semanticAgreement: "stable",
        ownership: { owner: "tool", capabilityFamily: "opaque.executor/9" },
        evidenceStrength: "qualified",
        subject: "command",
        evidenceLoss: "none",
        consequenceBaseline: "low",
      },
    ],
  );
  assert.deepEqual(
    observations.map((observation) => observation.provenance.origin),
    cases.map((input) => input.origin),
  );
});

test("event facts reject negated, modal, and contradictory evidence", () => {
  for (const summary of [
    "Execution occurred and the complete diagnostic was returned. No runtime failure occurred.",
    "The terminal record is complete and stdout and stderr were returned. Exit code 0 was not returned.",
    "No authorization is required before execution. Execution has not started and no result exists.",
    "A runtime failure might occur if execution starts. The diagnostic record is complete.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
  }
  assert.notEqual(
    parseTaskFailureEventFact(
      "Authorization is required before execution. Execution has not started and no result exists. Execution completed and returned a result.",
    ),
    "authorization_control",
  );
});

test("event facts reject structurally negated propositions across fields", () => {
  for (const summary of [
    "The terminal record is complete. Return status zero was ruled out. Stdout and stderr were returned.",
    "The terminal record is complete. The report excludes exit code 0. Stdout and stderr were returned.",
    "The terminal record is complete. Exit code zero was expected but never observed. Stdout and stderr were returned.",
    "Execution started. RuntimeError was ruled out. A complete diagnostic record was returned.",
    "Execution started. A segmentation fault cannot be confirmed. A complete diagnostic record was returned.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), null, summary);
  }

  assert.equal(
    parseTaskFailureEventFact([
      "RuntimeError",
      "Execution started. RuntimeError was ruled out. A complete diagnostic record was returned.",
    ]),
    null,
  );
});

test("delivered document authority is independent of its proposition", () => {
  for (const summary of [
    "A complete document read was returned. It describes a hypothetical response where RuntimeError was returned.",
    "A complete document read was returned. It reports that no segmentation fault occurred.",
    "A complete document read describes how execution could fail with RuntimeError.",
    "A full source payload reports that no segmentation fault occurred.",
    "A complete document read describes a hypothetical scenario where execution starts but execution later crashed with RuntimeError.",
  ]) {
    assert.equal(parseTaskFailureEventFact(summary), "document_payload", summary);
  }

  assert.equal(
    parseTaskFailureEventFact(
      "A complete document read describes how execution could fail, but execution later crashed and a complete runtime diagnostic was returned.",
    ),
    "runtime_diagnostic",
  );
});

test("authorization controls yield to structural execution and result evidence", () => {
  const control =
    "Authorization was declined before invocation. No tool call occurred and no result exists.";
  for (const execution of [
    "A result was subsequently produced.",
    "The tool subsequently returned output.",
    "The command later exited.",
    "An invocation was subsequently performed.",
  ]) {
    assert.notEqual(parseTaskFailureEventFact(`${control} ${execution}`), "authorization_control");
  }
});

test("complete terminal facts outrank partial source and remain outside document payload scope", () => {
  assert.equal(
    parseTaskFailureEventFact(
      "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary. Process invocation occurred and terminated. Its complete stderr output contains invalid memory access.",
    ),
    "runtime_diagnostic",
  );
  assert.equal(
    parseTaskFailureEventFact(
      "A full document payload was returned. It contains a complete diagnostic example where execution occurred and runtime failure was reported.",
    ),
    "document_payload",
  );
  assert.equal(
    parseTaskFailureEventFact(
      'The complete document payload quotes "Showing lines 20 to 40 of 900; the rest was clipped at the output boundary" as source text.',
    ),
    "document_payload",
  );
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
        "A complete document read was returned. It explains the parser interface and quotes execution failed with code 74 as documentation, not as a report of this event.",
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
    {
      id: "structural-terminal-success",
      summary: "Command: npm run verify\nExit code: 0\nResult: completed successfully.",
      observation: ["outcome", "success", "command", "command_output", undefined],
      judgment: ["stable_observation", "none", "command_success_observation"],
    },
    {
      id: "structural-runtime-diagnostic",
      summary:
        "Command output:\nTypeError: Cannot read properties of undefined\n    at loadConfiguration (/workspace/app/config.js:47:19)\nProcess exited with code 1.",
      observation: ["diagnostic", "failure", "command", "command_output", "runtime"],
      judgment: ["visible_diagnostic_failure", "diagnostic_inspection", null],
    },
    {
      id: "structural-absent-failure",
      summary:
        "Process exited with code 2.\nstdout: empty\nstderr: empty\nNo diagnostic payload was captured.",
      observation: ["outcome", "failure", "command", "command_output", undefined],
      judgment: ["limited_failure", "evidence_required", null],
    },
    {
      id: "structural-source-limit",
      summary:
        "Read failed: source limit reached.\nReturned lines 401-480 of 1500; additional source was omitted.\nRequest a narrower line range to continue.",
      observation: ["diagnostic", "failure", "source", "read_output", "source_limit"],
      judgment: ["limited_failure", "evidence_scope_required", null],
    },
    {
      id: "structural-terminal-conflict",
      summary:
        "$ verify-index\nfatal: index checksum mismatch\nProcess exited with code 0; stderr capture complete.",
      observation: ["diagnostic", "failure", "command", "command_output", "runtime"],
      judgment: ["visible_diagnostic_failure", "diagnostic_inspection", null],
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
    const judgment = judgeObservation(observation);
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
    for (const toolFamily of ["search", "catalog"]) {
      const evidence = readFailure(summary, toolFamily);
      assert.equal(evidence?.kind, "routine_search_output", `${toolFamily}: ${summary}`);
      assert.equal(evidence?.consequenceBaseline, "low", `${toolFamily}: ${summary}`);
    }
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
    assert.equal(readCleanAuthorizationControl(summary), "authorization_control", summary);
    assert.equal(readFailure(summary, "edit")?.kind, "rejected_tool_use_observation", summary);
  }

  for (const summary of [
    "Authorization was declined after invocation; the tool returned an error.",
    "Authorization was declined before invocation; the tool call occurred and returned a result.",
    "Authorization was declined before invocation; no tool call occurred.",
    'The log contained "authorization was declined before invocation".',
  ]) {
    assert.equal(readCleanAuthorizationControl(summary), null, summary);
  }
});

test("pending authorization controls use the same complete pre-execution grammar", () => {
  for (const summary of [
    "Authorization is required before capability invocation. The capability has not been invoked, execution has not started, and an execution result is absent.",
    "Permission remains pending before tool execution. No tool call occurred, execution did not start, and no result exists.",
  ]) {
    assert.equal(readCleanAuthorizationControl(summary), "authorization_control", summary);
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
    assert.equal(readCleanAuthorizationControl(summary), null, summary);
    assert.notEqual(readFailure(summary, "Opaque.Control/2")?.observationSyntax?.kind, "control");
  }
});

test("control authority never consumes contradictory terminal evidence", () => {
  const clean =
    "Authorization was declined before invocation; no tool call occurred and no execution result exists.";
  assert.equal(readFailure(clean, "edit")?.kind, "rejected_tool_use_observation");

  for (const summary of [
    "Permission was denied before command invocation; the command was not started and no execution result was produced. RuntimeError: decoder crashed.",
    "Authorization was declined before invocation; no tool call occurred and no execution result exists. RuntimeError: decoder crashed.",
    "Authorization was declined before invocation; no tool call occurred and no execution result exists. TypeError: controller crashed.",
    "Authorization was declined before invocation; no tool call occurred. RuntimeError: decoder crashed. No execution result exists.",
  ]) {
    assert.equal(hasConflictingAuthorizationDiagnostic(summary), true, summary);
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
