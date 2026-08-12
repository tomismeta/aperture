import assert from "node:assert/strict";
import test from "node:test";

import {
  readTaskFailureSemanticEvidence,
  readSemanticTextEvidence,
  type SemanticTextEvidence,
  type SemanticTextShape,
} from "../src/semantic-evidence.js";
import { readTaskFailureTerminalProfile } from "../src/semantic-failure-detail.js";
import { buildAttentionJudgmentInput } from "../src/judgment-input.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { readTaskFailureSemanticSignals } from "../src/semantic-task-failure-signals.js";
import {
  readExplicitObservationTranscript,
  looksLikeExplicitDiagnosticObservationTranscript,
  looksLikeExplicitObservationTranscript,
} from "../src/semantic-observation-transcript-shapes.js";
import {
  looksLikeCompactOperationSuccessObservation,
  readExplicitOperationSuccessObservationTranscript,
} from "../src/semantic-operation-success-observation-shapes.js";
import { looksLikeLinterOutputObservation } from "../src/semantic-linter-output-observation-shapes.js";
import { readExplicitNonDiagnosticObservationTranscript } from "../src/semantic-nondiagnostic-observation-transcript-shapes.js";
import { looksLikeObservationTranscriptDiagnostic } from "../src/semantic-observation-transcript-diagnostic-shapes.js";
import {
  looksLikeSectionedTestOutputFailure,
  readSectionedTestOutputObservation,
} from "../src/semantic-test-result-section-shapes.js";
import { isSemanticCommandExecutionToolFamily } from "../src/semantic-tool-family.js";
import {
  looksLikePythonExceptionGroupDiagnostic,
  looksLikePythonLocationError,
} from "../src/semantic-python-diagnostic-shapes.js";
import {
  hasToolUseRejectionSignal,
  looksLikeToolUseRejectionOutcome,
} from "../src/semantic-tool-use-rejection-shapes.js";
import { looksLikeBareNonzeroTerminalExitEvidence } from "../src/semantic-terminal-evidence.js";
import type { ObservationSemantics } from "../src/observation-semantics.js";
import { readTaskFailureObservationCore } from "../src/task-failure-observation-core.js";
import {
  readTaskFailurePayloadObservationSyntax,
  type TaskFailureObservationSyntax,
} from "../src/task-failure-observation-grammar.js";
import { readSemanticStructuredOutputOwnership } from "../src/semantic-structured-output-ownership.js";
import { readTaskFailureStructuredOutputEnvelope } from "../src/semantic-task-failure-structured-output.js";
import type { ApertureEvent } from "../src/events.js";

const timestamp = "2026-04-05T18:45:00.000Z";
type ObservationalStatusConflictEvent = Extract<ApertureEvent, { type: "task.updated" }>;
type ObservationalStatusConflictSemantic = NonNullable<ApertureEvent["semantic"]>;

function readsAsRoutineObservationalStatusConflict(
  event: ObservationalStatusConflictEvent,
  semantic: ObservationalStatusConflictSemantic,
  abstained?: boolean,
): boolean {
  return readObservationalStatusConflict(event, semantic, abstained) !== null;
}

function readObservationalStatusConflict(
  event: ObservationalStatusConflictEvent,
  semantic: ObservationalStatusConflictSemantic,
  abstained?: boolean,
) {
  return (
    buildAttentionJudgmentInput({
      ...event,
      semantic: abstained === undefined ? semantic : { ...semantic, abstained },
    }).observationalStatusConflict ?? null
  );
}

function readTerminalProfile(summary: string, toolFamily?: string) {
  const text = readSemanticTextEvidence(summary, toolFamily);
  return readTaskFailureTerminalProfile({
    summary,
    signals: readTaskFailureSemanticSignals({ summary, toolFamily }),
    toolFamily,
    textSearchResultOutput: hasSemanticTextShape(text, "search_result"),
    textTerminalFailureEvidence: hasSemanticTextShape(text, "terminal_failure"),
  });
}

function hasSemanticTextShape(evidence: SemanticTextEvidence, shape: SemanticTextShape): boolean {
  return evidence.shapes.includes(shape);
}

function readEvidenceProfile(summary: string, toolFamily?: string) {
  const evidence = readTaskFailureSemanticEvidence({
    id: `evt:evidence:profile:${toolFamily ?? "source"}:${summary}`,
    taskId: `task:evidence:profile:${toolFamily ?? "source"}`,
    timestamp,
    type: "task.updated",
    title: `${toolFamily ?? "tool"} failure`,
    summary,
    status: "failed",
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  });
  assert.notEqual(evidence, null);
  if (evidence === null) throw new Error("unreachable");
  const { text: _text, ...profile } = evidence;
  return profile;
}

const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const declinedActionMessage =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
const successfulTestObservationTranscript =
  "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!";
const repeatedSuccessfulTestObservationTranscript =
  "OBSERVATION: === Testing quote_match === All quote_match tests passed! === Testing quotes_needed === All quotes_needed tests passed!";
const concreteTestResultObservationTranscript =
  "OBSERVATION: === Testing _quote_match function === All quote_match tests passed! === Testing _quotes_are_needed function === _quotes_are_needed('value with [brackets]', True) = True";
const noProblemsResultObservationTranscript =
  'OBSERVATION: === Testing Single quotes required === Config: {quote-type: single, required: true} YAML content: --- key1: "value" Problems found: No problems found';
const mixedConcreteAndSuccessObservationTranscript =
  "OBSERVATION: === Testing parser === foo() = true All parser tests passed!";
const unittestSuccessObservationTranscript = "OBSERVATION: Ran 3 tests in 0.012s OK";
const pytestSuccessObservationTranscript =
  "OBSERVATION: ============================= 7 passed, 1 warning in 0.42s =============================";
const abbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import an...";
const rangeBasedAbbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>Output was shortened because this document exceeds display limits. This is a partial preview; request a specific line range to inspect more.</NOTE> 10 export function run() { 11 const value = 1;";
const lineFetchAbbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>The captured source is longer than the viewer can show in full. Showing a compact excerpt; fetch lines 120-180 to continue.</NOTE> 120 def main(): 121 import os";
const proceduralHarnessObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. 1. If you made any changes to your code after running the reproduction script, please run the reproduction script again. 2. Confirm the reproduction script passes before submitting.";
const mixedProceduralFailureObservationTranscript =
  "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes. The script exited with code 1 and the issue still does not work. 1. Run the reproduction script again after making changes. 2. Confirm the script exits with code 0 before submitting.";
const editMissObservationTranscript =
  "OBSERVATION: No replacement was performed, old_str `def emit(self, text_gen, margin_char=None):` was not found in the file.";
const failingTestObservationTranscript =
  "OBSERVATION: test_yes_no_for_booleans (tests.test_config.SimpleConfigTestCase) ... ERROR ====================================================================== ERROR: test_yes_no_for_booleans";

function observationSemantics(input: {
  kind: ObservationSemantics["kind"];
  polarity: ObservationSemantics["polarity"];
  origin: ObservationSemantics["provenance"]["origin"];
  subject: ObservationSemantics["subject"];
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
  owner?: ObservationSemantics["ownership"]["owner"];
  toolFamily?: string;
  evidenceLoss?: ObservationSemantics["evidenceLoss"];
  diagnosticClass?: ObservationSemantics["diagnosticClass"];
  recoveryHint?: ObservationSemantics["recoveryHint"];
  evidenceCertainty?: ObservationSemantics["evidenceCertainty"];
}): ObservationSemantics {
  return {
    kind: input.kind,
    polarity: input.polarity,
    ownership: {
      owner: input.owner ?? (input.toolFamily === undefined ? "source" : "tool"),
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    },
    subject: input.subject,
    evidenceLoss: input.evidenceLoss ?? "none",
    ...(input.diagnosticClass !== undefined ? { diagnosticClass: input.diagnosticClass } : {}),
    ...(input.recoveryHint !== undefined ? { recoveryHint: input.recoveryHint } : {}),
    provenance: { origin: input.origin },
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty: input.evidenceCertainty ?? "determinate",
  };
}

function payloadObservationSemantics(input: {
  summary: string;
  toolFamily?: string;
}): ObservationSemantics | null {
  const syntax = readTaskFailurePayloadObservationSyntax({
    summary: input.summary,
    toolFamily: input.toolFamily,
    structuredOutputEnvelope: readTaskFailureStructuredOutputEnvelope(
      input.summary,
      readSemanticStructuredOutputOwnership(input.toolFamily),
    ),
  });
  return syntax === null ? null : syntaxObservationSemantics({ kind: "payload", ...syntax });
}

function signalObservationSemantics(
  signal: ReturnType<typeof readTaskFailureSemanticSignals>,
): ObservationSemantics | null {
  return signal.observationSyntax === null
    ? null
    : syntaxObservationSemantics(signal.observationSyntax);
}

function evidenceObservationSemantics(
  evidence: ReturnType<typeof readTaskFailureSemanticEvidence>,
): ObservationSemantics | null {
  return evidence === null ? null : readTaskFailureObservationCore(evidence);
}

function syntaxObservationSemantics(
  observationSyntax: TaskFailureObservationSyntax,
): ObservationSemantics {
  return readTaskFailureObservationCore({
    kind: "observational_payload",
    observationSyntax,
    readsAsObservation: true,
    consequenceBaseline: "high",
    text: readSemanticTextEvidence(""),
  });
}

test("semantic text evidence classifies exact routine bash success observations", () => {
  const evidence = readSemanticTextEvidence(
    "OBSERVATION: Your command ran successfully and did not produce any output.",
    "bash",
  );

  assert.equal(hasSemanticTextShape(evidence, "routine_success"), true);
  assert.equal(hasSemanticTextShape(evidence, "terminal_failure"), false);
});

test("routine success observations stay tool-family bounded", () => {
  const evidence = readSemanticTextEvidence(
    "Your command ran successfully and did not produce any output.",
    "read",
  );

  assert.equal(hasSemanticTextShape(evidence, "routine_success"), false);
});

test("semantic command execution families are exact", () => {
  assert.equal(isSemanticCommandExecutionToolFamily("bash"), true);
  assert.equal(isSemanticCommandExecutionToolFamily("exec_command"), true);
  assert.equal(isSemanticCommandExecutionToolFamily("run_shell_command"), true);
  assert.equal(isSemanticCommandExecutionToolFamily("shell"), false);
  assert.equal(isSemanticCommandExecutionToolFamily("terminal"), false);
  assert.equal(isSemanticCommandExecutionToolFamily("exec_command_extra"), false);
  assert.equal(isSemanticCommandExecutionToolFamily(undefined), false);
});

test("Python location diagnostics are bounded event shapes", () => {
  for (const summary of [
    'File "/testbed/test_fixes.py", line 8 print("x") ^ SyntaxError: invalid syntax',
    `  File "/testbed/test_fixes.py", line 8 ${"x".repeat(760)} ^ SyntaxError: invalid syntax`,
  ]) {
    assert.equal(looksLikePythonLocationError(summary), true, summary);
  }

  for (const summary of [
    '\nFile "/testbed/test_fixes.py", line 8 ^ SyntaxError: invalid syntax',
    '\u2028File "/testbed/test_fixes.py", line 8 ^ SyntaxError: invalid syntax',
    '\u000bFile "/testbed/test_fixes.py", line 8 ^ SyntaxError: invalid syntax',
    `File "/testbed/test_fixes.py", line 8 ${"x".repeat(801)} ^ SyntaxError: invalid syntax`,
    'File "/testbed/test_fixes.py", line 8 ^ SyntaxError invalid syntax',
    'File "/testbed/test_fixes.py", line 8 should emit SyntaxError: in the expected output',
    'File "/testbed/test_fixes.py", line 8 ^ should emit SyntaxError: in the expected output',
    'The output said File "/testbed/test_fixes.py", line 8 SyntaxError: invalid syntax',
    'Expected output:\nFile "/testbed/test_fixes.py", line 8 SyntaxError: invalid syntax',
    'const expected = `\nFile "/testbed/test_fixes.py", line 8 SyntaxError: invalid syntax\n`;',
    'File "/testbed/test_fixes.py", line 8\nunrelated output\nSyntaxError: invalid syntax',
    'File\n"/testbed/test_fixes.py", line 8 SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py",\nline 8 SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line\n8 SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 SyntaxError\n: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 ^\u2028SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 ^\u2029SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 ^\u000bSyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 ^\u000cSyntaxError: invalid syntax',
    'File "/testbed/test\u0085_fixes.py", line 8 ^ SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 left\u0085right ^ SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 left\u001cright ^ SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 left\u001dright ^ SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 left\u001eright ^ SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.pyc", line 8 SyntaxError: invalid syntax',
    'File "/testbed/test_fixes.py", line 8 ^ CustomError: invalid syntax',
  ]) {
    assert.equal(looksLikePythonLocationError(summary), false, summary);
  }
});

test("Python exception group diagnostics are bounded event shapes", () => {
  for (const summary of [
    "exceptiongroup.ExceptionGroup: Group of errors (2 sub-exceptions)",
    "ExceptionGroup: Outer group (3 sub-exceptions)",
    "OBSERVATION: exceptiongroup.ExceptionGroup: Group of errors (2 sub-exceptions)",
    "OBSERVATION: ExceptionGroup: unhandled errors in a TaskGroup (1 sub-exception)",
  ]) {
    assert.equal(looksLikePythonExceptionGroupDiagnostic(summary), true, summary);
  }

  for (const summary of [
    "The exception group should be reported as ExceptionGroup: Group of errors (2 sub-exceptions).",
    "Expected output:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    "Sample output:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    "Fixture:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    "Reference diagnostics:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    'const expected = "ExceptionGroup: Group of errors (2 sub-exceptions)";',
    "ExceptionGroup: Group of errors",
    "ExceptionGroup: Group of errors (0 sub-exceptions)",
    "ExceptionGroup: Group of errors (2 sub-exceptions) while running tests",
    "ExceptionGroup should contain 2 sub-exceptions",
    "OBSERVATION: Running pytest should produce ExceptionGroup: Group of errors (2 sub-exceptions).",
  ]) {
    assert.equal(looksLikePythonExceptionGroupDiagnostic(summary), false, summary);
  }
});

test("compact operation success observations are bounded event shapes", () => {
  for (const summary of [
    "File created successfully at: /testbed/reproduce_error.py",
    "File created successfully at: /testbed/exception_test.py",
    "File created successfully at: /testbed/traceback_failed_error.py",
    "File created successfully at: ./tmp/reproduce_error.py",
    String.raw`File created successfully at: C:\tmp\reproduce_error.py`,
    "Created file: /testbed/reproduce_error.py",
    "Successfully wrote file ./tmp/reproduce_error.py",
    "File /testbed/reproduce_error.py was created successfully.",
    "The file /testbed/reproduce_error.py has been edited.",
    "Updated file: /testbed/reproduce_error.py",
    "File /testbed/reproduce_error.py was modified successfully.",
  ]) {
    assert.equal(looksLikeCompactOperationSuccessObservation(summary), true, summary);
  }

  for (const summary of [
    "Expected output: File created successfully at: /testbed/reproduce_error.py",
    "File created successfully at: /testbed/reproduce_error.py and then run it",
    "File created successfully at:",
    "File created successfully at: reproduce_error.py",
    "File created successfully at: https://example.com/reproduce_error.py",
    "File created successfully at: /tmp/<path>",
    "File created successfully at: /tmp/reproduce_error.py...",
    'File created successfully at: "/tmp/reproduce_error.py"',
    'const message = "File created successfully at: /testbed/reproduce_error.py";',
    "File created successfully at: /testbed/reproduce_error.py\nexport const value = 1;",
    "The file /testbed/reproduce_error.py has not been edited.",
    "Created file: /testbed/reproduce_error.py and then ran it",
    "File /testbed/reproduce_error.py was not updated.",
  ]) {
    assert.equal(looksLikeCompactOperationSuccessObservation(summary), false, summary);
  }

  assert.deepEqual(
    readExplicitOperationSuccessObservationTranscript(
      "OBSERVATION: File created successfully at: /testbed/reproduce_error.py",
    ),
    { kind: "file_created", consequenceBaseline: "low" },
  );
  assert.deepEqual(
    readExplicitOperationSuccessObservationTranscript(
      "File created successfully at: /testbed/reproduce_error.py",
    ),
    null,
  );
});

test("linter output observations count findings outside quoted fixture spans", () => {
  for (const summary of [
    'Running yamllint... ./.yamllint 1:1 warning missing document start "---" (document-start) ./normal.yaml 1:1 warning missing document start "---" (document-start) ./ign-dup/duplicates.yaml 1:1 warning missing document start "---" (document-start) ...',
    'Here\'s yamllint output: ./.yamllint 1:1 warning missing document start "---" (document-start) ./normal.yaml 1:1 warning missing document start "---" (document-start) ...',
    'Tool\'s lint output: ./normal.yaml 1:1 warning missing document start "---" (document-start)',
    'Developers\' lint output: ./normal.yaml 1:1 warning missing document start "---" (document-start)',
    "Prefix 'clean' then lint output: ./normal.yaml 1:1 warning missing document start \"---\" (document-start)",
    "Prefix 'status' then lint output: ./normal.yaml 1:1 warning missing document start \"---\" (document-start)",
    'Running yamllint...\n./normal.yaml 1:1 warning missing document start "---" (document-start)',
    'logger.info("foo.yaml 1:1 warning fixture (rule)") ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
    'logger.error("foo.yaml 1:1 error fixture (rule)") ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
  ]) {
    assert.equal(looksLikeLinterOutputObservation(summary), true, summary);
  }

  for (const summary of [
    'foo.yaml 1:1 warning missing document start "---" (document-start)',
    'message = "foo.yaml 1:1 warning missing document start \\"---\\" (document-start)"',
    'print("foo.yaml 1:1 warning missing document start \\"---\\" (document-start)")',
    'logger.warning("foo.yaml 1:1 warning missing document start \\"---\\" (document-start)")',
    'process.stdout.write("foo.yaml 1:1 warning missing document start \\"---\\" (document-start)")',
    'const fixture = `foo.yaml 1:1 warning missing document start "---" (document-start)`;',
    `logger.warning("${"x".repeat(300)} foo.yaml 1:1 warning fixture (rule) bar.yaml 2:2 warning fixture (rule)")`,
    "const fixture = `foo.yaml 1:1 warning fixture (rule)\nbar.yaml 2:2 warning fixture (rule)`;",
    "const fixture = 'developers' lint output: foo.yaml 1:1 warning fixture (rule) bar.yaml 2:2 warning fixture (rule)';",
    "const fixture = 'status' then lint output: foo.yaml 1:1 warning fixture (rule) bar.yaml 2:2 warning fixture (rule)';",
    'Expected output: foo.yaml 1:1 warning missing document start "---" (document-start)',
    'Please verify foo.yaml 1:1 warning missing document start "---" (document-start)',
    'Running yamllint... ./normal.yaml 1:1 warning missing document start "---" (document-start) ./bad.yaml 2:4 error wrong indentation (indentation)',
  ]) {
    assert.equal(looksLikeLinterOutputObservation(summary), false, summary);
  }
});

test("task failure semantic signals are auditable and boundary scoped", () => {
  const rawUsageDiagnostic =
    "usage: rocprof-compute [mode] [options] tool: error: argument --list-metrics: invalid choice: 'gfx1151'";
  const searchFailureSummary = 'Web search results for "ledger": backend is unavailable';
  const runtimePanic = "panic: unable to open database file: not a directory";
  const sourcePanicLabel = "#include <stdio.h>\nint main() {\npanic: return 1;\n}\n";
  const clippedAssignmentPanicLabel =
    "#include <stdio.h>\nint main() {\npanic: error = cleanup()\nreturn 0;\n}\n";
  const compoundSourcePanicLiteral =
    'const message = "Failed to execute: query; panic: cleanup();";\nreturn message;';
  const realisticCompoundSourcePanicLiteral =
    'const message = "Failed to execute: query; panic: unable to open database file";\nreturn message;';
  const exceptionGroupSourceFixture =
    '# fixture\nexpected = "ExceptionGroup: Group of errors (2 sub-exceptions)"\ndef test_exception_group():\n    assert expected';
  const failedLiteralSourceObservation = "OBSERVATION: const result = `1 failed`; return result;";
  const failedLiteralReadbackObservation =
    'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const expected = "1 failed";';
  const failedLiteralCommentedSourceObservation =
    "OBSERVATION: // fixture: FAILED (failures=1, errors=0)\nexport const expected = true;";
  const failedPhraseSourceObservation =
    "OBSERVATION: const message = `test failed`; return message;";
  const failedPhraseReadbackObservation =
    'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const message = "test failed";';
  const failedPhraseCommentedSourceObservation =
    "OBSERVATION: // fixture: tests failed\nexport const expected = true;";
  const directFailedLiteralObservation = "OBSERVATION: 1 failed";
  const directFailedPhraseObservation = "OBSERVATION: test failed: expected 1";
  const negatedFailedTestsObservation = "OBSERVATION: No tests failed. 0 failed.";
  const editNotReadError =
    "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>";
  const editModifiedSinceReadError =
    "<tool_use_error>File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.</tool_use_error>";
  const editAppliedReadback =
    "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;";
  const editReplacementMiss =
    "Could not find the exact text in /repo/src/app.ts. The old text must match exactly including all whitespace and newlines.";
  const editIndexedReplacementMiss =
    "Could not find edits[1] in /repo/src/app.ts. The oldText must match exactly including all whitespace and newlines.";
  const editAmbiguousReplacement =
    "Found 2 occurrences of the text in /repo/src/app.ts. The text must be unique. Please provide more context to make it unique.";

  const rawCommandDiagnostic = readTaskFailureSemanticSignals({
    summary: rawUsageDiagnostic,
    toolFamily: "exec_command",
  });
  assert.equal(rawCommandDiagnostic.structuredOutputEnvelope.kind, "raw");
  assert.equal(rawCommandDiagnostic.rawToolOutputFailureDiagnostic, true);
  assert.equal(rawCommandDiagnostic.diagnosticStructuredToolOutput, null);
  assert.equal(rawCommandDiagnostic.readFailureDiagnostic, false);
  assert.equal(rawCommandDiagnostic.searchFailureDiagnostic, false);

  const rawEditDiagnostic = readTaskFailureSemanticSignals({
    summary: rawUsageDiagnostic,
    toolFamily: "edit",
  });
  assert.equal(rawEditDiagnostic.structuredOutputEnvelope.kind, "raw");
  assert.equal(rawEditDiagnostic.rawToolOutputFailureDiagnostic, true);
  assert.equal(rawEditDiagnostic.editOutputOutcome, null);

  const rawEditNotReadError = readTaskFailureSemanticSignals({
    summary: editNotReadError,
    toolFamily: "edit",
  });
  assert.equal(rawEditNotReadError.structuredOutputEnvelope.kind, "raw");
  assert.equal(rawEditNotReadError.editOutputOutcome, "failure");
  assert.equal(rawEditNotReadError.rawToolOutputFailureDiagnostic, false);

  const rawEditModifiedSinceReadError = readTaskFailureSemanticSignals({
    summary: editModifiedSinceReadError,
    toolFamily: "edit",
  });
  assert.equal(rawEditModifiedSinceReadError.editOutputOutcome, "failure");

  const rawEditPatchError = readTaskFailureSemanticSignals({
    summary: "apply_patch error",
    toolFamily: "edit",
  });
  assert.equal(rawEditPatchError.editOutputOutcome, "failure");

  const rawEditError = readTaskFailureSemanticSignals({
    summary: "edit error",
    toolFamily: "edit",
  });
  assert.equal(rawEditError.editOutputOutcome, "failure");

  const rawWriteError = readTaskFailureSemanticSignals({
    summary: "write error",
    toolFamily: "edit",
  });
  assert.equal(rawWriteError.editOutputOutcome, "failure");

  const rawEditReplacementMiss = readTaskFailureSemanticSignals({
    summary: editReplacementMiss,
    toolFamily: "edit",
  });
  assert.equal(rawEditReplacementMiss.editOutputOutcome, "failure");

  const rawEditIndexedReplacementMiss = readTaskFailureSemanticSignals({
    summary: editIndexedReplacementMiss,
    toolFamily: "edit",
  });
  assert.equal(rawEditIndexedReplacementMiss.editOutputOutcome, "failure");

  const rawEditAmbiguousReplacement = readTaskFailureSemanticSignals({
    summary: editAmbiguousReplacement,
    toolFamily: "edit",
  });
  assert.equal(rawEditAmbiguousReplacement.editOutputOutcome, "failure");

  const readOwnedEditNotReadText = readTaskFailureSemanticSignals({
    summary: editNotReadError,
    toolFamily: "read",
  });
  assert.equal(readOwnedEditNotReadText.structuredOutputEnvelope.kind, "unsupported");
  assert.equal(readOwnedEditNotReadText.editOutputOutcome, null);
  const readOwnedAbbreviatedFileView = readTaskFailureSemanticSignals({
    summary: abbreviatedFileViewObservationTranscript,
    toolFamily: "read",
  });
  assert.deepEqual(signalObservationSemantics(readOwnedAbbreviatedFileView), {
    kind: "payload",
    polarity: "neutral",
    ownership: { owner: "tool", toolFamily: "read" },
    subject: "source",
    evidenceLoss: "none",
    provenance: { origin: "read_output" },
    consequenceBaseline: "low",
    evidenceCertainty: "determinate",
  });
  assert.notEqual(
    readTaskFailureSemanticSignals({
      summary: abbreviatedFileViewObservationTranscript,
      toolFamily: "bash",
    }).observationSyntax?.origin,
    "read_output",
    "read-owned abbreviated-file-view signal stays tool-family bounded",
  );

  const rawEditAppliedReadback = readTaskFailureSemanticSignals({
    summary: editAppliedReadback,
    toolFamily: "edit",
  });
  assert.equal(rawEditAppliedReadback.editOutputOutcome, "applied");

  const structuredEditAppliedReadback = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ wall_time: "0.0510 seconds", output: editAppliedReadback }),
    toolFamily: "edit",
  });
  assert.equal(structuredEditAppliedReadback.structuredOutputEnvelope.kind, "valid");
  assert.equal(structuredEditAppliedReadback.editOutputOutcome, "applied");

  const recoveredEditAppliedReadback = readTaskFailureSemanticSignals({
    summary: `{"wall_time":"0.0510 seconds","output":"${editAppliedReadback}`,
    toolFamily: "edit",
  });
  assert.equal(recoveredEditAppliedReadback.structuredOutputEnvelope.kind, "recovered");
  assert.equal(recoveredEditAppliedReadback.editOutputOutcome, "applied");

  const invalidEditOutputOnlyReadback = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ output: editAppliedReadback }),
    toolFamily: "edit",
  });
  assert.equal(invalidEditOutputOnlyReadback.structuredOutputEnvelope.kind, "invalid");
  assert.equal(invalidEditOutputOnlyReadback.editOutputOutcome, null);

  const invalidEditExtraKeyReadback = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ output: editAppliedReadback, status: "ok" }),
    toolFamily: "edit",
  });
  assert.equal(invalidEditExtraKeyReadback.structuredOutputEnvelope.kind, "invalid");
  assert.equal(invalidEditExtraKeyReadback.editOutputOutcome, null);

  const rawReadUsageText = readTaskFailureSemanticSignals({
    summary: rawUsageDiagnostic,
    toolFamily: "read",
  });
  assert.equal(rawReadUsageText.structuredOutputEnvelope.kind, "unsupported");
  assert.equal(rawReadUsageText.rawToolOutputFailureDiagnostic, false);
  assert.equal(rawReadUsageText.readFailureDiagnostic, false);

  const rawSearchUsageText = readTaskFailureSemanticSignals({
    summary: rawUsageDiagnostic,
    toolFamily: "search",
  });
  assert.equal(rawSearchUsageText.structuredOutputEnvelope.kind, "unsupported");
  assert.equal(rawSearchUsageText.rawToolOutputFailureDiagnostic, false);
  assert.equal(rawSearchUsageText.searchFailureDiagnostic, false);

  const searchFailure = readTaskFailureSemanticSignals({
    summary: searchFailureSummary,
    toolFamily: "search",
  });
  assert.equal(searchFailure.searchFailureDiagnostic, true);
  assert.equal(searchFailure.rawToolOutputFailureDiagnostic, false);

  for (const toolFamily of ["read", "bash", "exec_command", "run_shell_command", "edit"]) {
    const signal = readTaskFailureSemanticSignals({
      summary: searchFailureSummary,
      toolFamily,
    });
    assert.equal(signal.searchFailureDiagnostic, false, `${toolFamily} does not own search errors`);
  }

  const validStructuredRuntimeDiagnostic = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"panic: unable to open database file: not a directory"}',
    toolFamily: "bash",
  });
  assert.equal(validStructuredRuntimeDiagnostic.structuredOutputEnvelope.kind, "valid");
  assert.equal(validStructuredRuntimeDiagnostic.structuredOutputFailureDiagnostic, true);
  assert.equal(validStructuredRuntimeDiagnostic.rawToolOutputFailureDiagnostic, false);

  const structuredSourceLiteral = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"const message = \\"rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log\\";\\nreturn message;"}',
    toolFamily: "bash",
  });
  assert.equal(structuredSourceLiteral.structuredOutputEnvelope.kind, "valid");
  assert.notEqual(structuredSourceLiteral.diagnosticStructuredToolOutput, null);
  assert.equal(
    signalObservationSemantics(structuredSourceLiteral)?.provenance.origin,
    "structured_output",
  );
  assert.equal(structuredSourceLiteral.structuredOutputFailureDiagnostic, false);
  assert.equal(structuredSourceLiteral.rawToolOutputFailureDiagnostic, false);

  const structuredCompoundSourceLiteral = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ wall_time: "0.0510 seconds", output: compoundSourcePanicLiteral }),
    toolFamily: "bash",
  });
  assert.equal(structuredCompoundSourceLiteral.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(structuredCompoundSourceLiteral)?.provenance.origin,
    "structured_output",
  );
  assert.equal(structuredCompoundSourceLiteral.structuredOutputFailureDiagnostic, false);
  assert.equal(structuredCompoundSourceLiteral.rawToolOutputFailureDiagnostic, false);

  const structuredRealisticCompoundSourceLiteral = readTaskFailureSemanticSignals({
    summary: JSON.stringify({
      wall_time: "0.0510 seconds",
      output: realisticCompoundSourcePanicLiteral,
    }),
    toolFamily: "bash",
  });
  assert.equal(structuredRealisticCompoundSourceLiteral.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(structuredRealisticCompoundSourceLiteral)?.provenance.origin,
    "structured_output",
  );
  assert.equal(structuredRealisticCompoundSourceLiteral.structuredOutputFailureDiagnostic, false);
  assert.equal(structuredRealisticCompoundSourceLiteral.rawToolOutputFailureDiagnostic, false);

  const structuredExceptionGroupSourceFixture = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ wall_time: "0.0510 seconds", output: exceptionGroupSourceFixture }),
    toolFamily: "bash",
  });
  assert.equal(structuredExceptionGroupSourceFixture.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(structuredExceptionGroupSourceFixture)?.provenance.origin,
    "structured_output",
  );
  assert.equal(structuredExceptionGroupSourceFixture.structuredOutputFailureDiagnostic, false);
  assert.equal(structuredExceptionGroupSourceFixture.strongSourceRuntimeDiagnostic, false);

  const validStructuredSourceLabel = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ wall_time: "0.0510 seconds", output: sourcePanicLabel }),
    toolFamily: "bash",
  });
  assert.equal(validStructuredSourceLabel.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(validStructuredSourceLabel)?.provenance.origin,
    "structured_output",
  );
  assert.equal(validStructuredSourceLabel.structuredOutputFailureDiagnostic, false);
  assert.equal(validStructuredSourceLabel.strongSourceRuntimeDiagnostic, false);

  const validStructuredAssignmentLabel = readTaskFailureSemanticSignals({
    summary: JSON.stringify({ wall_time: "0.0510 seconds", output: clippedAssignmentPanicLabel }),
    toolFamily: "bash",
  });
  assert.equal(validStructuredAssignmentLabel.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(validStructuredAssignmentLabel)?.provenance.origin,
    "structured_output",
  );
  assert.equal(validStructuredAssignmentLabel.structuredOutputFailureDiagnostic, false);
  assert.equal(validStructuredAssignmentLabel.strongSourceRuntimeDiagnostic, false);

  const recoveredStructuredDiagnostic = readTaskFailureSemanticSignals({
    summary: `{"wall_time":"0.0510 seconds","output":"${runtimePanic}`,
    toolFamily: "bash",
  });
  assert.equal(recoveredStructuredDiagnostic.structuredOutputEnvelope.kind, "recovered");
  assert.notEqual(recoveredStructuredDiagnostic.diagnosticStructuredToolOutput, null);
  assert.equal(recoveredStructuredDiagnostic.structuredOutputFailureDiagnostic, true);
  assert.equal(recoveredStructuredDiagnostic.rawToolOutputFailureDiagnostic, false);

  const recoveredStructuredSourceLabel = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() {\\npanic: return 1;\\n}\\n',
    toolFamily: "bash",
  });
  assert.equal(recoveredStructuredSourceLabel.structuredOutputEnvelope.kind, "recovered");
  assert.equal(
    signalObservationSemantics(recoveredStructuredSourceLabel)?.provenance.origin,
    "structured_output",
  );
  assert.equal(recoveredStructuredSourceLabel.structuredOutputFailureDiagnostic, false);
  assert.equal(recoveredStructuredSourceLabel.rawToolOutputFailureDiagnostic, false);

  const recoveredStructuredAssignmentLabel = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() {\\npanic: error = cleanup()\\nreturn 0;\\n}\\n',
    toolFamily: "bash",
  });
  assert.equal(recoveredStructuredAssignmentLabel.structuredOutputEnvelope.kind, "recovered");
  assert.equal(
    signalObservationSemantics(recoveredStructuredAssignmentLabel)?.provenance.origin,
    "structured_output",
  );
  assert.equal(recoveredStructuredAssignmentLabel.structuredOutputFailureDiagnostic, false);
  assert.equal(recoveredStructuredAssignmentLabel.rawToolOutputFailureDiagnostic, false);

  const recoveredRealisticCompoundSourceLiteral = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"const message = \\"Failed to execute: query; panic: unable to open database file\\";\\nreturn message;',
    toolFamily: "bash",
  });
  assert.equal(recoveredRealisticCompoundSourceLiteral.structuredOutputEnvelope.kind, "recovered");
  assert.equal(
    signalObservationSemantics(recoveredRealisticCompoundSourceLiteral)?.provenance.origin,
    "structured_output",
  );
  assert.equal(recoveredRealisticCompoundSourceLiteral.structuredOutputFailureDiagnostic, false);
  assert.equal(recoveredRealisticCompoundSourceLiteral.rawToolOutputFailureDiagnostic, false);

  const invalidStructuredDiagnostic = readTaskFailureSemanticSignals({
    summary: '{"wall_time":"nope","output":"panic: unable to open database file"}',
    toolFamily: "bash",
  });
  assert.equal(invalidStructuredDiagnostic.structuredOutputEnvelope.kind, "invalid");
  assert.equal(invalidStructuredDiagnostic.structuredOutputFailureDiagnostic, false);
  assert.equal(invalidStructuredDiagnostic.rawToolOutputFailureDiagnostic, false);

  const missingToolExactSource = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
  });
  assert.equal(missingToolExactSource.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(missingToolExactSource)?.provenance.origin,
    "structured_output",
  );

  const opaqueToolExactSource = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts"}',
    toolFamily: "opaque_runner",
  });
  assert.equal(opaqueToolExactSource.structuredOutputEnvelope.kind, "valid");
  assert.equal(
    signalObservationSemantics(opaqueToolExactSource)?.provenance.origin,
    "structured_output",
  );

  const explicitReadExactSource = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
    toolFamily: "read",
  });
  assert.equal(explicitReadExactSource.structuredOutputEnvelope.kind, "unsupported");
  assert.equal(signalObservationSemantics(explicitReadExactSource), null);

  const zeroExitSingleDocumentRow =
    '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Test failed is documented here..."}';
  for (const toolFamily of ["bash", "exec_command", "run_shell_command"]) {
    const signal = readTaskFailureSemanticSignals({
      summary: zeroExitSingleDocumentRow,
      toolFamily,
    });
    assert.equal(signal.structuredOutputEnvelope.kind, "valid");
    assert.equal(
      signalObservationSemantics(signal)?.provenance.origin,
      "structured_output",
      `${toolFamily} owns zero-exit single document rows`,
    );
    assert.equal(signalObservationSemantics(signal)?.subject, "tool");
  }
  assert.equal(
    readTaskFailureSemanticSignals({
      summary: JSON.stringify({
        exit_code: 0,
        wall_time: "0.0510 seconds",
        output: "Bash failure docs/guide.md:17:Test failed is documented here...",
      }),
      toolFamily: "bash",
    }).observationSyntax?.origin,
    "structured_output",
    "single listing status-prefix stripping is case-insensitive",
  );

  const zeroExitSingleSourceRow = readTaskFailureSemanticSignals({
    summary:
      '{"exit_code":0,"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31...',
    toolFamily: "bash",
  });
  assert.equal(
    signalObservationSemantics(zeroExitSingleSourceRow)?.provenance.origin,
    "structured_output",
  );
  assert.equal(signalObservationSemantics(zeroExitSingleSourceRow)?.subject, "source");

  for (const [summary, expectedObservation] of [
    [
      JSON.stringify({
        exit_code: 0,
        wall_time: "0.0510 seconds",
        output: "=== Testing exception formatting === All exception formatting tests passed!",
      }),
      true,
    ],
    [
      JSON.stringify({
        exit_code: 0,
        wall_time: "0.0510 seconds",
        output: "/repo/test_nunchaku/quantize.py:34: UserWarning: test failed is documented here",
      }),
      false,
    ],
  ] as const) {
    const signal = readTaskFailureSemanticSignals({ summary, toolFamily: "bash" });
    assert.equal(signalObservationSemantics(signal)?.kind === "payload", expectedObservation);
    assert.equal(
      signalObservationSemantics(signal)?.subject === "tool" &&
        signalObservationSemantics(signal)?.provenance.origin === "structured_output",
      expectedObservation,
      "pre-existing owned payload shapes do not borrow the single-listing signal",
    );
  }

  for (const [toolFamily, summary] of [
    ["edit", zeroExitSingleDocumentRow],
    ["opaque_runner", zeroExitSingleDocumentRow],
    [undefined, zeroExitSingleDocumentRow],
    ["bash", '{"exit_code":0,"wall_time":"0.0510 seconds","output":"# Heading..."}'],
    [
      "bash",
      '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Build notes...\\nextra prose',
    ],
  ] as const) {
    const signal = readTaskFailureSemanticSignals({ summary, toolFamily });
    assert.equal(
      signalObservationSemantics(signal)?.kind === "payload" &&
        signalObservationSemantics(signal)?.provenance.origin === "structured_output",
      false,
      `${toolFamily ?? "missing tool"} does not own a single-row listing exception for ${summary}`,
    );
  }

  const missingToolTruncatedEnvelope = readTaskFailureSemanticSignals({
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }',
  });
  assert.equal(missingToolTruncatedEnvelope.structuredOutputEnvelope.kind, "invalid");
  assert.equal(signalObservationSemantics(missingToolTruncatedEnvelope), null);

  const rawReadPanic = readTaskFailureSemanticSignals({
    summary: runtimePanic,
    toolFamily: "read",
  });
  assert.equal(rawReadPanic.structuredOutputEnvelope.kind, "unsupported");
  assert.equal(rawReadPanic.rawToolOutputFailureDiagnostic, false);
  assert.equal(rawReadPanic.readFailureDiagnostic, true);

  const panicLabel = readTaskFailureSemanticSignals({
    summary: sourcePanicLabel,
    toolFamily: "bash",
  });
  assert.equal(panicLabel.structuredOutputEnvelope.kind, "raw");
  assert.equal(panicLabel.rawToolOutputFailureDiagnostic, false);
  assert.equal(panicLabel.structuredOutputFailureDiagnostic, false);

  const clippedAssignmentLabel = readTaskFailureSemanticSignals({
    summary: clippedAssignmentPanicLabel,
    toolFamily: "bash",
  });
  assert.equal(clippedAssignmentLabel.structuredOutputEnvelope.kind, "raw");
  assert.equal(clippedAssignmentLabel.rawToolOutputFailureDiagnostic, false);
  assert.equal(clippedAssignmentLabel.structuredOutputFailureDiagnostic, false);

  const compoundSourceLiteral = readTaskFailureSemanticSignals({
    summary: compoundSourcePanicLiteral,
    toolFamily: "bash",
  });
  assert.equal(compoundSourceLiteral.structuredOutputEnvelope.kind, "raw");
  assert.equal(compoundSourceLiteral.rawToolOutputFailureDiagnostic, false);
  assert.equal(compoundSourceLiteral.structuredOutputFailureDiagnostic, false);

  const realisticCompoundSourceLiteral = readTaskFailureSemanticSignals({
    summary: realisticCompoundSourcePanicLiteral,
    toolFamily: "bash",
  });
  assert.equal(realisticCompoundSourceLiteral.structuredOutputEnvelope.kind, "raw");
  assert.equal(realisticCompoundSourceLiteral.rawToolOutputFailureDiagnostic, false);
  assert.equal(realisticCompoundSourceLiteral.structuredOutputFailureDiagnostic, false);

  const panicAssignmentLabel = readTaskFailureSemanticSignals({
    summary: "panic: error = cleanup();",
    toolFamily: "bash",
  });
  assert.equal(panicAssignmentLabel.structuredOutputEnvelope.kind, "raw");
  assert.equal(panicAssignmentLabel.rawToolOutputFailureDiagnostic, false);
  assert.equal(panicAssignmentLabel.structuredOutputFailureDiagnostic, false);

  for (const summary of [
    failedLiteralSourceObservation,
    failedLiteralReadbackObservation,
    failedLiteralCommentedSourceObservation,
    failedPhraseSourceObservation,
    failedPhraseReadbackObservation,
    failedPhraseCommentedSourceObservation,
  ]) {
    const signal = readTaskFailureSemanticSignals({ summary });
    assert.equal(signal.diagnosticObservationTranscript, false);
    assert.deepEqual(signalObservationSemantics(signal), {
      kind: "payload",
      polarity: "neutral",
      ownership: { owner: "source" },
      subject: "tool",
      evidenceLoss: "none",
      provenance: { origin: "transcript" },
      consequenceBaseline: "high",
      evidenceCertainty: "determinate",
    });
  }

  const directFailedLiteral = readTaskFailureSemanticSignals({
    summary: directFailedLiteralObservation,
  });
  assert.equal(directFailedLiteral.diagnosticObservationTranscript, true);
  assert.equal(signalObservationSemantics(directFailedLiteral), null);

  const directFailedPhrase = readTaskFailureSemanticSignals({
    summary: directFailedPhraseObservation,
  });
  assert.equal(directFailedPhrase.diagnosticObservationTranscript, true);
  assert.equal(signalObservationSemantics(directFailedPhrase), null);

  const negatedFailedTests = readTaskFailureSemanticSignals({
    summary: negatedFailedTestsObservation,
  });
  assert.equal(negatedFailedTests.diagnosticObservationTranscript, false);
  assert.equal(signalObservationSemantics(negatedFailedTests), null);
});

test("tool-use rejection outcome shape requires coherent full-message clauses", () => {
  assert.equal(looksLikeToolUseRejectionOutcome(rejectedToolUseMessage), true);
  assert.equal(looksLikeToolUseRejectionOutcome(declinedActionMessage), true);
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user doesn’t want to take this action right now! STOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "OBSERVATION:\nThe user doesn’t want to proceed with this tool use.\nThe tool use was rejected.\nSTOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user does not want to proceed with this tool use. Tool use rejected. Stop and wait for the user to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user does not want to take this action. Stop and wait for the user to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user doesn't want to proceed with this tool use! The tool use was rejected (for example, no file contents were changed). STOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user doesn't want to proceed with this tool use! The tool use was rejected (e.g. no file contents were changed). STOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    true,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user doesn't want to proceed with this tool use. The tool use was rejected (if this was a write operation, no mutation happened). STOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    true,
  );

  assert.equal(looksLikeToolUseRejectionOutcome(`log: ${rejectedToolUseMessage}`), false);
  assert.equal(looksLikeToolUseRejectionOutcome(`"${rejectedToolUseMessage}"`), false);
  assert.equal(
    looksLikeToolUseRejectionOutcome(`${rejectedToolUseMessage} Traceback follows.`),
    false,
  );
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "If the tool use was rejected, stop what you are doing and wait.",
    ),
    false,
  );
  assert.equal(looksLikeToolUseRejectionOutcome("The remote service rejected the request."), false);
  assert.equal(looksLikeToolUseRejectionOutcome("The tool use was rejected."), false);
  assert.equal(looksLikeToolUseRejectionOutcome("The user rejected this recommendation."), false);
  assert.equal(
    looksLikeToolUseRejectionOutcome(
      "The user doesn't want to proceed with this tool use. The tool use was rejected (this parenthetical is not explanatory). STOP what you are doing and wait for the user to tell you how to proceed.",
    ),
    false,
  );
});

test("tool-use rejection signal excludes explicit observation transcript recovery", () => {
  for (const body of [
    "The tool use was rejected. Here is the result of running `cat -n` on /tmp/file.ts: 1 export const x = 1;",
    "The user doesn't want to proceed. Here is the result of running `cat -n` on /tmp/file.ts: 1 export const x = 1;",
    "The user doesn't want to take this action right now. Here is the result of running `cat -n` on /tmp/file.ts: 1 export const x = 1;",
    "STOP what you are doing and wait. Here is the result of running `cat -n` on /tmp/file.ts: 1 export const x = 1;",
  ]) {
    assert.equal(hasToolUseRejectionSignal(body), true);
    assert.equal(looksLikeExplicitObservationTranscript(`OBSERVATION: ${body}`), false);
  }
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

  assert.equal(hasSemanticTextShape(traceback, "routine_success"), false);
  assert.equal(hasSemanticTextShape(traceback, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(exitCode, "routine_success"), false);
  assert.equal(hasSemanticTextShape(exitCode, "terminal_failure"), true);
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

  assert.equal(hasSemanticTextShape(exitCodeZero, "routine_success"), true);
  assert.equal(hasSemanticTextShape(exitCodeZero, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(exitCodeZeroWithIssue, "routine_success"), false);
  assert.equal(hasSemanticTextShape(exitCodeZeroWithIssue, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(exitCodeZeroWithConnector, "routine_success"), true);
  assert.equal(hasSemanticTextShape(exitCodeZeroWithConnector, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(jsonExitCodeZero, "routine_success"), true);
  assert.equal(hasSemanticTextShape(jsonExitCodeZero, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(nonzeroExitCode, "routine_success"), false);
  assert.equal(hasSemanticTextShape(nonzeroExitCode, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(nonzeroExitCodeWithConnector, "routine_success"), false);
  assert.equal(hasSemanticTextShape(nonzeroExitCodeWithConnector, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(jsonNonzeroExitCode, "routine_success"), false);
  assert.equal(hasSemanticTextShape(jsonNonzeroExitCode, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(negatedException, "expected_diagnostic"), true);
  assert.equal(hasSemanticTextShape(negatedException, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(expectedException, "expected_diagnostic"), true);
  assert.equal(hasSemanticTextShape(expectedException, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(realTraceback, "expected_diagnostic"), false);
  assert.equal(hasSemanticTextShape(realTraceback, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(benignThenRealException, "expected_diagnostic"), false);
  assert.equal(hasSemanticTextShape(benignThenRealException, "terminal_failure"), true);
  assert.equal(hasSemanticTextShape(benignThenRealPermissionDenied, "terminal_failure"), true);
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

  assert.equal(hasSemanticTextShape(log, "tagged_file"), true);
  assert.equal(hasSemanticTextShape(log, "read_payload"), false);
  assert.equal(hasSemanticTextShape(log, "log"), true);
  assert.equal(hasSemanticTextShape(log, "source_code"), false);
  assert.equal(hasSemanticTextShape(source, "tagged_file"), true);
  assert.equal(hasSemanticTextShape(source, "read_payload"), true);
  assert.equal(hasSemanticTextShape(source, "source_code"), true);
  assert.equal(hasSemanticTextShape(source, "log"), false);
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

  assert.equal(hasSemanticTextShape(search, "search_result"), true);
  assert.equal(hasSemanticTextShape(buildMetadata, "build_metadata"), true);
});

test("sectioned test result parser applies explicit precedence boundaries", () => {
  assert.equal(
    readSectionedTestOutputObservation(
      "=== Testing parser === foo() = true All parser tests passed!",
    ),
    "concrete",
  );
  assert.equal(
    looksLikeSectionedTestOutputFailure(
      "=== Testing parser === foo() = true All parser tests passed!",
    ),
    false,
  );

  for (const directive of [
    "=== Testing parser === Expected output: FAIL",
    "=== Testing parser === The final response should say ERROR",
    "=== Testing parser === Validate foo() = true",
    "=== Testing parser === Expect foo() = true",
  ]) {
    assert.equal(readSectionedTestOutputObservation(directive), null, directive);
    assert.equal(looksLikeSectionedTestOutputFailure(directive), false, directive);
  }

  for (const source of [
    '=== Testing parser === async function parse() {\n  throw new Error("bad");\n}',
    '=== Testing parser === async def parse():\n    raise AssertionError("bad")',
    '=== Testing parser === @dataclass\nclass ErrorCase:\n    message: str = "Failures: 1"',
    "=== Testing parser === error_handler:\n  mov rax, 1\n  call report_assertion\n  ret",
    "=== Testing parser === failure_path:\n  mov rax, 0\n  call report_failure\n  ret",
  ]) {
    assert.equal(readSectionedTestOutputObservation(source), null, source);
    assert.equal(looksLikeSectionedTestOutputFailure(source), false, source);
    assert.equal(
      readExplicitObservationTranscript(`OBSERVATION: ${source}`)?.shape,
      "existing_observation",
    );
  }

  for (const failure of [
    "=== Testing parser === FAIL: expected output foo, got bar",
    "=== Testing parser === AssertionError: expected output foo, got bar",
    "=== Testing parser === ERROR: final response differed",
    "=== Testing parser === [ 10%] Building parser object\n[ 20%] Linking parser target\nERROR: expected 1",
  ]) {
    assert.equal(readSectionedTestOutputObservation(failure), null, failure);
    assert.equal(looksLikeSectionedTestOutputFailure(failure), true, failure);
  }

  const failureBeforeSource =
    "=== Testing parser === FAIL:\nconst x = 1;\nfunction actual() { return x; }";
  assert.equal(readSectionedTestOutputObservation(failureBeforeSource), null);
  assert.equal(looksLikeSectionedTestOutputFailure(failureBeforeSource), true);
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

  assert.equal(hasSemanticTextShape(diagnostic, "expected_diagnostic"), true);
  assert.equal(hasSemanticTextShape(diagnostic, "terminal_failure"), false);
  assert.equal(hasSemanticTextShape(traceback, "expected_diagnostic"), false);
  assert.equal(hasSemanticTextShape(traceback, "terminal_failure"), true);
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

test("task failure semantic signals compile execution observations into one field", () => {
  const summary = '{"exit_code":0,"wall_time":"0.0510 seconds","output":"No output."}';
  const signals = readTaskFailureSemanticSignals({ summary });

  assert.deepEqual(signalObservationSemantics(signals), {
    kind: "outcome",
    polarity: "success",
    ownership: { owner: "source" },
    subject: "tool",
    evidenceLoss: "none",
    provenance: { origin: "structured_output" },
    consequenceBaseline: "low",
    evidenceCertainty: "determinate",
  });
});

test("task failure payload observation grammar emits canonical source and read documents", () => {
  const cases = [
    {
      name: "read truncation protocol",
      summary:
        "IMPORTANT: The file content has been truncated. Status: Showing lines 1-50 of 120 total lines. Action: To read more of the file, you can use the 'offset' and 'limit' parameters.",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "document",
        consequenceBaseline: "low",
        toolFamily: "read",
      }),
    },
    {
      name: "read clipped source",
      summary: "#include <stdio.h>\nint main() {\n  return 0;\n}",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "read",
      }),
    },
    {
      name: "read truncated listing",
      summary:
        "src/app.ts:10:export const value = 1;\nsrc/app.ts:11:export const next = 2;\nsrc/app.ts:12:export const last = 3;...",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "read",
      }),
    },
    {
      name: "read build log",
      summary:
        "DKMS (dkms-3.2.0) make.log for amdgpu/1.0 Building module(s) # command: 'make' KERNELVER=6.19.0 checking for a BSD-compatible install...",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "document",
        consequenceBaseline: "low",
        toolFamily: "read",
      }),
    },
    {
      name: "read tagged source",
      summary:
        "<path>/workspace/src/client.ts</path> <type>file</type> <content>export const ok = true;</content>",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "read",
      }),
    },
    {
      name: "read metadata log",
      summary: "Observation path /var/log/system.log showing first 20 lines",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "document",
        consequenceBaseline: "low",
        toolFamily: "read",
      }),
    },
    {
      name: "read cat readback source",
      summary: "Result of running cat -n /workspace/src/client.ts: 1 export const ok = true;",
      toolFamily: "read",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "read",
      }),
    },
    {
      name: "raw command source",
      summary: "#include <stdio.h>\nint main() {\n  return 0;\n}",
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "command_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      }),
    },
    {
      name: "raw command diff",
      summary: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index abcdef1..abcdef2 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,2 +1,3 @@",
        " export const ok = true;",
        "+export const added = true;",
      ].join("\n"),
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "command_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      }),
    },
    {
      name: "raw command test progress",
      summary: "=== Testing parser === All parser tests passed!",
      toolFamily: "exec_command",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "command_output",
        subject: "document",
        consequenceBaseline: "low",
        toolFamily: "exec_command",
      }),
    },
    {
      name: "raw command warning",
      summary: "/repo/pkg.py:167: UserWarning: fixture warning...",
      toolFamily: "run_shell_command",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "command_output",
        subject: "document",
        consequenceBaseline: "medium",
        toolFamily: "run_shell_command",
      }),
    },
    {
      name: "structured source",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output: "#include <stdio.h>\nint main() { return 0; }",
      }),
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "structured_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      }),
    },
    {
      name: "recovered structured source",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }',
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "structured_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      }),
    },
    {
      name: "zero-exit single document listing",
      summary: JSON.stringify({
        exit_code: 0,
        wall_time: "0.0510 seconds",
        output: "docs/guide.md:17:Test failed is documented here...",
      }),
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "structured_output",
        subject: "tool",
        consequenceBaseline: "medium",
        toolFamily: "bash",
      }),
    },
    {
      name: "zero-exit single source listing",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31...',
      toolFamily: "bash",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "structured_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      }),
    },
  ] as const;

  for (const testCase of cases) {
    assert.deepEqual(
      payloadObservationSemantics({
        summary: testCase.summary,
        toolFamily: testCase.toolFamily,
      }),
      testCase.expected,
      testCase.name,
    );
  }

  for (const testCase of [
    {
      name: "read prose",
      summary: "class schedule needs review before Friday",
      toolFamily: "read",
    },
    {
      name: "read terminal diagnostic",
      summary: "Failed to read DKMS make.log while building module(s) KERNELVER=6.19",
      toolFamily: "read",
    },
    {
      name: "raw command wrapper",
      summary:
        'Expected output:\n{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      toolFamily: "bash",
    },
    {
      name: "structured diagnostic",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output: "Traceback (most recent call last): RuntimeError",
      }),
      toolFamily: "bash",
    },
    {
      name: "unsupported read structured envelope",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output: "#include <stdio.h>\nint main() { return 0; }",
      }),
      toolFamily: "read",
    },
  ] as const) {
    assert.equal(
      payloadObservationSemantics({
        summary: testCase.summary,
        toolFamily: testCase.toolFamily,
      }),
      null,
      testCase.name,
    );
  }
});

test("host-style failed event fixtures route through observation semantics grammar", () => {
  const cases = [
    {
      name: "codex rejected command",
      sourceLabel: "Codex",
      title: "bash failure",
      summary: declinedActionMessage,
      toolFamily: "bash",
      expectedKind: "rejected_tool_use_observation",
      expectedActivity: "task_progress",
      expected: observationSemantics({
        kind: "control",
        polarity: "neutral",
        origin: "status_text",
        subject: "tool",
        consequenceBaseline: "low",
        toolFamily: "bash",
        recoveryHint: "await_authorization",
      }),
    },
    {
      name: "claude edit precondition",
      sourceLabel: "Claude Code",
      title: "edit failure",
      summary:
        "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
      toolFamily: "edit",
      expectedKind: "terminal_failure",
      expectedActivity: "failure",
      expected: {
        ...observationSemantics({
          kind: "diagnostic",
          polarity: "failure",
          origin: "semantic_evidence",
          subject: "tool",
          consequenceBaseline: "high",
          toolFamily: "edit",
          recoveryHint: "inspect_diagnostic",
        }),
        diagnosticClass: "runtime" as const,
      },
    },
    {
      name: "opencode abbreviated read",
      sourceLabel: "OpenCode",
      title: "read failure",
      summary: rangeBasedAbbreviatedFileViewObservationTranscript,
      toolFamily: "read",
      expectedKind: "observational_payload",
      expectedActivity: "task_progress",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "read_output",
        subject: "source",
        consequenceBaseline: "low",
        toolFamily: "read",
      }),
    },
    {
      name: "pi applied edit readback",
      sourceLabel: "Pi",
      title: "edit failure",
      summary:
        "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
      toolFamily: "edit",
      expectedKind: "observational_payload",
      expectedActivity: "task_progress",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "semantic_evidence",
        subject: "tool",
        consequenceBaseline: "high",
        toolFamily: "edit",
      }),
    },
  ] as const;

  for (const testCase of cases) {
    const event = {
      id: `evt:evidence:host-style:${testCase.name}`,
      taskId: `task:evidence:host-style:${testCase.name}`,
      timestamp,
      type: "task.updated" as const,
      source: { id: testCase.sourceLabel.toLowerCase(), label: testCase.sourceLabel },
      title: testCase.title,
      summary: testCase.summary,
      status: "failed" as const,
      toolFamily: testCase.toolFamily,
    };
    const evidence = readTaskFailureSemanticEvidence(event);
    assert.notEqual(evidence, null, testCase.name);
    assert.equal(evidence?.kind, testCase.expectedKind, testCase.name);
    assert.deepEqual(readTaskFailureObservationCore(evidence), testCase.expected, testCase.name);

    const ontology = buildAttentionJudgmentInput(normalizeSourceEvent(event)).ontology;
    assert.equal(ontology.activity, testCase.expectedActivity, testCase.name);
    assert.equal(ontology.ask, "status", testCase.name);
    assert.equal(ontology.consequence, testCase.expected.consequenceBaseline, testCase.name);
  }
});

test("task failure evidence attaches canonical observation semantics to non-payload families", () => {
  const cases = [
    {
      name: "terminal outcome-only",
      event: {
        title: "bash failure",
        summary: "(no output) Command exited with code 1",
        toolFamily: "bash",
      },
      expectedKind: "terminal_failure",
      expected: observationSemantics({
        kind: "outcome",
        polarity: "failure",
        origin: "semantic_evidence",
        subject: "tool",
        consequenceBaseline: "medium",
        toolFamily: "bash",
      }),
    },
    {
      name: "read source window",
      event: {
        title: "read failure",
        summary:
          "Read payload (512KB) is too large for the configured read window (256KB). Use start_line and end_line parameters to read specific portions of the file.",
        toolFamily: "read",
      },
      expectedKind: "terminal_failure",
      expected: observationSemantics({
        kind: "diagnostic",
        polarity: "failure",
        origin: "semantic_evidence",
        subject: "source",
        consequenceBaseline: "medium",
        toolFamily: "read",
        evidenceLoss: "partial",
        diagnosticClass: "source_limit",
        recoveryHint: "narrow_evidence_scope",
      }),
    },
    {
      name: "empty payload",
      event: {
        title: "edit failure",
        summary: "{}",
        toolFamily: "edit",
      },
      expectedKind: "empty_failure_payload",
      expected: observationSemantics({
        kind: "outcome",
        polarity: "failure",
        origin: "semantic_evidence",
        subject: "tool",
        consequenceBaseline: "medium",
        toolFamily: "edit",
        evidenceLoss: "absent",
        recoveryHint: "request_evidence",
      }),
    },
    {
      name: "expected diagnostic",
      event: {
        title: "bash failure",
        summary:
          "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
        toolFamily: "bash",
      },
      expectedKind: "expected_diagnostic_failure",
      expected: observationSemantics({
        kind: "diagnostic",
        polarity: "failure",
        origin: "semantic_evidence",
        subject: "tool",
        consequenceBaseline: "medium",
        toolFamily: "bash",
        diagnosticClass: "expected",
        recoveryHint: "inspect_diagnostic",
      }),
    },
    {
      name: "operation success",
      event: {
        title: "tool failure",
        summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
      },
      expectedKind: "operation_success_observation",
      expected: observationSemantics({
        kind: "outcome",
        polarity: "success",
        origin: "semantic_evidence",
        subject: "unknown",
        consequenceBaseline: "low",
      }),
    },
    {
      name: "routine command success",
      event: {
        title: "bash failure",
        summary: "Your command ran successfully and did not produce any output.",
        toolFamily: "bash",
      },
      expectedKind: "routine_bash_success_observation",
      expected: observationSemantics({
        kind: "outcome",
        polarity: "success",
        origin: "semantic_evidence",
        subject: "command",
        consequenceBaseline: "low",
        toolFamily: "bash",
      }),
    },
    {
      name: "search output",
      event: {
        title: "search failure",
        summary: 'Web search results for "aperture": /repo/README.md: Aperture overview',
        toolFamily: "search",
      },
      expectedKind: "routine_search_output",
      expected: observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "semantic_evidence",
        subject: "search",
        consequenceBaseline: "low",
        toolFamily: "search",
      }),
    },
    {
      name: "unclassified failure",
      event: {
        title: "tool failure",
        summary: "The tool stopped for a reason that has not been classified.",
      },
      expectedKind: "unclassified_failure",
      expected: observationSemantics({
        kind: "unknown",
        polarity: "failure",
        origin: "semantic_evidence",
        subject: "unknown",
        consequenceBaseline: "high",
        owner: "unknown",
        evidenceLoss: "unknown",
        recoveryHint: "inspect_original_evidence",
      }),
    },
  ] as const;

  for (const testCase of cases) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:observation-contract:${testCase.name}`,
      taskId: `task:evidence:observation-contract:${testCase.name}`,
      timestamp,
      type: "task.updated",
      status: "failed",
      ...testCase.event,
    });
    assert.notEqual(evidence, null, testCase.name);
    assert.equal(evidence?.kind, testCase.expectedKind, testCase.name);
    assert.deepEqual(readTaskFailureObservationCore(evidence), testCase.expected, testCase.name);
  }
});

test("task failure evidence profile owns ordered family selection", () => {
  const cases = [
    {
      name: "terminal",
      summary: "(no output) Command exited with code 1",
      toolFamily: "bash",
      expected: {
        kind: "terminal_failure",
        failureDetail: "outcome_only",
        readsAsObservation: false,
        consequenceBaseline: "medium",
        toolFamily: "bash",
      },
    },
    {
      name: "empty",
      summary: "{}",
      toolFamily: "edit",
      expected: {
        kind: "empty_failure_payload",
        failureDetail: "absent_evidence",
        readsAsObservation: false,
        consequenceBaseline: "medium",
        toolFamily: "edit",
      },
    },
    {
      name: "operation success",
      summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
      expected: {
        kind: "operation_success_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
      },
    },
    {
      name: "structured success syntax",
      summary: '{"exit_code":0,"wall_time":"0.0510 seconds","output":"ok"}',
      observationSyntaxKind: "outcome",
      expected: {
        kind: "structured_execution_success_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
      },
    },
    {
      name: "rejected control syntax",
      summary: rejectedToolUseMessage,
      toolFamily: "bash",
      observationSyntaxKind: "control",
      expected: {
        kind: "rejected_tool_use_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
        toolFamily: "bash",
      },
    },
    {
      name: "routine success",
      summary: "Your command ran successfully and did not produce any output.",
      toolFamily: "bash",
      expected: {
        kind: "routine_bash_success_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
        toolFamily: "bash",
      },
    },
    {
      name: "expected diagnostic",
      summary:
        "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
      toolFamily: "bash",
      expected: {
        kind: "expected_diagnostic_failure",
        readsAsObservation: false,
        consequenceBaseline: "medium",
        toolFamily: "bash",
      },
    },
    {
      name: "search output",
      summary: 'Web search results for "aperture": /repo/README.md: Aperture overview',
      toolFamily: "search",
      expected: {
        kind: "routine_search_output",
        readsAsObservation: true,
        consequenceBaseline: "low",
        toolFamily: "search",
      },
    },
    {
      name: "edit payload",
      summary:
        "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
      toolFamily: "edit",
      expected: {
        kind: "observational_payload",
        readsAsObservation: true,
        consequenceBaseline: "high",
        toolFamily: "edit",
      },
    },
    {
      name: "fallback",
      summary: "The tool stopped for a reason that has not been classified.",
      expected: {
        kind: "unclassified_failure",
        failureDetail: "indeterminate",
        readsAsObservation: false,
        consequenceBaseline: "high",
      },
    },
  ] as const;

  for (const testCase of cases) {
    const profile = readEvidenceProfile(
      testCase.summary,
      "toolFamily" in testCase ? testCase.toolFamily : undefined,
    );
    assert.deepEqual(
      {
        kind: profile.kind,
        readsAsObservation: profile.readsAsObservation,
        consequenceBaseline: profile.consequenceBaseline,
        ...(profile.failureDetail !== undefined ? { failureDetail: profile.failureDetail } : {}),
        ...(profile.toolFamily !== undefined ? { toolFamily: profile.toolFamily } : {}),
      },
      testCase.expected,
      testCase.name,
    );
    if ("observationSyntaxKind" in testCase) {
      assert.equal(profile.observationSyntax?.kind, testCase.observationSyntaxKind, testCase.name);
    }
  }
});

test("task failure evidence treats complete no-output nonzero command exits as medium consequence", () => {
  for (const [id, title, toolFamily, summary] of [
    ["no-output-command-exit", "bash failure", "bash", "(no output) Command exited with code 1"],
    [
      "exec-command-exit",
      "exec_command failure",
      "exec_command",
      "(no output) Command exited with code 1",
    ],
    [
      "run-shell-command-exit",
      "run_shell_command failure",
      "run_shell_command",
      "No stdout no stderr command failed with non-zero exit",
    ],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title,
      summary,
      status: "failed",
      toolFamily,
    });

    assert.equal(looksLikeBareNonzeroTerminalExitEvidence(summary), true);
    assert.equal(evidence?.kind, "terminal_failure");
    assert.equal(evidence?.failureDetail, "outcome_only");
    assert.equal(evidence?.terminalShape, "bare_nonzero_exit");
    assert.equal(evidence?.readsAsObservation, false);
    assert.equal(evidence?.consequenceBaseline, "medium");
  }
});

test("task failure terminal profile owns terminal-shape consequence classification", () => {
  assert.deepEqual(readTerminalProfile("(no output) Command exited with code 1", "bash"), {
    failureDetail: "outcome_only",
    terminalShape: "bare_nonzero_exit",
    consequenceBaseline: "medium",
  });
  assert.deepEqual(readTerminalProfile("Error: deployment failed with exit code 1.", "bash"), {
    failureDetail: "diagnostic",
    consequenceBaseline: "high",
  });
  assert.equal(
    readTerminalProfile("Search results for repository: found 12 matches.", "search"),
    null,
  );
});

test("task failure evidence treats no-matching command work as outcome-only", () => {
  for (const [id, summary, toolFamily] of [
    ["pytest-no-tests", "No tests found, exiting with code 5", "bash"],
    ["collected-zero-items", "collected 0 items", "exec_command"],
    ["no-files-matching", "No files matching '*.spec.ts' were found.", "run_shell_command"],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title: `${toolFamily} failure`,
      summary,
      status: "failed",
      toolFamily,
    });

    assert.equal(evidence?.kind, "terminal_failure", id);
    assert.equal(evidence?.failureDetail, "outcome_only", id);
    assert.equal(evidence?.terminalShape, undefined, id);
    assert.equal(evidence?.readsAsObservation, false, id);
    assert.equal(evidence?.consequenceBaseline, "medium", id);
  }
});

test("no-matching command work stays bounded by command ownership and diagnostics", () => {
  assert.equal(readTerminalProfile("No tests found, exiting with code 5", "search"), null);

  const diagnostic = readTaskFailureSemanticEvidence({
    id: "evt:evidence:no-match-with-diagnostic",
    taskId: "task:evidence:no-match-with-diagnostic",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "No tests found. AssertionError: expected 1 to equal 2.",
    status: "failed",
    toolFamily: "bash",
  });

  assert.notEqual(diagnostic?.failureDetail, "outcome_only");
  assert.equal(diagnostic?.consequenceBaseline, "high");
});

test("task failure evidence keeps incomplete raw nonzero exits high consequence", () => {
  for (const [id, title, toolFamily, summary] of [
    ["plain-process-exit", "bash failure", "bash", "Process exited with code 2."],
    [
      "unqualified-nonzero-exit",
      "run_shell_command failure",
      "run_shell_command",
      "Command failed with non-zero exit",
    ],
    ["single-channel-note", "bash failure", "bash", "No stderr command exited with code 1"],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title,
      summary,
      status: "failed",
      toolFamily,
    });

    assert.equal(looksLikeBareNonzeroTerminalExitEvidence(summary), false);
    assert.equal(evidence?.kind, "terminal_failure");
    assert.notEqual(evidence?.failureDetail, "outcome_only");
    assert.equal(evidence?.terminalShape, undefined);
    assert.equal(evidence?.readsAsObservation, false);
    assert.equal(evidence?.consequenceBaseline, "high");
  }
});

test("task failure evidence treats complete structured nonzero no-output envelopes as outcome-only", () => {
  for (const [id, toolFamily, output] of [
    ["bash-no-output", "bash", "(no output)"],
    ["exec-command-no-stdout-stderr", "exec_command", "no stdout no stderr"],
    ["unknown-exact-no-output", undefined, "No output."],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title: `${toolFamily ?? "tool"} failure`,
      summary: JSON.stringify({ exit_code: 1, wall_time: "0.0510 seconds", output }),
      status: "failed",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    });

    assert.equal(evidence?.kind, "terminal_failure");
    assert.equal(evidence?.failureDetail, "outcome_only");
    assert.equal(evidence?.terminalShape, undefined);
    assert.equal(evidence?.readsAsObservation, false);
    assert.equal(evidence?.consequenceBaseline, "medium");
  }
});

test("task failure evidence keeps incomplete structured nonzero exits indeterminate", () => {
  for (const [id, summary] of [
    ["recovered-no-output", '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)'],
    [
      "marked-truncated-no-output",
      '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)","truncated":true}',
    ],
    ["substantive-unknown-output", '{"exit_code":1,"wall_time":"0.0510 seconds","output":"ok"}'],
    ["single-channel-note", '{"exit_code":1,"wall_time":"0.0510 seconds","output":"no stderr"}'],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary,
      status: "failed",
      toolFamily: "bash",
    });

    assert.equal(evidence?.kind, "terminal_failure");
    assert.equal(evidence?.failureDetail, "indeterminate");
    assert.equal(evidence?.consequenceBaseline, "high");
  }
});

test("task failure evidence keeps diagnostic nonzero command exits high consequence", () => {
  for (const [id, summary] of [
    ["deployment-error", "Error: deployment failed with exit code 1."],
    ["failed-tests", "Tests failed. Process exited with code 1."],
    ["traceback", "Traceback (most recent call last): RuntimeError. Command exited with code 1."],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:${id}`,
      taskId: `task:evidence:${id}`,
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary,
      status: "failed",
      toolFamily: "bash",
    });

    assert.equal(looksLikeBareNonzeroTerminalExitEvidence(summary), false);
    assert.equal(evidence?.kind, "terminal_failure");
    assert.equal(evidence?.failureDetail, "diagnostic");
    assert.equal(evidence?.terminalShape, undefined);
    assert.equal(evidence?.consequenceBaseline, "high");
  }
});

test("task failure evidence treats read source-window limits as bounded terminal failures", () => {
  for (const [id, summary] of [
    [
      "size",
      "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    ],
    [
      "tokens",
      "File content (178139 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    ],
    [
      "paraphrased-size",
      "Read payload (512KB) is too large for the configured read window (256KB). Use start_line and end_line parameters to read specific portions of the file.",
    ],
    [
      "paraphrased-tokens",
      "Document output (12000 tokens) exceeded the max token limit (8000 tokens). Search for specific content instead.",
    ],
  ] as const) {
    const signals = readTaskFailureSemanticSignals({ summary, toolFamily: "read" });
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:source-window-limit:${id}`,
      taskId: `task:evidence:source-window-limit:${id}`,
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary,
      status: "failed",
      toolFamily: "read",
    });

    assert.equal(signals.sourceWindowLimitFailure, true);
    assert.equal(evidence?.kind, "terminal_failure");
    assert.equal(evidence?.failureDetail, "source_window_limit");
    assert.equal(evidence?.toolFamily, "read");
    assert.equal(evidence?.readsAsObservation, false);
    assert.equal(evidence?.consequenceBaseline, "medium");
  }
});

test("task failure evidence rejects non-read and quoted source-window limit wording", () => {
  const summary =
    "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.";
  const cases = [
    { title: "bash failure", toolFamily: "bash", summary },
    { title: "search failure", toolFamily: "search", summary },
    {
      title: "read failure",
      toolFamily: "read",
      summary: `OBSERVATION: ${summary}`,
    },
    {
      title: "read failure",
      toolFamily: "read",
      summary: `/workspace/app.ts ${summary}`,
    },
    {
      title: "read failure",
      toolFamily: "read",
      summary:
        "File content (unknown) exceeds maximum allowed size (policy). Use offset and limit parameters to read specific portions of the file.",
    },
    {
      title: "read failure",
      toolFamily: "read",
      summary: "Error: permission denied while opening /workspace/app.ts.",
    },
  ] as const;

  for (const testCase of cases) {
    const signals = readTaskFailureSemanticSignals({
      summary: testCase.summary,
      toolFamily: testCase.toolFamily,
    });
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:not-source-window-limit:${testCase.toolFamily}`,
      taskId: `task:evidence:not-source-window-limit:${testCase.toolFamily}`,
      timestamp,
      type: "task.updated",
      title: testCase.title,
      summary: testCase.summary,
      status: "failed",
      toolFamily: testCase.toolFamily,
    });

    assert.equal(signals.sourceWindowLimitFailure, false, testCase.summary);
    assert.notEqual(evidence?.failureDetail, "source_window_limit", testCase.summary);
  }
});

test("task failure evidence keeps mixed read source-window diagnostics high consequence", () => {
  const summary =
    "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file. Permission denied while opening /workspace/app.ts.";
  const signals = readTaskFailureSemanticSignals({ summary, toolFamily: "read" });
  const evidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:source-window-limit-permission-denied",
    taskId: "task:evidence:source-window-limit-permission-denied",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary,
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(signals.sourceWindowLimitFailure, false);
  assert.equal(signals.readFailureDiagnostic, true);
  assert.equal(evidence?.kind, "terminal_failure");
  assert.equal(evidence?.failureDetail, "diagnostic");
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

test("task failure evidence classifies explicit tool-use rejection outcomes as low observations", () => {
  const bash = readTaskFailureSemanticEvidence({
    id: "evt:evidence:bash-tool-use-rejection",
    taskId: "task:evidence:bash-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
  });
  const edit = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-tool-use-rejection",
    taskId: "task:evidence:edit-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "edit",
  });
  const absent = readTaskFailureSemanticEvidence({
    id: "evt:evidence:absent-tool-use-rejection",
    taskId: "task:evidence:absent-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
  });
  const web = readTaskFailureSemanticEvidence({
    id: "evt:evidence:web-tool-use-rejection",
    taskId: "task:evidence:web-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "web failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "web",
  });

  assert.equal(bash?.kind, "rejected_tool_use_observation");
  assert.equal(bash.toolFamily, "bash");
  assert.equal(bash.readsAsObservation, true);
  assert.equal(bash.consequenceBaseline, "low");
  assert.equal(edit?.kind, "rejected_tool_use_observation");
  assert.equal(edit.toolFamily, "edit");
  assert.equal(edit.readsAsObservation, true);
  assert.equal(edit.consequenceBaseline, "low");
  assert.equal(absent?.kind, "rejected_tool_use_observation");
  assert.equal(absent && "toolFamily" in absent, false);
  assert.equal(absent.readsAsObservation, true);
  assert.equal(absent.consequenceBaseline, "low");
  assert.equal(web?.kind, "rejected_tool_use_observation");
  assert.equal(web.toolFamily, "web");
  assert.equal(web.readsAsObservation, true);
  assert.equal(web.consequenceBaseline, "low");
});

test("task failure evidence routes edit output outcomes by result semantics", () => {
  const preconditionFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-tool-use-error",
    taskId: "task:evidence:edit-tool-use-error",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
    status: "failed",
    toolFamily: "edit",
  });
  const noReplacementFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-no-replacement",
    taskId: "task:evidence:edit-no-replacement",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "OBSERVATION: No replacement was performed, old_str `export const missing = true;` was not found.",
    status: "failed",
    toolFamily: "edit",
  });
  const replacementMissFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-replacement-miss",
    taskId: "task:evidence:edit-replacement-miss",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "Could not find the exact text in /repo/src/app.ts. The old text must match exactly including all whitespace and newlines.",
    status: "failed",
    toolFamily: "edit",
  });
  const oldTextReplacementMissFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-oldtext-replacement-miss",
    taskId: "task:evidence:edit-oldtext-replacement-miss",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "Could not find edits[2] in /repo/src/app.ts. The oldText must match exactly including all whitespace and newlines.",
    status: "failed",
    toolFamily: "edit",
  });
  const ambiguousReplacementFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-ambiguous-replacement",
    taskId: "task:evidence:edit-ambiguous-replacement",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "Found 2 occurrences of the text in /repo/src/app.ts. The text must be unique. Please provide more context to make it unique.",
    status: "failed",
    toolFamily: "edit",
  });
  const modifiedSinceReadFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-modified-since-read",
    taskId: "task:evidence:edit-modified-since-read",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary: "File has been modified since read by another process. Read it again before writing.",
    status: "failed",
    toolFamily: "edit",
  });
  const appliedReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-applied-readback",
    taskId: "task:evidence:edit-applied-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
    status: "failed",
    toolFamily: "edit",
  });
  const appliedWithDiagnosticReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-applied-with-diagnostic-readback",
    taskId: "task:evidence:edit-applied-with-diagnostic-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary: "Edit applied successfully. LSP errors detected in this file, please fix:\nline 1",
    status: "failed",
    toolFamily: "edit",
  });
  const contradictoryAppliedFailure = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-contradictory-applied-failure",
    taskId: "task:evidence:edit-contradictory-applied-failure",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary: "Edit applied successfully? No, the edit was rolled back and failed.",
    status: "failed",
    toolFamily: "edit",
  });
  const createdReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-created-readback",
    taskId: "task:evidence:edit-created-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"Successfully created and wrote to new file: /repo/src/new-file.ts. Here is the updated code:\\nexport const value = 1;"}',
    status: "failed",
    toolFamily: "edit",
  });
  const recoveredReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-recovered-readback",
    taskId: "task:evidence:edit-recovered-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\\nexport const value = 1;',
    status: "failed",
    toolFamily: "edit",
  });
  const invalidMissingWallTimeReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-invalid-missing-wall-time-readback",
    taskId: "task:evidence:edit-invalid-missing-wall-time-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      '{"output":"Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\\nexport const value = 1;"}',
    status: "failed",
    toolFamily: "edit",
  });
  const invalidExtraKeyReadback = readTaskFailureSemanticEvidence({
    id: "evt:evidence:edit-invalid-extra-key-readback",
    taskId: "task:evidence:edit-invalid-extra-key-readback",
    timestamp,
    type: "task.updated",
    title: "edit failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\\nexport const value = 1;","status":"ok"}',
    status: "failed",
    toolFamily: "edit",
  });
  const bashOwnedAppliedText = readTaskFailureSemanticEvidence({
    id: "evt:evidence:bash-owned-edit-applied-text",
    taskId: "task:evidence:bash-owned-edit-applied-text",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary:
      "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(preconditionFailure?.kind, "terminal_failure");
  assert.equal(preconditionFailure?.readsAsObservation, false);
  assert.equal(preconditionFailure?.consequenceBaseline, "high");
  assert.equal(noReplacementFailure?.kind, "terminal_failure");
  assert.equal(replacementMissFailure?.kind, "terminal_failure");
  assert.equal(oldTextReplacementMissFailure?.kind, "terminal_failure");
  assert.equal(ambiguousReplacementFailure?.kind, "terminal_failure");
  assert.equal(modifiedSinceReadFailure?.kind, "terminal_failure");
  for (const failure of [
    preconditionFailure,
    noReplacementFailure,
    replacementMissFailure,
    oldTextReplacementMissFailure,
    ambiguousReplacementFailure,
    modifiedSinceReadFailure,
  ]) {
    assert.notEqual(failure, null);
    assert.deepEqual(
      readTaskFailureObservationCore(failure),
      {
        ...observationSemantics({
          kind: "diagnostic",
          polarity: "failure",
          origin: "semantic_evidence",
          subject: "tool",
          consequenceBaseline: "high",
          toolFamily: "edit",
          recoveryHint: "inspect_diagnostic",
        }),
        diagnosticClass: "runtime",
      },
      failure?.kind,
    );
  }
  assert.equal(appliedReadback?.kind, "observational_payload");
  assert.equal(appliedReadback?.readsAsObservation, true);
  assert.equal(appliedReadback?.consequenceBaseline, "high");
  assert.equal(appliedWithDiagnosticReadback?.kind, "observational_payload");
  assert.equal(appliedWithDiagnosticReadback?.readsAsObservation, true);
  assert.equal(contradictoryAppliedFailure?.kind, "unclassified_failure");
  assert.equal(contradictoryAppliedFailure?.readsAsObservation, false);
  assert.equal(createdReadback?.kind, "observational_payload");
  assert.equal(createdReadback?.readsAsObservation, true);
  assert.equal(recoveredReadback?.kind, "observational_payload");
  assert.equal(recoveredReadback?.readsAsObservation, true);
  for (const applied of [
    appliedReadback,
    appliedWithDiagnosticReadback,
    createdReadback,
    recoveredReadback,
  ]) {
    assert.deepEqual(
      evidenceObservationSemantics(applied),
      observationSemantics({
        kind: "payload",
        polarity: "neutral",
        origin: "semantic_evidence",
        subject: "tool",
        consequenceBaseline: "high",
        toolFamily: "edit",
      }),
      applied?.kind,
    );
  }
  assert.equal(invalidMissingWallTimeReadback?.kind, "unclassified_failure");
  assert.equal(invalidExtraKeyReadback?.kind, "unclassified_failure");
  assert.equal(bashOwnedAppliedText?.kind, "unclassified_failure");
});

test("task failure evidence keeps terminal diagnostics ahead of rejection language", () => {
  const evidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:terminal-before-tool-use-rejection",
    taskId: "task:evidence:terminal-before-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure Traceback (most recent call last): RuntimeError",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(looksLikeToolUseRejectionOutcome(rejectedToolUseMessage), true);
  assert.equal(
    hasSemanticTextShape(
      readSemanticTextEvidence(`bash failure ${rejectedToolUseMessage}`, "bash"),
      "terminal_failure",
    ),
    false,
  );
  assert.equal(
    hasSemanticTextShape(
      readSemanticTextEvidence(
        `bash failure Traceback (most recent call last): RuntimeError ${rejectedToolUseMessage}`,
        "bash",
      ),
      "terminal_failure",
    ),
    true,
  );
  assert.equal(evidence?.kind, "terminal_failure");
  assert.equal(evidence?.readsAsObservation, false);
  assert.equal(evidence?.consequenceBaseline, "high");
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
      failureDetail: "indeterminate",
      toolFamily: "bash",
      readsAsObservation: false,
      consequenceBaseline: "high",
      text: { shapes: [] },
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
  const execCommandSourceOutput = readTaskFailureSemanticEvidence({
    id: "evt:evidence:exec-command-structured-source-output",
    taskId: "task:evidence:exec-command-structured-source-output",
    timestamp,
    type: "task.updated",
    title: "exec_command failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
    status: "failed",
    toolFamily: "exec_command",
  });

  assert.equal(execCommandSourceOutput?.kind, "structured_tool_output_observation");
  assert.equal(execCommandSourceOutput.toolFamily, "exec_command");
  assert.equal(execCommandSourceOutput.readsAsObservation, true);
  assert.equal(execCommandSourceOutput.consequenceBaseline, "high");
  const truncatedExecCommandSourceOutput = readTaskFailureSemanticEvidence({
    id: "evt:evidence:exec-command-truncated-structured-source-output",
    taskId: "task:evidence:exec-command-truncated-structured-source-output",
    timestamp,
    type: "task.updated",
    title: "exec_command failure",
    summary:
      '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }',
    status: "failed",
    toolFamily: "exec_command",
  });

  assert.equal(truncatedExecCommandSourceOutput?.kind, "structured_tool_output_observation");
  assert.equal(truncatedExecCommandSourceOutput.toolFamily, "exec_command");
  const quotedWarningUnqualifiedStructuredLinterOutput = readTaskFailureSemanticEvidence({
    id: "evt:evidence:quoted-warning-unqualified-structured-linter-output",
    taskId: "task:evidence:quoted-warning-unqualified-structured-linter-output",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: JSON.stringify({
      wall_time: "0.0510 seconds",
      output:
        'logger.warning("foo.yaml 1:1 warning fixture (rule)") lint output: foo.yaml 1:1 missing document start (document-start)',
    }),
    status: "failed",
    toolFamily: "bash",
  });
  assert.equal(quotedWarningUnqualifiedStructuredLinterOutput?.kind, "unclassified_failure");
  assert.equal(quotedWarningUnqualifiedStructuredLinterOutput.readsAsObservation, false);
  const rawCommandDiff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index abcdef1..abcdef2 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " export const ok = true;",
    "+export const added = true;",
  ].join("\n");
  const rawCommandDiffEvidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:raw-command-unified-diff",
    taskId: "task:evidence:raw-command-unified-diff",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rawCommandDiff,
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(
    signalObservationSemantics(
      readTaskFailureSemanticSignals({
        summary: rawCommandDiff,
        toolFamily: "bash",
      }),
    )?.subject,
    "source",
    "anchored raw command unified diffs should expose a dedicated observation signal",
  );
  assert.equal(rawCommandDiffEvidence?.kind, "observational_payload");
  assert.equal(rawCommandDiffEvidence.toolFamily, "bash");
  assert.equal(rawCommandDiffEvidence.readsAsObservation, true);
  assert.equal(rawCommandDiffEvidence.consequenceBaseline, "high");
  const rawCommandSourceReadback = "#include <stdio.h>\nint main() {\npanic:\n  return 1;\n}\n";
  const rawCommandSourceReadbackSignals = readTaskFailureSemanticSignals({
    summary: rawCommandSourceReadback,
    toolFamily: "bash",
  });
  assert.equal(
    signalObservationSemantics(rawCommandSourceReadbackSignals)?.consequenceBaseline,
    "high",
  );
  const rawCommandSourceReadbackEvidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:raw-command-source-readback",
    taskId: "task:evidence:raw-command-source-readback",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rawCommandSourceReadback,
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(rawCommandSourceReadbackEvidence?.kind, "observational_payload");
  assert.equal(rawCommandSourceReadbackEvidence.toolFamily, "bash");
  assert.equal(rawCommandSourceReadbackEvidence.readsAsObservation, true);
  assert.equal(rawCommandSourceReadbackEvidence.consequenceBaseline, "high");
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:edit-raw-command-source-readback",
      taskId: "task:evidence:edit-raw-command-source-readback",
      timestamp,
      type: "task.updated",
      title: "edit failure",
      summary: rawCommandSourceReadback,
      status: "failed",
      toolFamily: "edit",
    })?.kind,
    "unclassified_failure",
    "raw command source readback does not leak into edit semantics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-raw-command-source-readback",
      taskId: "task:evidence:web-raw-command-source-readback",
      timestamp,
      type: "task.updated",
      title: "web failure",
      summary: rawCommandSourceReadback,
      status: "failed",
      toolFamily: "web",
    })?.kind,
    "unclassified_failure",
    "raw command source readback does not leak into unsupported tool semantics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-source-readback-with-traceback",
      taskId: "task:evidence:raw-command-source-readback-with-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: `${rawCommandSourceReadback}\nTraceback (most recent call last):\nRuntimeError: failed`,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "terminal diagnostics embedded in raw command source readbacks keep terminal precedence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-successful-test-output",
      taskId: "task:evidence:raw-command-successful-test-output",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary: "=== Testing parser === All parser tests passed!",
      status: "failed",
      toolFamily: "exec_command",
    })?.consequenceBaseline,
    "low",
    "successful raw command test output should remain low-consequence observation evidence",
  );
  const ginkgoProgressOutput =
    "Running Suite: GCN3 Timing Simulator - /repo/amd/timing/cu\n" +
    "=====================================================================\n" +
    "Random Seed: \u001b[1m1776087919\u001b[0m\n" +
    "Will run \u001b[1m152\u001b[0m of \u001b[1m152\u001b[0m specs\n" +
    "\u001b[38;5;10m\u2022\u001b[0m";
  const rawCommandGinkgoProgress = readTaskFailureSemanticEvidence({
    id: "evt:evidence:raw-command-ginkgo-progress",
    taskId: "task:evidence:raw-command-ginkgo-progress",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: ginkgoProgressOutput,
    status: "failed",
    toolFamily: "bash",
  });
  assert.equal(rawCommandGinkgoProgress?.kind, "observational_payload");
  assert.equal(rawCommandGinkgoProgress.toolFamily, "bash");
  assert.equal(rawCommandGinkgoProgress.readsAsObservation, true);
  assert.equal(
    rawCommandGinkgoProgress.consequenceBaseline,
    "medium",
    "test runner progress without visible diagnostics is a bounded observation, not success",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-ginkgo-failure",
      taskId: "task:evidence:raw-command-ginkgo-failure",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: `${ginkgoProgressOutput}\nFailure [0.001 seconds]\nExpected true to be false`,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "Ginkgo progress output with visible failure diagnostics remains terminal",
  );
  const rawCommandWarning =
    "/repo/venv/lib/python3.13/site-packages/pkg/__init__.py:167: UserWarning: The program was compiled against version 1 but the installed version is different...";
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-warning-readback",
      taskId: "task:evidence:raw-command-warning-readback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: rawCommandWarning,
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "path-qualified command warnings are medium-consequence readback observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-warning-with-error",
      taskId: "task:evidence:raw-command-warning-with-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: `${rawCommandWarning}\n/repo/src/app.ts:33: error: no matching function`,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "command warning readbacks do not override explicit error diagnostics",
  );
  for (const [id, diagnostic] of [
    ["windows-error", String.raw`C:\repo\app.ts:33: error: no matching function`],
    ["windows-fatal", String.raw`C:\repo\app.ts:33: fatal: missing header`],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:raw-command-warning-with-${id}`,
        taskId: `task:evidence:raw-command-warning-with-${id}`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary: `${String.raw`C:\repo\pkg.py:167: UserWarning: compiled version mismatch...`}\n${diagnostic}`,
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "terminal_failure",
      `Windows command warnings do not override ${id} diagnostics`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:quoted-raw-command-warning-readback",
      taskId: "task:evidence:quoted-raw-command-warning-readback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'logger.info("\\n/repo/pkg.py:167: UserWarning: fixture warning\\n")\ntruncated output...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "quoted command warnings must not become medium-consequence command readbacks",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-command-warning-readback",
      taskId: "task:evidence:web-command-warning-readback",
      timestamp,
      type: "task.updated",
      title: "web failure",
      summary: rawCommandWarning,
      status: "failed",
      toolFamily: "web",
    })?.kind,
    "unclassified_failure",
    "command warning readbacks do not leak into unsupported tool semantics",
  );
  for (const [id, summary] of [
    ["raw-command-diff-prose-reference", `The expected patch starts with ${rawCommandDiff}`],
    ["raw-command-diff-expected-output", `Expected output:\n${rawCommandDiff}`],
    ["raw-command-diff-source-string", `const patch = ${JSON.stringify(rawCommandDiff)};`],
    [
      "raw-command-plain-diff-fixture",
      "--- expected output\n+++ actual output\n@@ parser fixture @@",
    ],
    [
      "raw-command-flattened-diff-fixture",
      "diff --git a/x b/x index abcdef1..abcdef2 100644 --- a/x +++ b/x @@ fixture @@",
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
      `${id} should not be treated as raw command diff output`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-diff-with-traceback",
      taskId: "task:evidence:raw-command-diff-with-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: `${rawCommandDiff}\nTraceback (most recent call last):\nRuntimeError: failed`,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "terminal diagnostics embedded in diff output should keep terminal precedence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-read-unified-diff",
      taskId: "task:evidence:raw-read-unified-diff",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: rawCommandDiff,
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
    "raw read diffs continue through existing read source-observation handling",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:run-shell-command-zero-exit",
      taskId: "task:evidence:run-shell-command-zero-exit",
      timestamp,
      type: "task.updated",
      title: "run_shell_command failure",
      summary: '{"exit_code":0,"wall_time":"0.0510 seconds","output":"ok"}',
      status: "failed",
      toolFamily: "run_shell_command",
    })?.kind,
    "routine_bash_success_observation",
    "run_shell_command keeps command success behavior without alias conversion",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-routine-success",
      taskId: "task:evidence:exec-command-routine-success",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "routine_bash_success_observation",
    "alias-specific command titles should read as routine success",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-structured-traceback",
      taskId: "task:evidence:exec-command-structured-traceback",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Traceback (most recent call last): RuntimeError"}',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "terminal_failure",
    "terminal evidence still wins for command aliases",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-unshaped-output",
      taskId: "task:evidence:exec-command-unshaped-output",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary: '{"wall_time":"0.0510 seconds","output":"hello world"}',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "unclassified_failure",
    "neutral command alias structured output remains unclassified",
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
      id: "evt:evidence:missing-tool-exact-source-output",
      taskId: "task:evidence:missing-tool-exact-source-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
    })?.kind,
    "structured_tool_output_observation",
    "missing tool families can own exact structured source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:opaque-tool-exact-source-output",
      taskId: "task:evidence:opaque-tool-exact-source-output",
      timestamp,
      type: "task.updated",
      title: "opaque_runner failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"diff --git a/src/app.ts b/src/app.ts\\n--- a/src/app.ts\\n+++ b/src/app.ts"}',
      status: "failed",
      toolFamily: "opaque_runner",
    })?.kind,
    "structured_tool_output_observation",
    "opaque tool families can own exact structured output observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-exact-zero-exit",
      taskId: "task:evidence:missing-tool-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: '{"exit_code":0,"wall_time":"0.0510 seconds","output":"collected 42 rows"}',
      status: "failed",
    })?.kind,
    "structured_execution_success_observation",
    "missing tool exact zero exit is affirmative success evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:opaque-tool-exact-zero-exit",
      taskId: "task:evidence:opaque-tool-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "opaque_runner failure",
      summary: '{"exit_code":0,"wall_time":"0.0510 seconds","output":"ok"}',
      status: "failed",
      toolFamily: "opaque_runner",
    })?.kind,
    "structured_execution_success_observation",
    "opaque tool exact zero exit is affirmative success evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:opaque-tool-string-zero-exit",
      taskId: "task:evidence:opaque-tool-string-zero-exit",
      timestamp,
      type: "task.updated",
      title: "opaque_runner failure",
      summary: '{"exit_code":"0","wall_time":"0.0510 seconds","output":"ok"}',
      status: "failed",
      toolFamily: "opaque_runner",
    })?.kind,
    "unclassified_failure",
    "opaque exact ownership requires numeric JSON exit codes",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-zero-exit-traceback",
      taskId: "task:evidence:missing-tool-zero-exit-traceback",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"Traceback (most recent call last): RuntimeError"}',
      status: "failed",
    })?.kind,
    "terminal_failure",
    "zero-exit exact ownership does not override terminal diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:opaque-tool-exact-nonzero-source",
      taskId: "task:evidence:opaque-tool-exact-nonzero-source",
      timestamp,
      type: "task.updated",
      title: "opaque_runner failure",
      summary:
        '{"exit_code":2,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "opaque_runner",
    })?.kind,
    "terminal_failure",
    "nonzero exact structured output remains terminal even when output looks observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:opaque-tool-exact-traceback",
      taskId: "task:evidence:opaque-tool-exact-traceback",
      timestamp,
      type: "task.updated",
      title: "opaque_runner failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Traceback (most recent call last): RuntimeError"}',
      status: "failed",
      toolFamily: "opaque_runner",
    })?.kind,
    "terminal_failure",
    "terminal diagnostics inside exact structured output still win",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-exact-neutral-output",
      taskId: "task:evidence:missing-tool-exact-neutral-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: '{"wall_time":"0.0510 seconds","output":"hello world"}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "neutral exact structured output without exit code remains unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-exact-zero-exit",
      taskId: "task:evidence:web-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "web failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "web",
    })?.kind,
    "unclassified_failure",
    "explicit web families do not inherit structured execution-envelope ownership",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-exact-zero-exit",
      taskId: "task:evidence:read-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "explicit read families do not inherit structured execution-envelope ownership",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:search-exact-zero-exit",
      taskId: "task:evidence:search-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "unclassified_failure",
    "explicit search families do not inherit structured execution-envelope ownership",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:write-exact-zero-exit",
      taskId: "task:evidence:write-exact-zero-exit",
      timestamp,
      type: "task.updated",
      title: "write failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
      toolFamily: "write",
    })?.kind,
    "unclassified_failure",
    "explicit write families do not inherit structured execution-envelope ownership",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-extra-key-source-output",
      taskId: "task:evidence:missing-tool-extra-key-source-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }","status":"ok"}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "extra envelope keys keep absent-family output unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-invalid-wall-time",
      taskId: "task:evidence:missing-tool-invalid-wall-time",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: '{"wall_time":"soon","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "invalid envelope timing keeps absent-family output unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-invalid-output-type",
      taskId: "task:evidence:missing-tool-invalid-output-type",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: '{"wall_time":"0.0510 seconds","output":["#include <stdio.h>"]}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "wrong output type keeps absent-family output unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-empty-output",
      taskId: "task:evidence:missing-tool-empty-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: '{"wall_time":"0.0510 seconds","output":"  "}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "empty output keeps absent-family envelope unclassified",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-truncated-source-output",
      taskId: "task:evidence:missing-tool-truncated-source-output",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "truncated absent-family envelopes do not use command recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-reference-wrapper",
      taskId: "task:evidence:missing-tool-reference-wrapper",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        'Expected output:\\n{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }"}',
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "reference wrappers around exact envelopes remain unclassified",
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
  const structuredGinkgoProgress = readTaskFailureSemanticEvidence({
    id: "evt:evidence:structured-ginkgo-progress",
    taskId: "task:evidence:structured-ginkgo-progress",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: JSON.stringify({
      wall_time: "0.0510 seconds",
      output: ginkgoProgressOutput,
    }),
    status: "failed",
    toolFamily: "bash",
  });
  assert.equal(structuredGinkgoProgress?.kind, "structured_tool_output_observation");
  assert.equal(structuredGinkgoProgress.toolFamily, "bash");
  assert.equal(structuredGinkgoProgress.readsAsObservation, true);
  assert.equal(
    structuredGinkgoProgress.consequenceBaseline,
    "medium",
    "structured test runner progress is a medium observation, not terminal failure evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-pytest-progress",
      taskId: "task:evidence:structured-pytest-progress",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output:
          "============================= test session starts ==============================\n" +
          "platform linux -- Python 3.10.15, pytest-8.3.4, pluggy-1.5.0 -- /opt/bin/python\n" +
          "cachedir: .pytest_cache\nrootdir: /testbed\ncollected 122 items",
      }),
      status: "failed",
      toolFamily: "bash",
    })?.consequenceBaseline,
    "medium",
    "structured pytest session progress is observational without requiring a final pass summary",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-pytest-progress-with-failure",
      taskId: "task:evidence:structured-pytest-progress-with-failure",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output:
          "============================= test session starts ==============================\n" +
          "platform linux -- Python 3.10.15, pytest-8.3.4, pluggy-1.5.0 -- /opt/bin/python\n" +
          "collected 2 items\ntest_parser.py::test_parse FAILED",
      }),
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "pytest progress with visible failed test status remains terminal",
  );
  const missingToolPytestProgress = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-pytest-progress",
    taskId: "task:evidence:missing-tool-pytest-progress",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      "OBSERVATION: ============================= test session starts ==============================\n" +
      "platform linux -- Python 3.10.15, pytest-8.3.4, pluggy-1.5.0 -- /opt/bin/python\n" +
      "cachedir: .pytest_cache\nrootdir: /testbed\ncollected 122 items",
    status: "failed",
  });
  assert.equal(missingToolPytestProgress?.kind, "observational_payload");
  assert.equal(missingToolPytestProgress.readsAsObservation, true);
  assert.equal(
    missingToolPytestProgress.consequenceBaseline,
    "medium",
    "explicit test-runner observation transcripts do not require tool-family evidence",
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
      id: "evt:evidence:raw-command-compiler-error",
      taskId: "task:evidence:raw-command-compiler-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "/home/user/probe.hip.cpp:240:28: error: no matching function for call to 'waveRunsLoad'",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "raw command compiler diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-usage-diagnostic",
      taskId: "task:evidence:raw-command-usage-diagnostic",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        "usage: rocprof-compute [mode] [options] tool: error: argument --list-metrics: invalid choice: 'gfx1151'",
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "terminal_failure",
    "raw command usage diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-diagnostic",
      taskId: "task:evidence:raw-command-cli-parse-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "jq: parse error: Unfinished JSON term at EOF at line 213, column 0",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "raw command CLI parse diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-flattened-python-syntax-diagnostic",
      taskId: "task:evidence:raw-command-flattened-python-syntax-diagnostic",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        'File "/testbed/test_fixes.py", line 8 print(f"quote_type=single") ^ SyntaxError: invalid syntax',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "terminal_failure",
    "raw command flattened Python syntax diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-panic",
      taskId: "task:evidence:raw-command-panic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "Failed to execute: CREATE TABLE exec_info ( Property, Value ); panic: unable to open database file: not a directory",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "raw command panic diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-line-panic",
      taskId: "task:evidence:raw-command-line-panic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "panic: unable to open database file: not a directory",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "raw command line-start panic diagnostics should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-panic-label",
      taskId: "task:evidence:raw-command-panic-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "if (failed) goto panic; panic: cleanup();",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source labels named panic are not runtime diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-line-panic-label",
      taskId: "task:evidence:raw-command-line-panic-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "#include <stdio.h>\nint main() {\npanic:\n  return 1;\n}\n",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "raw command source labels with line-start panic are source readback observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-same-line-panic-label",
      taskId: "task:evidence:raw-command-same-line-panic-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "#include <stdio.h>\nint main() {\npanic: return 1;\n}\n",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "raw command source labels with same-line panic statements are source readback observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-compound-panic-source-literal",
      taskId: "task:evidence:raw-command-compound-panic-source-literal",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: 'const message = "Failed to execute: query; panic: cleanup();";\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source literals with compound panic text are not runtime diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-realistic-compound-panic-source-literal",
      taskId: "task:evidence:raw-command-realistic-compound-panic-source-literal",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'const message = "Failed to execute: query; panic: unable to open database file";\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source literals with realistic compound panic text are not runtime diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-panic-assignment-label",
      taskId: "task:evidence:raw-command-panic-assignment-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "panic: error = cleanup();",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command semicolon-terminated panic assignments are not runtime diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-clipped-panic-assignment-label",
      taskId: "task:evidence:raw-command-clipped-panic-assignment-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "#include <stdio.h>\nint main() {\npanic: error = cleanup()\nreturn 0;\n}\n",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "raw command clipped panic assignment labels are source readback observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-line-panic",
      taskId: "task:evidence:read-line-panic",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "panic: unable to open database file: not a directory",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "terminal_failure",
    "raw read line-start panic output remains a strong runtime diagnostic",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-source-string-diagnostic-reference",
      taskId: "task:evidence:raw-command-source-string-diagnostic-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'const message = "rg: /tmp/dmesg.log: IO error for operation on /tmp/dmesg.log";\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source literals mentioning diagnostics are not line-start diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-prose-reference",
      taskId: "task:evidence:raw-command-cli-parse-prose-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "The note says jq: parse error: Unfinished JSON term means the fixture is clipped.",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command prose references to CLI parse diagnostics are not terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-expected-output",
      taskId: "task:evidence:raw-command-cli-parse-expected-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "Expected output:\njq: parse error: Unfinished JSON term at EOF at line 213, column 0",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command expected-output blocks mentioning CLI parse diagnostics are not terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-yaml-mapping",
      taskId: "task:evidence:raw-command-cli-parse-yaml-mapping",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "diagnostics:\n  jq: parse error: Unfinished JSON term at EOF at line 213, column 0",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command YAML-like mappings mentioning CLI parse diagnostics are not terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-generic-label",
      taskId: "task:evidence:raw-command-cli-parse-generic-label",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "parser: parse error: fixture at line 1",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "generic parser labels are not command-output parse diagnostics",
  );
  for (const [label, summary] of [
    ["expected", "expected: parse error: fixture at line 1"],
    ["fixture", "fixture: parse error: fixture at line 1"],
    ["message", "message: parse error: fixture at line 1"],
    ["output", "output: parse error: fixture at line 1"],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:raw-command-cli-parse-${label}-label`,
        taskId: `task:evidence:raw-command-cli-parse-${label}-label`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary,
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "unclassified_failure",
      `generic ${label} labels are not command-output parse diagnostics`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-cli-parse-source-string",
      taskId: "task:evidence:raw-command-cli-parse-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: 'const message = "jq: parse error: Unfinished JSON term at EOF";\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source literals mentioning CLI parse diagnostics are not terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-python-location-source-string",
      taskId: "task:evidence:raw-command-python-location-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'const message = "File \\"/testbed/test_fixes.py\\", line 8 SyntaxError: invalid syntax";\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command source literals mentioning Python diagnostics are not flattened diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-python-location-expected-output",
      taskId: "task:evidence:raw-command-python-location-expected-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'Expected output:\nFile "/testbed/test_fixes.py", line 8 SyntaxError: invalid syntax',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command prose examples mentioning Python diagnostics are not flattened diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-python-location-led-prose",
      taskId: "task:evidence:raw-command-python-location-led-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'File "/testbed/test_fixes.py", line 8 should emit SyntaxError: in the expected output',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command location-led prose mentioning Python diagnostics is not flattened diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-python-caret-led-prose",
      taskId: "task:evidence:raw-command-python-caret-led-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'File "/testbed/test_fixes.py", line 8 ^ should emit SyntaxError: in the expected output',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command caret-led prose mentioning Python diagnostics is not flattened diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-python-location-cross-line",
      taskId: "task:evidence:raw-command-python-location-cross-line",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'File "/testbed/test_fixes.py", line 8\nunrelated output\nsyntax error: invalid syntax',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw command cross-line Python location fragments are not flattened diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-warning",
      taskId: "task:evidence:raw-command-warning",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "/home/user/venv/lib/pkg.py:167: UserWarning: compiled against ROCm version 7.11.0",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "raw warnings are not terminal command diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-command-usage-text",
      taskId: "task:evidence:read-command-usage-text",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "usage: rocprof-compute [mode] [options] tool: error: argument --list-metrics: invalid choice: 'gfx1151'",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "raw read output does not inherit command-output usage diagnostics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-cli-parse-text",
      taskId: "task:evidence:read-cli-parse-text",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "jq: parse error: Unfinished JSON term at EOF at line 213, column 0",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "raw read output does not inherit command-output CLI parse diagnostics",
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
      id: "evt:evidence:structured-cli-parse-expected-output",
      taskId: "task:evidence:structured-cli-parse-expected-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"Expected output:\\njq: parse error: Unfinished JSON term at EOF at line 213, column 0"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "structured expected-output blocks mentioning CLI parse diagnostics are not terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-cli-parse-diagnostic",
      taskId: "task:evidence:structured-cli-parse-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"jq: parse error: Unfinished JSON term at EOF at line 213, column 0"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "structured command output CLI parse diagnostics should be terminal",
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
      id: "evt:evidence:structured-compound-panic-source-string",
      taskId: "task:evidence:structured-compound-panic-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"Failed to execute: query; panic: cleanup();\\";\\nreturn message;"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "structured source strings with compound panic text stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-realistic-compound-panic-source-string",
      taskId: "task:evidence:structured-realistic-compound-panic-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"Failed to execute: query; panic: unable to open database file\\";\\nreturn message;"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "structured source strings with realistic compound panic text stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:recovered-realistic-compound-panic-source-string",
      taskId: "task:evidence:recovered-realistic-compound-panic-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"Failed to execute: query; panic: unable to open database file\\";\\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "recovered source strings with realistic compound panic text stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-panic-label-source-string",
      taskId: "task:evidence:structured-panic-label-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() {\\npanic: return 1;\\n}\\n"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "structured source labels named panic stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-clipped-panic-assignment-source-string",
      taskId: "task:evidence:structured-clipped-panic-assignment-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() {\\npanic: error = cleanup()\\nreturn 0;\\n}\\n"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "structured clipped panic assignment labels stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:recovered-clipped-panic-assignment-source-string",
      taskId: "task:evidence:recovered-clipped-panic-assignment-source-string",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() {\\npanic: error = cleanup()\\nreturn 0;\\n}\\n',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "recovered clipped panic assignment labels stay observational",
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
      id: "evt:evidence:recovered-source-plus-test-failed",
      taskId: "task:evidence:recovered-source-plus-test-failed",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"#include <stdio.h>\\nint main() { return 0; }\\ntest failed: expected 1',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "recovered source plus line-start test failure should be terminal",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-test-failed-source-literal",
      taskId: "task:evidence:structured-test-failed-source-literal",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: JSON.stringify({
        wall_time: "0.0510 seconds",
        output: 'const message = "test failed";\nreturn message;',
      }),
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "structured source literals mentioning test failed stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:recovered-test-failed-source-literal",
      taskId: "task:evidence:recovered-test-failed-source-literal",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"const message = \\"test failed\\";\\nreturn message;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "recovered source literals mentioning test failed stay observational",
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
    "structured_tool_output_observation",
    "zero-exit command metadata can promote one listing row to observation",
  );
  const documentedIssueRow = readTaskFailureSemanticEvidence({
    id: "evt:evidence:truncated-zero-exit-single-documented-issue",
    taskId: "task:evidence:truncated-zero-exit-single-documented-issue",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary:
      '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Test failed is documented here...',
    status: "failed",
    toolFamily: "bash",
  });
  assert.equal(documentedIssueRow?.kind, "structured_tool_output_observation");
  assert.equal(documentedIssueRow?.consequenceBaseline, "medium");
  for (const [id, output] of [
    ["test-failed-row", "reports/results.txt:17:Test failed: expected 1, got 2..."],
    ["tests-failed-row", "reports/results.txt:17:Tests failed..."],
    ["build-failed-row", "docs/results.md:17:Build failed: missing artifact..."],
    ["assertion-error-row", "tests/test_parser.py:17:AssertionError: expected output..."],
    ["unhandled-exception-row", "src/app.ts:17:Unhandled exception: boom..."],
    ["failed-marker-row", "reports/results.txt:17:FAILED tests/test_parser.py::test_parse..."],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:truncated-zero-exit-single-${id}`,
        taskId: `task:evidence:truncated-zero-exit-single-${id}`,
        timestamp,
        type: "task.updated",
        title: "bash failure",
        summary: JSON.stringify({ exit_code: 0, wall_time: "0.0510 seconds", output }),
        status: "failed",
        toolFamily: "bash",
      })?.kind,
      "terminal_failure",
      `zero-exit single listing row does not override direct diagnostic body: ${output}`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-zero-exit-single-source-location",
      taskId: "task:evidence:truncated-zero-exit-single-source-location",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "structured_tool_output_observation",
    "zero-exit command metadata can promote one source-location row to observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-zero-exit-single-row-plus-prose",
      taskId: "task:evidence:truncated-zero-exit-single-row-plus-prose",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Test failed is documented here...\\nextra prose',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "zero-exit single-row exception consumes the whole visible payload",
  );
  for (const toolFamily of ["edit", "opaque_runner"] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${toolFamily}-zero-exit-single-row`,
        taskId: `task:evidence:${toolFamily}-zero-exit-single-row`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily} failure`,
        summary:
          '{"exit_code":0,"wall_time":"0.0510 seconds","output":"docs/guide.md:17:Test failed is documented here...',
        status: "failed",
        toolFamily,
      })?.kind,
      "terminal_failure",
      `${toolFamily} does not receive the command-owned single-row exception`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-zero-exit-single-diagnostic-location",
      taskId: "task:evidence:truncated-zero-exit-single-diagnostic-location",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":0,"wall_time":"0.0510 seconds","output":"src/runtime/trap_handler.s:71: error: invalid operand...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "zero-exit single listing rows do not override visible diagnostics",
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
      id: "evt:evidence:truncated-path-qualified-readback",
      taskId: "task:evidence:truncated-path-qualified-readback",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/repo/src/driver.c:584:\\tWREG32(SOC15_REG_OFFSET(GC, 0, regSQ_CMD), sq_cmd);\\n/repo/src/driver...',
      status: "failed",
      toolFamily: "exec_command",
    })?.consequenceBaseline,
    "medium",
    "clipped command path-qualified readbacks are medium-consequence observations, not source authority",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-path-qualified-diagnostic-readback",
      taskId: "task:evidence:truncated-path-qualified-diagnostic-readback",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/repo/src/app.ts:33: error TS2345: Argument of type string is not assignable...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "terminal_failure",
    "clipped path-qualified diagnostics keep terminal precedence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-truncated-path-qualified-readback",
      taskId: "task:evidence:web-truncated-path-qualified-readback",
      timestamp,
      type: "task.updated",
      title: "web failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/repo/docs/CHANGELOG.md:33:* ordinary readback content...',
      status: "failed",
      toolFamily: "web",
    })?.kind,
    "unclassified_failure",
    "recovered command readback semantics do not leak into unsupported tool output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-toolchain-warning-readback",
      taskId: "task:evidence:truncated-toolchain-warning-readback",
      timestamp,
      type: "task.updated",
      title: "run_shell_command failure",
      summary:
        '{"output":"clang: warning: CUDA version 12.9 is only partially supported [-Wunknown-cuda-version]\\nIn file included from /repo/src/kernel.cu:1:...',
      status: "failed",
      toolFamily: "run_shell_command",
    })?.consequenceBaseline,
    "medium",
    "clipped toolchain warnings are recovered command output observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:truncated-toolchain-warning-with-error",
      taskId: "task:evidence:truncated-toolchain-warning-with-error",
      timestamp,
      type: "task.updated",
      title: "run_shell_command failure",
      summary:
        '{"output":"clang: warning: CUDA version 12.9 is only partially supported [-Wunknown-cuda-version]\\n/repo/src/kernel.cu:9: error: no matching function...',
      status: "failed",
      toolFamily: "run_shell_command",
    })?.kind,
    "terminal_failure",
    "recovered warning output does not override compiler errors",
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
  for (const toolFamily of ["bash", "exec_command", "edit", "read"] as const) {
    for (const [index, summary] of ["{}", "{ }", "{\n}", "\n{}\t"].entries()) {
      const emptyPayloadEvidence = readTaskFailureSemanticEvidence({
        id: `evt:evidence:empty-object:${toolFamily}:${index}`,
        taskId: `task:evidence:empty-object:${toolFamily}:${index}`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily} failure`,
        summary,
        status: "failed",
        toolFamily,
      });
      assert.equal(emptyPayloadEvidence?.kind, "empty_failure_payload", summary);
      assert.equal(emptyPayloadEvidence?.failureDetail, "absent_evidence", summary);
      assert.equal(emptyPayloadEvidence?.readsAsObservation, false, summary);
      assert.equal(emptyPayloadEvidence?.consequenceBaseline, "medium", summary);
    }
  }
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
  const commandObservationSource = readTaskFailureSemanticEvidence({
    id: "evt:evidence:command-observation-source",
    taskId: "task:evidence:command-observation-source",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary:
      'OBSERVATION: def finish(self, chunk: Optional[Union[str, bytes, dict]] = None) -> "Future[None]": """Finishes this response."""',
    status: "failed",
    toolFamily: "bash",
  });
  assert.equal(commandObservationSource?.kind, "observational_payload");
  assert.equal(commandObservationSource?.toolFamily, "bash");
  assert.equal(commandObservationSource?.readsAsObservation, true);
  assert.equal(commandObservationSource?.consequenceBaseline, "high");
  assert.deepEqual(
    commandObservationSource?.text,
    readSemanticTextEvidence(
      'bash failure OBSERVATION: def finish(self, chunk: Optional[Union[str, bytes, dict]] = None) -> "Future[None]": """Finishes this response."""',
      "bash",
    ),
  );
  assert.deepEqual(
    evidenceObservationSemantics(commandObservationSource),
    observationSemantics({
      kind: "payload",
      polarity: "neutral",
      origin: "transcript",
      subject: "tool",
      consequenceBaseline: "high",
      toolFamily: "bash",
    }),
    "command-family explicit source observations should not remain failed work",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:command-observation-log",
      taskId: "task:evidence:command-observation-log",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "OBSERVATION: [1] 305 [2025-04-06 03:44:01 +0000] [307] [DEBUG] Current configuration: config: ./gunicorn.conf.py bind: ['127.0.0.1:8000']",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "command-family explicit log observations should not remain failed work",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:command-observation-linter-output",
      taskId: "task:evidence:command-observation-linter-output",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'OBSERVATION: Running yamllint... ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "command-family explicit linter output observations should not remain failed work",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:command-observation-diagnostic",
      taskId: "task:evidence:command-observation-diagnostic",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'OBSERVATION: Error: found undefined alias "missing" in "<unicode string>", line 6, column 9',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "command-family diagnostic observations should be terminal, not observational payloads",
  );
  for (const [toolFamily, summary] of [
    [
      "bash",
      "OBSERVATION: test1.yaml 6:3 error found undefined alias: f_m (anchors) 6:46 error no new line character at the end of file (new-line-at-end-of-file)",
    ],
    [
      "exec_command",
      "OBSERVATION: Running yamllint on file: /tmp/input.yaml Command output: /tmp/input.yaml:2:12: [error] forbidden not a number value '.nan' (float-values)",
    ],
    [
      "run_shell_command",
      "OBSERVATION: Test case 3 - Empty anchor: Line 2: syntax error: expected alphabetic or numeric character, but found '\\n' (syntax) (level: error)",
    ],
  ] as const) {
    const signals = readTaskFailureSemanticSignals({ summary, toolFamily });
    assert.equal(
      signals.commandDiagnosticObservationTranscript,
      true,
      `${toolFamily} should expose command diagnostic observation parity`,
    );
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${toolFamily}-location-diagnostic-observation`,
        taskId: `task:evidence:${toolFamily}-location-diagnostic-observation`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily} failure`,
        summary,
        status: "failed",
        toolFamily,
      })?.kind,
      "terminal_failure",
      `${toolFamily} location diagnostics should be terminal failures`,
    );
  }
  for (const toolFamily of ["bash", "exec_command", "run_shell_command"] as const) {
    for (const [id, summary] of [
      [
        "expected-then-command-output-traceback",
        "OBSERVATION: Expected output:\nfoo.ts 1:2 error fixture (rule)\nCommand output:\nTraceback (most recent call last):\nRuntimeError: actual failure",
      ],
      [
        "expected-then-pytest-output-assertion",
        "OBSERVATION: Expected output:\nfoo.ts 1:2 error fixture (rule)\npytest output:\nE   AssertionError: expected 1",
      ],
      [
        "expected-then-direct-traceback",
        "OBSERVATION: Expected output:\nfoo.ts 1:2 error fixture (rule)\nTraceback (most recent call last):\nRuntimeError: actual failure",
      ],
    ] as const) {
      assert.equal(
        readTaskFailureSemanticEvidence({
          id: `evt:evidence:${toolFamily}-${id}`,
          taskId: `task:evidence:${toolFamily}-${id}`,
          timestamp,
          type: "task.updated",
          title: `${toolFamily} failure`,
          summary,
          status: "failed",
          toolFamily,
        })?.kind,
        "terminal_failure",
        `${toolFamily} should recover later runtime diagnostics after a reference block`,
      );
    }
  }
  const multiLineDiagnosticObservation =
    "OBSERVATION: src/a.ts:1:2: [error] first problem (rule-a)\nsrc/b.ts:2:3: [error] second problem (rule-b)";
  assert.equal(
    readTaskFailureSemanticSignals({
      summary: multiLineDiagnosticObservation,
      toolFamily: "bash",
    }).commandDiagnosticObservationTranscript,
    true,
    "multi-line command diagnostic observations should not be vetoed as source",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:multi-line-command-diagnostic-observation",
      taskId: "task:evidence:multi-line-command-diagnostic-observation",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: multiLineDiagnosticObservation,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "multi-line command diagnostic observations should remain terminal failures",
  );
  for (const [id, summary] of [
    [
      "prefixed-bracketed-command-diagnostic-observation",
      "OBSERVATION: eslint results: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "expected-then-actual-command-diagnostic-observation",
      "OBSERVATION: Expected output: foo.ts 1:2 error fixture text (rule)\nActual output:\nbar.ts 3:4 error actual failure (rule)",
    ],
    [
      "documentation-output-then-actual-command-diagnostic-observation",
      "OBSERVATION: Documentation output: foo.ts 1:2 error fixture text (rule)\nActual output:\nbar.ts 3:4 error actual failure (rule)",
    ],
    [
      "example-output-then-traceback-command-diagnostic-observation",
      "OBSERVATION: Example output: foo.ts 1:2 error fixture text (rule)\nTraceback (most recent call last):\nRuntimeError: actual failure",
    ],
    [
      "docs-wrapper-received-stderr-traceback-command-diagnostic-observation",
      "OBSERVATION: According to the docs:\nReceived stderr:\nTraceback (most recent call last):\nRuntimeError: actual failure",
    ],
    [
      "flattened-expected-then-actual-command-diagnostic-observation",
      "OBSERVATION: Expected output: foo.ts 1:2 error fixture text (rule) Actual output: bar.ts 3:4 error actual failure (rule)",
    ],
    [
      "source-call-then-actual-command-diagnostic-observation",
      'OBSERVATION: logger.error("foo.ts 1:2 error fixture text (rule)")\nActual output:\nbar.ts 3:4 error actual failure (rule)',
    ],
    [
      "source-preamble-then-actual-command-diagnostic-observation",
      'OBSERVATION: Actual output:\nlogger.info("starting")\nbar.ts 3:4 error actual failure (rule)',
    ],
    [
      "expected-then-actual-results-command-diagnostic-observation",
      "OBSERVATION: Expected results: clean\nActual results:\nbar.ts 3:4 error actual failure (rule)",
    ],
    [
      "actual-report-command-diagnostic-observation",
      "OBSERVATION: Actual report:\nbar.ts 3:4 error actual failure (rule)",
    ],
    [
      "received-results-command-diagnostic-observation",
      "OBSERVATION: Received results:\nbar.ts 3:4 error actual failure (rule)",
    ],
    [
      "actual-sample-file-command-diagnostic-observation",
      "OBSERVATION: Actual output:\nsample.ts 1:2 error real failure (rule)",
    ],
    [
      "actual-example-file-command-diagnostic-observation",
      "OBSERVATION: Actual output:\nexample.ts 1:2 error real failure (rule)",
    ],
    [
      "actual-fixture-file-command-diagnostic-observation",
      "OBSERVATION: Actual output:\nfixture.ts 1:2 error real failure (rule)",
    ],
    [
      "actual-baseline-file-command-diagnostic-observation",
      "OBSERVATION: Actual output:\nbaseline.ts 1:2 error real failure (rule)",
    ],
    [
      "actual-sectioned-test-command-diagnostic-observation",
      "OBSERVATION: Actual output:\n=== Testing parser ===\nFAIL",
    ],
    [
      "actual-sectioned-inline-test-command-diagnostic-observation",
      "OBSERVATION: Actual output:\n=== Testing parser ===\ntest_parse ... FAIL",
    ],
    [
      "actual-typescript-command-diagnostic-observation",
      "OBSERVATION: Received stderr:\nsrc/a.ts(1,2): error TS2322: Type 'string' is not assignable to type 'number'.",
    ],
    [
      "actual-ansi-command-diagnostic-observation",
      "OBSERVATION: Received stderr:\u001b[31msrc/a.ts:1:2: error first problem (rule-a)\u001b[0m",
    ],
    [
      "actual-pytest-assertion-command-diagnostic-observation",
      "OBSERVATION: Received output:\nE   AssertionError: expected 1",
    ],
    [
      "unsectioned-source-preamble-command-diagnostic-observation",
      'OBSERVATION: logger.info("starting")\nbar.ts 3:4 error actual failure (rule)',
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
      "terminal_failure",
      `${id} should classify actual diagnostic output as terminal`,
    );
  }
  for (const [id, toolFamily, summary] of [
    [
      "warning-only-location-observation",
      "bash",
      'OBSERVATION: test.yaml 1:1 warning missing document start "---" (document-start)',
    ],
    [
      "expected-output-location-reference",
      "bash",
      "OBSERVATION: Expected output: test.yaml 1:1 error missing document end (document-end)",
    ],
    [
      "expected-results-location-reference",
      "bash",
      "OBSERVATION: Expected results: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "expected-report-location-reference",
      "bash",
      "OBSERVATION: Expected report: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "expected-diagnostics-location-reference",
      "bash",
      "OBSERVATION: Expected diagnostics: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "example-results-location-reference",
      "bash",
      "OBSERVATION: Example results: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "example-modified-output-location-reference",
      "bash",
      "OBSERVATION: Example eslint output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "example-current-modified-output-location-reference",
      "bash",
      "OBSERVATION: Example current eslint output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "reference-output-from-tool-location-reference",
      "bash",
      "OBSERVATION: Reference output from eslint: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "desired-output-location-reference",
      "bash",
      "OBSERVATION: Desired output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "for-reference-location-reference",
      "bash",
      "OBSERVATION: For reference, foo.ts 1:2 error fixture (rule)",
    ],
    [
      "sample-from-tool-location-reference",
      "bash",
      "OBSERVATION: Sample from eslint: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "golden-output-location-reference",
      "bash",
      "OBSERVATION: Golden output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "baseline-results-location-reference",
      "bash",
      "OBSERVATION: Baseline results: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "canonical-report-location-reference",
      "bash",
      "OBSERVATION: Canonical report: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "fixture-output-location-reference",
      "bash",
      "OBSERVATION: Fixture output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "documentation-output-location-reference",
      "bash",
      "OBSERVATION: Documentation output: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "the-report-location-reference",
      "bash",
      "OBSERVATION: The report: src/a.ts:1:2: [error] first problem (rule-a)",
    ],
    [
      "example-actual-output-location-reference",
      "bash",
      "OBSERVATION: Example actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "expected-actual-output-location-reference",
      "bash",
      "OBSERVATION: Expected actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "for-reference-actual-output-location-reference",
      "bash",
      "OBSERVATION: For reference, actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "docs-actual-output-location-reference",
      "bash",
      "OBSERVATION: According to the docs, actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "for-example-multiline-actual-output-location-reference",
      "bash",
      "OBSERVATION: For example:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "here-is-example-multiline-actual-output-location-reference",
      "bash",
      "OBSERVATION: Here is an example:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "in-docs-multiline-actual-output-location-reference",
      "bash",
      "OBSERVATION: In the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "shown-docs-multiline-actual-output-location-reference",
      "bash",
      "OBSERVATION: As shown in the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "documentation-format-multiline-actual-output-location-reference",
      "bash",
      "OBSERVATION: The eslint documentation shows this format:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "multiline-for-reference-actual-output-location-reference",
      "bash",
      "OBSERVATION: For reference:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "multiline-docs-actual-output-location-reference",
      "bash",
      "OBSERVATION: According to the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "multiline-fixture-received-report-location-reference",
      "bash",
      "OBSERVATION: Fixture output:\nReceived report:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "example-arbitrary-actual-output-location-reference",
      "bash",
      "OBSERVATION: Example: actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "expected-note-actual-output-location-reference",
      "bash",
      "OBSERVATION: Expected note: actual output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "sample-arbitrary-received-report-location-reference",
      "bash",
      "OBSERVATION: Sample: received report: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "expected-error-location-probe",
      "bash",
      "OBSERVATION: Expected error: Rule did not match at line 1, column 1",
    ],
    [
      "failed-as-expected-probe",
      "bash",
      "OBSERVATION: Test 1 failed as expected with: 'int' object has no attribute 'reshape'",
    ],
    [
      "test-colon-failed-as-expected-probe",
      "bash",
      "OBSERVATION: Test 1: failed as expected: foo.yaml 1:1 error bad value (rule)",
    ],
    [
      "probe-failed-as-expected-probe",
      "bash",
      "OBSERVATION: Probe failed as expected: foo.yaml 1:1 error bad value (rule)",
    ],
    [
      "error-occurred-as-expected-probe",
      "bash",
      "OBSERVATION: Error occurred as expected: './dvc.yaml' validation failed: 2 errors",
    ],
    [
      "parenthetical-expected-probe",
      "bash",
      "OBSERVATION: Error reading invalid hex file (expected): non-hexadecimal number found in fromhex() arg at position 6",
    ],
    [
      "prose-location-example",
      "bash",
      "OBSERVATION: For example, foo.yaml 1:1 error message (rule)",
    ],
    [
      "output-format-location-reference",
      "bash",
      "OBSERVATION: Output format: file.yaml 1:1 error message (rule-name)",
    ],
    [
      "linter-themed-prose-location-reference",
      "bash",
      "OBSERVATION: The eslint documentation shows foo.ts 1:2 error example text (rule)",
    ],
    [
      "linter-themed-prose-currently-shows-reference",
      "bash",
      "OBSERVATION: The eslint documentation currently shows foo.ts 1:2 error example text (rule)",
    ],
    [
      "linter-themed-prose-according-to-reference",
      "bash",
      "OBSERVATION: According to the eslint documentation, foo.ts 1:2 error example text (rule)",
    ],
    [
      "linter-themed-prose-says-reference",
      "bash",
      "OBSERVATION: The eslint documentation says foo.ts 1:2 error fixture (rule)",
    ],
    [
      "linter-themed-prose-display-reference",
      "bash",
      "OBSERVATION: The eslint docs currently display foo.ts 1:2 error fixture (rule)",
    ],
    [
      "linter-themed-prose-docs-colon-reference",
      "bash",
      "OBSERVATION: According to eslint docs: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "docs-show-location-reference",
      "bash",
      "OBSERVATION: The docs show foo.ts 1:2 error example text (rule)",
    ],
    [
      "sample-output-location-reference",
      "bash",
      "OBSERVATION: Sample output: src/a.ts:1:2: [error] fixture (rule)",
    ],
    [
      "sample-output-space-location-reference",
      "bash",
      "OBSERVATION: Sample output: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "reference-results-location-reference",
      "bash",
      "OBSERVATION: Reference results: src/a.ts:1:2: [error] fixture (rule)",
    ],
    [
      "reference-results-space-location-reference",
      "bash",
      "OBSERVATION: Reference results: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "illustrative-report-location-reference",
      "bash",
      "OBSERVATION: Illustrative report: src/a.ts:1:2: [error] fixture (rule)",
    ],
    [
      "illustrative-report-space-location-reference",
      "bash",
      "OBSERVATION: Illustrative report: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "previous-report-location-reference",
      "bash",
      "OBSERVATION: Previous report: src/a.ts:1:2: [error] fixture (rule)",
    ],
    [
      "previous-report-space-location-reference",
      "bash",
      "OBSERVATION: Previous report: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "assignment-location-reference",
      "bash",
      'OBSERVATION: message = "foo.yaml 1:1 error missing end (rule)"',
    ],
    [
      "print-call-location-reference",
      "bash",
      'OBSERVATION: print("foo.yaml 1:1 error missing end (rule)")',
    ],
    [
      "logger-error-location-reference",
      "bash",
      'OBSERVATION: logger.error("foo.yaml 1:1 error bad value (rule)")',
    ],
    [
      "logger-exception-location-reference",
      "bash",
      'OBSERVATION: logger.exception("fixture exception")',
    ],
    [
      "actual-source-call-location-reference",
      "bash",
      'OBSERVATION: Expected output: diagnostic\nActual output:\nlogger.error("src/a.ts 1:2 error fixture (rule)")',
    ],
    [
      "actual-source-push-call-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nerrors.push("foo.ts 1:2 error fixture (rule)")',
    ],
    [
      "source-text-location-reference",
      "bash",
      "OBSERVATION: Source text: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "this-example-shows-location-reference",
      "bash",
      "OBSERVATION: This example shows: foo.ts 1:2 error fixture (rule)",
    ],
    [
      "unsectioned-benign-then-example-output-reference",
      "bash",
      "OBSERVATION: starting\nExample output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "unsectioned-benign-then-throw-source-reference",
      "bash",
      'OBSERVATION: starting\nthrow new Error("tests failed")',
    ],
    [
      "unsectioned-benign-then-constructor-source-reference",
      "bash",
      'OBSERVATION: starting\nTypeError("fixture failure")',
    ],
    [
      "actual-clean-then-expected-output-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected output:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-clean-then-expected-results-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected results:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-clean-then-expected-report-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected report:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-clean-then-expected-diagnostics-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected diagnostics:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-clean-then-expected-errors-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected errors:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-clean-then-expected-failures-reference",
      "bash",
      "OBSERVATION: Actual output:\nclean\nExpected failures:\nfoo.ts 1:2 error fixture (rule)",
    ],
    [
      "actual-throw-error-source-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nthrow new Error("tests failed")',
    ],
    [
      "actual-raise-runtime-source-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nraise RuntimeError("expected exception")',
    ],
    [
      "actual-new-exception-source-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nnew Exception("fixture")',
    ],
    [
      "actual-assigned-new-error-source-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nconst err = new Error("expected exception")',
    ],
    [
      "actual-quoted-exception-source-location-reference",
      "bash",
      'OBSERVATION: Actual output:\n"expected exception"',
    ],
    [
      "actual-constructor-call-location-reference",
      "bash",
      'OBSERVATION: Expected output: diagnostic\nActual output:\nTypeError("fixture error")',
    ],
    [
      "actual-only-constructor-call-location-reference",
      "bash",
      'OBSERVATION: Actual output:\nTypeError("fixture error")',
    ],
    [
      "actual-constructor-call-with-benign-tail-reference",
      "bash",
      'OBSERVATION: Actual output:\nTypeError("fixture failure")\ncompleted',
    ],
    [
      "actual-benign-then-constructor-call-reference",
      "bash",
      'OBSERVATION: Actual output:\nstarting\nTypeError("fixture failure")',
    ],
    [
      "actual-benign-then-source-call-reference",
      "bash",
      'OBSERVATION: Actual output:\nstarting\nlogger.error("foo.ts 1:2 error fixture (rule)")',
    ],
    [
      "actual-runtime-constructor-call-location-reference",
      "bash",
      'OBSERVATION: Expected output: diagnostic\nActual output:\nRuntimeError("fixture failure")',
    ],
    [
      "received-only-runtime-constructor-call-location-reference",
      "bash",
      'OBSERVATION: Received output:\nRuntimeError("fixture failure")',
    ],
    [
      "process-stdout-write-location-reference",
      "bash",
      'OBSERVATION: process.stdout.write("foo.yaml 1:1 error bad value (rule)")',
    ],
    [
      "read-location-diagnostic-observation",
      "read",
      "OBSERVATION: test.yaml 2:27 error no new line character at the end of file (new-line-at-end-of-file)",
    ],
    [
      "search-location-diagnostic-observation",
      "search",
      "OBSERVATION: test.yaml 2:27 error no new line character at the end of file (new-line-at-end-of-file)",
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily} failure`,
        summary,
        status: "failed",
        toolFamily,
      })?.kind,
      "unclassified_failure",
      `${id} should not be promoted by command diagnostic observation parity`,
    );
  }
  for (const [id, summary] of [
    [
      "multiline-template-source-fixture-actual-output-reference",
      "OBSERVATION: const fixture = `\nActual output:\nfoo.ts 1:2 error fixture (rule)\n`;",
    ],
    [
      "fenced-source-fixture-actual-output-reference",
      "OBSERVATION: Source fixture:\n```text\nActual output:\nfoo.ts 1:2 error fixture (rule)\n```",
    ],
    [
      "cat-numbered-readback-actual-output-reference",
      'OBSERVATION: Here is the result of running `cat -n` on /tmp/test.py:\nfixture = """\nActual output:\nfoo.ts 1:2 error fixture (rule)\n"""',
    ],
    [
      "python-triple-quoted-fixture-actual-output-reference",
      'OBSERVATION: fixture = """\nActual output:\nfoo.ts 1:2 error fixture (rule)\n"""',
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
      "observational_payload",
      `${id} should stay source observation rather than terminal failure`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:source-string-location-reference",
      taskId: "task:evidence:source-string-location-reference",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'OBSERVATION: const fixture = "test.yaml 1:1 error missing document end"; return fixture;',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "source literals with diagnostic-looking text should remain observations, not terminal failures",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-location-diagnostic-observation",
      taskId: "task:evidence:missing-tool-location-diagnostic-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: Error parsing YAML: found undefined alias 'i' in \"<unicode string>\", line 5, column 3",
      status: "failed",
    })?.kind,
    "terminal_failure",
    "missing-tool diagnostic observation transcripts keep existing terminal behavior",
  );
  const overlappingDiagnosticObservation =
    'OBSERVATION: Here\'s the result of running `cat -n` on /tmp/test.py:\n1 import os\nTraceback (most recent call last):\n  File "/tmp/test.py", line 1, in <module>';
  assert.equal(
    readExplicitObservationTranscript(overlappingDiagnosticObservation)?.shape,
    "existing_observation",
    "overlapping fixture must exercise the legacy observation transcript reader",
  );
  assert.equal(
    looksLikeObservationTranscriptDiagnostic(
      overlappingDiagnosticObservation.replace(/^OBSERVATION:\s*/i, ""),
    ),
    true,
    "overlapping fixture must also look diagnostic after the observation prefix",
  );
  assert.equal(
    readExplicitNonDiagnosticObservationTranscript(overlappingDiagnosticObservation),
    null,
    "non-diagnostic command observation recovery must reject diagnostic overlap",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:command-observation-readback-traceback",
      taskId: "task:evidence:command-observation-readback-traceback",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: overlappingDiagnosticObservation,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "diagnostic readback observations should keep terminal precedence",
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
  for (const [id, summary] of [
    ["prose-class-prefix", "class schedule needs review before Friday"],
    ["prose-type-prefix", "type the command into the terminal"],
    ["prose-import-prefix", "import the records from the old system"],
    ["title-case-class-prefix", "Class Schedule"],
    ["title-case-interface-prefix", "Interface Status"],
    ["title-case-struct-prefix", "Struct Review"],
    ["title-case-enum-prefix", "Enum Options"],
    ["function-prose-parameters", "function run(this through legal first)"],
    ["function-prose-suffix", "function run() this through legal first"],
    ["function-review-suffix", "function review() before Friday"],
    ["python-def-prose-suffix", "def plan() this through legal first"],
    ["python-async-def-prose-suffix", "async def review() before Friday"],
    ["const-prose-assignment", "const plan = review this before Friday"],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:raw-read-${id}`,
        taskId: `task:evidence:raw-read-${id}`,
        timestamp,
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      })?.kind,
      "unclassified_failure",
      `${id} should not become source observation evidence from a leading keyword alone`,
    );
  }
  for (const [id, summary] of [
    ["python-import", "import os"],
    ["python-import-alias-list", "import os, sys as system"],
    ["python-from-import", "from pathlib import Path"],
    ["python-relative-from-import", "from . import sibling"],
    ["python-parent-from-import", "from ..pkg import value"],
    ["javascript-default-named-import", 'import React, { useState } from "react";'],
    ["typescript-type-import", 'import type { Config } from "./config";'],
    ["typescript-function", "function run(): void {"],
    ["javascript-empty-function-body", "function run() {}"],
    ["javascript-function-body", "function run() { return true; }"],
    ["javascript-function-object-body", "function run() { return { ok: true }; }"],
    ["javascript-function-quoted-brace", 'function run() { return "}"; }'],
    ["typescript-export-async-function", "export async function run(): Promise<void> {"],
    ["javascript-export-default-function", "export default function run() {}"],
    ["typescript-type", "type Config = { enabled: boolean }"],
    ["typescript-class", "class Runner { constructor() {} }"],
    ["python-def", "def plan() -> None:"],
    ["python-async-def", "async def review():"],
    ["c-like-function", "void GpuAgent::PcSamplingThread(pcs_data_t& pcs_data) {"],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:raw-read-${id}`,
        taskId: `task:evidence:raw-read-${id}`,
        timestamp,
        type: "task.updated",
        title: "read failure",
        summary,
        status: "failed",
        toolFamily: "read",
      })?.kind,
      "observational_payload",
      `${id} should keep coherent single-line source syntax observational`,
    );
  }
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
      summary:
        "2126-| S_MIN_F32 | S_CMP_LE_F32 |\n2127-| S_MAX_F32 | S_CMP_GT_F32 |\n2128-| S_MIN_I32 | S_CMP_LT_I32 |",
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
      summary:
        "2126-| S_MIN_F32 | S_CMP_LE_F32 | 2127-| S_MAX_F32 | S_CMP_GT_F32 | 2128-| S_MIN_I32 | S_CMP_LT_I32 |",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:inline-double-dash-grep-context-output",
      taskId: "task:evidence:inline-double-dash-grep-context-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        "2255-- VOP3SD has an SDST field 2256- - V_ADD_CO_U32 adds with carry-out 2257- - V_DIV_SCALE_F32 uses the same encoding",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "routine_search_output",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:inline-path-grep-context-output",
      taskId: "task:evidence:inline-path-grep-context-output",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary:
        "/repo/docs/plan.md-45-- This adds integer ALU overhead /repo/docs/plan.md-46- The fast path remains documented",
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
      text: { shapes: ["terminal_failure", "search_result", "source_code"] },
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
      id: "evt:evidence:numbered-list-false-positive",
      taskId: "task:evidence:numbered-list-false-positive",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "1- first item 2- second item 3- third item",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "unclassified_failure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:unrelated-path-grep-false-positive",
      taskId: "task:evidence:unrelated-path-grep-false-positive",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "alpha.txt-9- one beta.md-1- two",
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
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:two-line-grep-context",
      taskId: "task:evidence:two-line-grep-context",
      timestamp,
      type: "task.updated",
      title: "search failure",
      summary: "2126-| S_MIN_F32 | S_CMP_LE_F32 |\n2127-| S_MAX_F32 | S_CMP_GT_F32 |",
      status: "failed",
      toolFamily: "search",
    })?.kind,
    "unclassified_failure",
  );
});

test("explicit observation transcripts classify only narrow low-consequence subclasses", () => {
  assert.deepEqual(readExplicitObservationTranscript(successfulTestObservationTranscript), {
    shape: "successful_test",
    consequenceBaseline: "low",
  });
  assert.deepEqual(readExplicitObservationTranscript(repeatedSuccessfulTestObservationTranscript), {
    shape: "successful_test",
    consequenceBaseline: "low",
  });
  assert.deepEqual(readExplicitObservationTranscript(concreteTestResultObservationTranscript), {
    shape: "concrete_test_result",
    consequenceBaseline: "high",
  });
  assert.deepEqual(
    readExplicitObservationTranscript(mixedConcreteAndSuccessObservationTranscript),
    {
      shape: "concrete_test_result",
      consequenceBaseline: "high",
    },
  );
  assert.deepEqual(readExplicitObservationTranscript(noProblemsResultObservationTranscript), {
    shape: "successful_test",
    consequenceBaseline: "low",
  });
  assert.deepEqual(readExplicitObservationTranscript(unittestSuccessObservationTranscript), {
    shape: "successful_test",
    consequenceBaseline: "low",
  });
  assert.deepEqual(readExplicitObservationTranscript(pytestSuccessObservationTranscript), {
    shape: "successful_test",
    consequenceBaseline: "low",
  });
  assert.deepEqual(readExplicitObservationTranscript(abbreviatedFileViewObservationTranscript), {
    shape: "abbreviated_file_view",
    consequenceBaseline: "low",
  });
  for (const transcript of [
    rangeBasedAbbreviatedFileViewObservationTranscript,
    lineFetchAbbreviatedFileViewObservationTranscript,
  ]) {
    assert.deepEqual(readExplicitObservationTranscript(transcript), {
      shape: "abbreviated_file_view",
      consequenceBaseline: "low",
    });
  }
  assert.deepEqual(readExplicitObservationTranscript(proceduralHarnessObservationTranscript), {
    shape: "procedural_harness_observation",
    consequenceBaseline: "low",
  });
  for (const summary of [
    mixedProceduralFailureObservationTranscript,
    "OBSERVATION: Please follow the checks below. The verification command timed out after 60 seconds. Run the reproduction script again before submitting.",
    "OBSERVATION: Please follow the steps below. The reproduction command returned nonzero and needs another pass. Rerun the reproduction command after changes.",
    "OBSERVATION: Please follow the steps below. The reproduction script reported permission denied. Rerun the reproduction script after fixing access.",
  ]) {
    assert.equal(readExplicitObservationTranscript(summary), null);
  }
  assert.deepEqual(
    readExplicitObservationTranscript(
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3 2 import sys",
    ),
    {
      shape: "existing_observation",
      consequenceBaseline: "high",
    },
  );
  assert.deepEqual(
    readExplicitObservationTranscript(
      'OBSERVATION: Running yamllint... ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
    ),
    {
      shape: "existing_observation",
      consequenceBaseline: "high",
    },
  );
  assert.deepEqual(
    readExplicitObservationTranscript(
      'OBSERVATION: Running yamllint... ./.yamllint 1:1 warning missing document start "---" (document-start) ./normal.yaml 1:1 warning missing document start "---" (document-start) ./ign-dup/duplicates.yaml 1:1 warning missing document start "---" (document-start) ...',
    ),
    {
      shape: "existing_observation",
      consequenceBaseline: "high",
    },
  );
  assert.deepEqual(
    readExplicitObservationTranscript(
      'OBSERVATION: logger.error("foo.yaml 1:1 error fixture (rule)") ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
    ),
    {
      shape: "existing_observation",
      consequenceBaseline: "high",
    },
  );
  assert.deepEqual(
    readExplicitObservationTranscript(
      "OBSERVATION: Test 1: Cross-document anchors ============================== Line 6, column 3: found undefined alias: f_m (anchors) Test 2: Duplicate anchors ============================== Line 8, column 1: duplicate anchor value (anchors)",
    ),
    {
      shape: "existing_observation",
      consequenceBaseline: "high",
    },
  );

  for (const [summary, diagnostic] of [
    [
      "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes.",
      false,
    ],
    [
      'OBSERVATION: The output should say "All quote formatting tests passed!" after the patch.',
      false,
    ],
    [
      "OBSERVATION: === Testing quote formatting === The expected output is All quote formatting tests passed! after the patch.",
      false,
    ],
    ["OBSERVATION: Ran 3 tests in 0.012s. The report should end with OK before submission.", false],
    ["OBSERVATION: 7 passed in 0.42s is the expected result; then submit the patch.", false],
    ["OBSERVATION: Running pytest should report all tests passed before you continue.", false],
    ["OBSERVATION: Problems found: No problems found should appear before submission.", false],
    [
      "OBSERVATION: Review requirement: Problems found: No problems found must appear in the final response.",
      false,
    ],
    ["OBSERVATION: === Testing parser === Expected output: FAIL", false],
    ["OBSERVATION: === Testing parser === The final response should say ERROR", false],
    ["OBSERVATION: === Testing parser === Validate foo() = true", false],
    ["OBSERVATION: === Testing parser === Expect foo() = true", false],
    [
      "OBSERVATION: === Testing parser === Confirm the output contains Problems found: No problems found.",
      false,
    ],
    ["OBSERVATION: === Testing parser === Check that foo() = true.", false],
    ["OBSERVATION: === Testing parser === You must ensure foo() = true.", false],
    ["OBSERVATION: === Testing parser === To confirm, foo() = true.", false],
    ["OBSERVATION: === Testing parser === The reviewer should check that foo() = true.", false],
    ["OBSERVATION: === Testing parser === For reference, foo() = true.", false],
    ["OBSERVATION: === Testing parser === Confirm the output says FAIL.", false],
    ["OBSERVATION: === Testing parser === For reference, the test reports ERROR.", false],
    ["OBSERVATION: === Testing parser === You must check foo() = true.", false],
    ["OBSERVATION: === Testing parser === Check foo() = true.", false],
    ["OBSERVATION: === Testing parser === Refer to foo() = true.", false],
    ["OBSERVATION: === Testing parser === Use foo() = true as a reference.", false],
    ["OBSERVATION: FAILED (failures=0, errors=0)", false],
    [
      "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE>",
      false,
    ],
    [
      "OBSERVATION: usage: str_replace_editor [-h] [--view_range VIEW_RANGE VIEW_RANGE] command path str_replace_editor: error: argument --view_range: expected 2 arguments",
      true,
    ],
    ["OBSERVATION: jq: parse error: Unfinished JSON term at EOF at line 213, column 0", true],
    [
      'OBSERVATION: File "/testbed/test_fixes.py", line 8 print("x") ^ SyntaxError: invalid syntax',
      true,
    ],
    [
      "OBSERVATION: test1.yaml 6:3 error found undefined alias: f_m (anchors) 6:46 error no new line character at the end of file (new-line-at-end-of-file)",
      true,
    ],
    [
      "OBSERVATION: /tmp/input.yaml:2:12: [error] forbidden not a number value '.nan' (float-values)",
      true,
    ],
    [
      "OBSERVATION: src/a.ts:1:2: [error] first problem (rule-a)\nsrc/b.ts:2:3: [error] second problem (rule-b)",
      true,
    ],
    ["OBSERVATION: eslint results: src/a.ts:1:2: [error] first problem (rule-a)", true],
    [
      "OBSERVATION: Expected output: foo.ts 1:2 error fixture text (rule)\nActual output:\nbar.ts 3:4 error actual failure (rule)",
      true,
    ],
    [
      "OBSERVATION: Documentation output: foo.ts 1:2 error fixture text (rule)\nActual output:\nbar.ts 3:4 error actual failure (rule)",
      true,
    ],
    [
      "OBSERVATION: Example output: foo.ts 1:2 error fixture text (rule)\nTraceback (most recent call last):\nRuntimeError: actual failure",
      true,
    ],
    [
      "OBSERVATION: According to the docs:\nReceived stderr:\nTraceback (most recent call last):\nRuntimeError: actual failure",
      true,
    ],
    ["OBSERVATION: Actual output:\nExceptionGroup: Group of errors (2 sub-exceptions)", true],
    [mixedProceduralFailureObservationTranscript, true],
    [
      "OBSERVATION: Expected output: foo.ts 1:2 error fixture text (rule) Actual output: bar.ts 3:4 error actual failure (rule)",
      true,
    ],
    [
      'OBSERVATION: logger.error("foo.ts 1:2 error fixture text (rule)")\nActual output:\nbar.ts 3:4 error actual failure (rule)',
      true,
    ],
    [
      'OBSERVATION: Actual output:\nlogger.info("starting")\nbar.ts 3:4 error actual failure (rule)',
      true,
    ],
    ['OBSERVATION: logger.info("starting")\nbar.ts 3:4 error actual failure (rule)', true],
    [
      "OBSERVATION: Expected results: clean\nActual results:\nbar.ts 3:4 error actual failure (rule)",
      true,
    ],
    ["OBSERVATION: Actual report:\nbar.ts 3:4 error actual failure (rule)", true],
    ["OBSERVATION: Received results:\nbar.ts 3:4 error actual failure (rule)", true],
    ["OBSERVATION: Actual output:\nsample.ts 1:2 error real failure (rule)", true],
    ["OBSERVATION: Actual output:\nexample.ts 1:2 error real failure (rule)", true],
    ["OBSERVATION: Actual output:\nfixture.ts 1:2 error real failure (rule)", true],
    ["OBSERVATION: Actual output:\nbaseline.ts 1:2 error real failure (rule)", true],
    ["OBSERVATION: Actual output:\n=== Testing parser ===\nFAIL", true],
    ["OBSERVATION: Actual output:\n=== Testing parser ===\ntest_parse ... FAIL", true],
    [
      "OBSERVATION: Received stderr:\nsrc/a.ts(1,2): error TS2322: Type 'string' is not assignable to type 'number'.",
      true,
    ],
    [
      "OBSERVATION: Received stderr:\u001b[31msrc/a.ts:1:2: error first problem (rule-a)\u001b[0m",
      true,
    ],
    ["OBSERVATION: Received output:\nE   AssertionError: expected 1", true],
    ['OBSERVATION: logger.info("starting")\nbar.ts 3:4 error actual failure (rule)', true],
    [
      "OBSERVATION: Error parsing YAML: found undefined alias 'i' in \"<unicode string>\", line 5, column 3",
      true,
    ],
    [
      "OBSERVATION: Test case 3 - Empty anchor: Line 2: syntax error: expected alphabetic or numeric character, but found '\\n' (syntax) (level: error)",
      true,
    ],
    ["OBSERVATION: Error: expected a list for dictionary value @ data['params']", true],
    ["OBSERVATION: Error: parser expected error token, got EOF", true],
    ["OBSERVATION: Error parsing YAML: expected error token at line 2, column 3", true],
    [
      "OBSERVATION: test_disabled (tests.rules.test_anchors.AnchorsTestCase) ... FAIL FAILED (failures=1, errors=1)",
      true,
    ],
    [
      "OBSERVATION: === Testing quote formatting === All quote formatting tests passed! FAILED (failures=1)",
      true,
    ],
    [
      "OBSERVATION: === Testing parser === All parser tests passed! === Testing formatter === FAIL: expected single quotes",
      true,
    ],
    ["OBSERVATION: === Testing parser === FAIL", true],
    ["OBSERVATION: === Testing parser === ERROR", true],
    ["OBSERVATION: === Testing parser === test_parse ... FAIL", true],
    ["OBSERVATION: === Testing parser === AssertionError: expected 1", true],
    ["OBSERVATION: === Testing parser === 1 failure", true],
    ["OBSERVATION: === Testing parser === Failures: 1", true],
    ["OBSERVATION: === Testing parser === Errors: 1", true],
    ["OBSERVATION: === Testing parser === FAIL: expected output foo, got bar", true],
    ["OBSERVATION: === Testing parser === AssertionError: expected output foo, got bar", true],
    ["OBSERVATION: === Testing parser === ERROR: final response differed", true],
    [
      "OBSERVATION: === Testing parser === [ 10%] Building parser object\n[ 20%] Linking parser target\nERROR: expected 1",
      true,
    ],
    [
      "OBSERVATION: === Testing parser === FAIL:\nconst x = 1;\nfunction actual() { return x; }",
      true,
    ],
    ["OBSERVATION: 1 failed", true],
    ["OBSERVATION: test failed: expected 1", true],
    ["OBSERVATION: No tests failed. 0 failed.", false],
    ['OBSERVATION: test.yaml 1:1 warning missing document start "---" (document-start)', false],
    [
      "OBSERVATION: Expected output: test.yaml 1:1 error missing document end (document-end)",
      false,
    ],
    [
      "OBSERVATION: Testing _quote_match function: quote_type='single' -> True (should be True) quote_type='double' -> False (should be False) ...",
      false,
    ],
    [
      "OBSERVATION: Expected output: File created successfully at: /testbed/reproduce_error.py",
      false,
    ],
    ["OBSERVATION: Expected results: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: Expected report: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: Expected diagnostics: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: Example results: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: Example eslint output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Example current eslint output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Reference output from eslint: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Desired output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: For reference, foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Sample from eslint: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Golden output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Baseline results: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Canonical report: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Fixture output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Documentation output: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: The report: src/a.ts:1:2: [error] first problem (rule-a)", false],
    ["OBSERVATION: Example actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Expected actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: For reference, actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: According to the docs, actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: For reference:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: For example:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Here is an example:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: In the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: As shown in the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    [
      "OBSERVATION: The eslint documentation shows this format:\nActual output:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    ["OBSERVATION: According to the docs:\nActual output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Fixture output:\nReceived report:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Actual output:\nFor reference:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Actual output:\nExample output:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Actual output:\nAccording to the docs:\nfoo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: starting\nExample output:\nfoo.ts 1:2 error fixture (rule)", false],
    ['OBSERVATION: starting\nthrow new Error("tests failed")', false],
    ['OBSERVATION: starting\nTypeError("fixture failure")', false],
    [
      "OBSERVATION: Actual output:\nclean\nExpected output:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    [
      "OBSERVATION: Actual output:\nclean\nExpected results:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    [
      "OBSERVATION: Actual output:\nclean\nExpected report:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    [
      "OBSERVATION: Actual output:\nclean\nExpected diagnostics:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    [
      "OBSERVATION: Actual output:\nclean\nExpected errors:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    [
      "OBSERVATION: Actual output:\nclean\nExpected failures:\nfoo.ts 1:2 error fixture (rule)",
      false,
    ],
    ["OBSERVATION: Example: actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Expected note: actual output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Sample: received report: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Expected error: Rule did not match at line 1, column 1", false],
    ["OBSERVATION: Test 1 failed as expected with: 'int' object has no attribute 'reshape'", false],
    ["OBSERVATION: Test 1: failed as expected: foo.yaml 1:1 error bad value (rule)", false],
    ["OBSERVATION: Probe failed as expected: foo.yaml 1:1 error bad value (rule)", false],
    ["OBSERVATION: Error occurred as expected: './dvc.yaml' validation failed: 2 errors", false],
    [
      "OBSERVATION: Error reading invalid hex file (expected): non-hexadecimal number found in fromhex() arg at position 6",
      false,
    ],
    ["OBSERVATION: For example, foo.yaml 1:1 error message (rule)", false],
    ["OBSERVATION: Output format: file.yaml 1:1 error message (rule-name)", false],
    ["OBSERVATION: The eslint documentation shows foo.ts 1:2 error example text (rule)", false],
    [
      "OBSERVATION: The eslint documentation currently shows foo.ts 1:2 error example text (rule)",
      false,
    ],
    [
      "OBSERVATION: According to the eslint documentation, foo.ts 1:2 error example text (rule)",
      false,
    ],
    ["OBSERVATION: The docs show foo.ts 1:2 error example text (rule)", false],
    ["OBSERVATION: Sample output: src/a.ts:1:2: [error] fixture (rule)", false],
    ["OBSERVATION: Sample output: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Reference results: src/a.ts:1:2: [error] fixture (rule)", false],
    ["OBSERVATION: Reference results: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Illustrative report: src/a.ts:1:2: [error] fixture (rule)", false],
    ["OBSERVATION: Illustrative report: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: Previous report: src/a.ts:1:2: [error] fixture (rule)", false],
    ["OBSERVATION: Previous report: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: The eslint documentation says foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: The eslint docs currently display foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: According to eslint docs: foo.ts 1:2 error fixture (rule)", false],
    ['OBSERVATION: message = "foo.yaml 1:1 error missing end (rule)"', false],
    ['OBSERVATION: print("foo.yaml 1:1 error missing end (rule)")', false],
    ['OBSERVATION: logger.error("foo.yaml 1:1 error bad value (rule)")', false],
    ['OBSERVATION: logger.exception("fixture exception")', false],
    [
      'OBSERVATION: Expected output: diagnostic\nActual output:\nlogger.error("src/a.ts 1:2 error fixture (rule)")',
      false,
    ],
    ['OBSERVATION: Actual output:\nerrors.push("foo.ts 1:2 error fixture (rule)")', false],
    ["OBSERVATION: Source text: foo.ts 1:2 error fixture (rule)", false],
    ["OBSERVATION: This example shows: foo.ts 1:2 error fixture (rule)", false],
    ['OBSERVATION: Actual output:\nthrow new Error("tests failed")', false],
    ['OBSERVATION: Actual output:\nraise RuntimeError("expected exception")', false],
    ['OBSERVATION: Actual output:\nnew Exception("fixture")', false],
    ['OBSERVATION: Actual output:\nconst err = new Error("expected exception")', false],
    ['OBSERVATION: Actual output:\n"expected exception"', false],
    ['OBSERVATION: Expected output: diagnostic\nActual output:\nTypeError("fixture error")', false],
    ['OBSERVATION: Actual output:\nTypeError("fixture error")', false],
    ['OBSERVATION: Actual output:\nTypeError("fixture failure")\ncompleted', false],
    ['OBSERVATION: Actual output:\nstarting\nTypeError("fixture failure")', false],
    [
      'OBSERVATION: Actual output:\nstarting\nlogger.error("foo.ts 1:2 error fixture (rule)")',
      false,
    ],
    [
      'OBSERVATION: Expected output: diagnostic\nActual output:\nRuntimeError("fixture failure")',
      false,
    ],
    ["OBSERVATION: Expected output:\nExceptionGroup: Group of errors (2 sub-exceptions)", false],
    ['OBSERVATION: Received output:\nRuntimeError("fixture failure")', false],
    ['OBSERVATION: process.stdout.write("foo.yaml 1:1 error bad value (rule)")', false],
  ]) {
    assert.equal(readExplicitObservationTranscript(summary), null);
    assert.equal(looksLikeExplicitObservationTranscript(summary), false);
    assert.equal(looksLikeExplicitDiagnosticObservationTranscript(summary), diagnostic);
  }
  for (const summary of [
    "OBSERVATION: const result = `1 failed`; return result;",
    'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const expected = "1 failed";',
    "OBSERVATION: // fixture: FAILED (failures=1, errors=0)\nexport const expected = true;",
    "OBSERVATION: const message = `test failed`; return message;",
    'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const message = "test failed";',
    "OBSERVATION: // fixture: tests failed\nexport const expected = true;",
    'OBSERVATION: const report = "Problems found: No problems found";\nreturn report;',
    'OBSERVATION: === Testing parser === const report = "Problems found: No problems found";\nreturn report;',
    'OBSERVATION: === Testing parser === const report = "AssertionError: expected 1";\nreturn report;',
    'OBSERVATION: === Testing parser === const report = "Failures: 1";\nreturn report;',
    "OBSERVATION: === Testing parser === // ERROR is supported\nexport const ok = true;",
    'OBSERVATION: === Testing parser === async function parse() {\n  throw new Error("bad");\n}',
    'OBSERVATION: === Testing parser === async def parse():\n    raise AssertionError("bad")',
    'OBSERVATION: === Testing parser === @dataclass\nclass ErrorCase:\n    message: str = "Failures: 1"',
    "OBSERVATION: === Testing parser === error_handler:\n  mov rax, 1\n  call report_assertion\n  ret",
    "OBSERVATION: === Testing parser === failure_path:\n  mov rax, 0\n  call report_failure\n  ret",
    'OBSERVATION: const message = "jq: parse error: Unfinished JSON term at EOF";\nreturn message;',
    'OBSERVATION: const message = "File \\"/testbed/test_fixes.py\\", line 8 SyntaxError: invalid syntax";\nreturn message;',
    'OBSERVATION: const fixture = "test.yaml 1:1 error missing document end"; return fixture;',
    "OBSERVATION: const fixture = `\nActual output:\nfoo.ts 1:2 error fixture (rule)\n`;",
    "OBSERVATION: Source fixture:\n```text\nActual output:\nfoo.ts 1:2 error fixture (rule)\n```",
    'OBSERVATION: Here is the result of running `cat -n` on /tmp/test.py:\nfixture = """\nActual output:\nfoo.ts 1:2 error fixture (rule)\n"""',
    'OBSERVATION: fixture = """\nActual output:\nfoo.ts 1:2 error fixture (rule)\n"""',
  ]) {
    assert.equal(readExplicitObservationTranscript(summary)?.shape, "existing_observation");
    assert.equal(looksLikeExplicitDiagnosticObservationTranscript(summary), false);
  }
  assert.equal(readExplicitObservationTranscript(editMissObservationTranscript), null);
  assert.equal(readExplicitObservationTranscript(failingTestObservationTranscript), null);
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
  const flattenedYamllint = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-flattened-yamllint-observation",
    taskId: "task:evidence:missing-tool-flattened-yamllint-observation",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      'OBSERVATION: Running yamllint... ./.yamllint 1:1 warning missing document start "---" (document-start) ./normal.yaml 1:1 warning missing document start "---" (document-start) ./ign-dup/duplicates.yaml 1:1 warning missing document start "---" (document-start) ...',
    status: "failed",
  });
  assert.equal(flattenedYamllint?.kind, "observational_payload");
  assert.equal(flattenedYamllint.readsAsObservation, true);
  assert.equal(flattenedYamllint.consequenceBaseline, "high");
  assert.equal(flattenedYamllint.toolFamily, undefined);
  const quotedErrorYamllint = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-quoted-error-yamllint-observation",
    taskId: "task:evidence:missing-tool-quoted-error-yamllint-observation",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      'OBSERVATION: logger.error("foo.yaml 1:1 error fixture (rule)") ./normal.yaml 1:1 warning missing document start "---" (document-start) ./dupe.yaml 2:4 warning wrong indentation (indentation)',
    status: "failed",
  });
  assert.equal(quotedErrorYamllint?.kind, "observational_payload");
  assert.equal(quotedErrorYamllint.readsAsObservation, true);
  assert.equal(quotedErrorYamllint.consequenceBaseline, "high");
  assert.equal(quotedErrorYamllint.toolFamily, undefined);
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-apostrophe-yamllint-observation",
      taskId: "task:evidence:missing-tool-apostrophe-yamllint-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        'OBSERVATION: Here\'s yamllint output: ./.yamllint 1:1 warning missing document start "---" (document-start) ./normal.yaml 1:1 warning missing document start "---" (document-start) ...',
      status: "failed",
    })?.kind,
    "observational_payload",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-possessive-yamllint-observation",
      taskId: "task:evidence:missing-tool-possessive-yamllint-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        'OBSERVATION: Developers\' lint output: ./normal.yaml 1:1 warning missing document start "---" (document-start)',
      status: "failed",
    })?.kind,
    "observational_payload",
  );
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
  for (const [id, summary] of [
    ["successful-test", successfulTestObservationTranscript],
    ["unittest-success", unittestSuccessObservationTranscript],
    ["pytest-success", pytestSuccessObservationTranscript],
    ["repeated-success", repeatedSuccessfulTestObservationTranscript],
    ["no-problems-result", noProblemsResultObservationTranscript],
    ["abbreviated-file-view", abbreviatedFileViewObservationTranscript],
    ["procedural-harness", proceduralHarnessObservationTranscript],
    [
      "command-success",
      'OBSERVATION: Running yamllint... Output: ./normal.yaml 1:1 warning missing document start "---" (document-start) Test PASSED: expected warnings were reported.',
    ],
  ] as const) {
    const evidence = readTaskFailureSemanticEvidence({
      id: `evt:evidence:missing-tool-${id}`,
      taskId: `task:evidence:missing-tool-${id}`,
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary,
      status: "failed",
    });

    assert.equal(evidence?.kind, "observational_payload");
    assert.equal(evidence.readsAsObservation, true);
    assert.equal(evidence.consequenceBaseline, "low");
    assert.equal(evidence.toolFamily, undefined);
  }
  const explicitReadAbbreviatedFileView = readTaskFailureSemanticEvidence({
    id: "evt:evidence:read-abbreviated-file-view",
    taskId: "task:evidence:read-abbreviated-file-view",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary: abbreviatedFileViewObservationTranscript,
    status: "failed",
    toolFamily: "read",
  });
  assert.equal(explicitReadAbbreviatedFileView?.kind, "observational_payload");
  assert.equal(explicitReadAbbreviatedFileView.readsAsObservation, true);
  assert.equal(explicitReadAbbreviatedFileView.consequenceBaseline, "low");
  assert.equal(explicitReadAbbreviatedFileView.toolFamily, "read");
  const explicitReadGeneralizedAbbreviatedFileView = readTaskFailureSemanticEvidence({
    id: "evt:evidence:read-generalized-abbreviated-file-view",
    taskId: "task:evidence:read-generalized-abbreviated-file-view",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary: lineFetchAbbreviatedFileViewObservationTranscript,
    status: "failed",
    toolFamily: "read",
  });
  assert.equal(explicitReadGeneralizedAbbreviatedFileView?.kind, "observational_payload");
  assert.equal(explicitReadGeneralizedAbbreviatedFileView.readsAsObservation, true);
  assert.equal(explicitReadGeneralizedAbbreviatedFileView.consequenceBaseline, "low");
  assert.equal(explicitReadGeneralizedAbbreviatedFileView.toolFamily, "read");
  assert.deepEqual(
    signalObservationSemantics(
      readTaskFailureSemanticSignals({
        summary: lineFetchAbbreviatedFileViewObservationTranscript,
        toolFamily: "read",
      }),
    ),
    observationSemantics({
      kind: "payload",
      polarity: "neutral",
      origin: "read_output",
      subject: "source",
      consequenceBaseline: "low",
      toolFamily: "read",
    }),
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-abbreviated-file-view-note-only",
      taskId: "task:evidence:read-abbreviated-file-view-note-only",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE>",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "explicit-read abbreviated file views require payload evidence",
  );
  const explicitReadAbbreviatedFileViewWithDiagnostic = readTaskFailureSemanticEvidence({
    id: "evt:evidence:read-abbreviated-file-view-diagnostic",
    taskId: "task:evidence:read-abbreviated-file-view-diagnostic",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary: `${abbreviatedFileViewObservationTranscript}\nTraceback (most recent call last): RuntimeError`,
    status: "failed",
    toolFamily: "read",
  });
  assert.equal(explicitReadAbbreviatedFileViewWithDiagnostic?.kind, "terminal_failure");
  assert.equal(explicitReadAbbreviatedFileViewWithDiagnostic.failureDetail, "diagnostic");
  assert.equal(explicitReadAbbreviatedFileViewWithDiagnostic.consequenceBaseline, "high");
  const concreteResult = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-concrete-test-result",
    taskId: "task:evidence:missing-tool-concrete-test-result",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: concreteTestResultObservationTranscript,
    status: "failed",
  });
  assert.equal(concreteResult?.kind, "observational_payload");
  assert.equal(concreteResult.readsAsObservation, true);
  assert.equal(concreteResult.consequenceBaseline, "high");
  assert.equal(concreteResult.toolFamily, undefined);
  const mixedConcreteAndSuccess = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-mixed-concrete-and-success",
    taskId: "task:evidence:missing-tool-mixed-concrete-and-success",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: mixedConcreteAndSuccessObservationTranscript,
    status: "failed",
  });
  assert.equal(mixedConcreteAndSuccess?.kind, "observational_payload");
  assert.equal(mixedConcreteAndSuccess.readsAsObservation, true);
  assert.equal(mixedConcreteAndSuccess.consequenceBaseline, "high");
  assert.equal(mixedConcreteAndSuccess.toolFamily, undefined);
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
    "terminal_failure",
    "tool-output diagnostics are terminal and not downgraded by missing-tool observation recovery",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-cli-parse-diagnostic-observation",
      taskId: "task:evidence:missing-tool-cli-parse-diagnostic-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "OBSERVATION: jq: parse error: Unfinished JSON term at EOF at line 213, column 0",
      status: "failed",
    })?.kind,
    "terminal_failure",
    "CLI parse diagnostics are terminal and not downgraded by missing-tool observation recovery",
  );
  const missingToolExceptionGroup = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-exception-group-observation",
    taskId: "task:evidence:missing-tool-exception-group-observation",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: "OBSERVATION: exceptiongroup.ExceptionGroup: Group of errors (2 sub-exceptions)",
    status: "failed",
  });
  assert.equal(missingToolExceptionGroup?.kind, "terminal_failure");
  assert.equal(missingToolExceptionGroup?.failureDetail, "diagnostic");
  assert.equal(missingToolExceptionGroup?.consequenceBaseline, "high");
  const missingToolFileCreated = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-file-created-observation",
    taskId: "task:evidence:missing-tool-file-created-observation",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
    status: "failed",
  });
  assert.equal(missingToolFileCreated?.kind, "operation_success_observation");
  assert.equal(missingToolFileCreated?.readsAsObservation, true);
  assert.equal(missingToolFileCreated?.consequenceBaseline, "low");
  const missingToolFileEdited = readTaskFailureSemanticEvidence({
    id: "evt:evidence:missing-tool-file-edited-observation",
    taskId: "task:evidence:missing-tool-file-edited-observation",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: "OBSERVATION: The file /testbed/traceback_failed_error.py has been edited.",
    status: "failed",
  });
  assert.equal(missingToolFileEdited?.kind, "operation_success_observation");
  assert.equal(missingToolFileEdited?.readsAsObservation, true);
  assert.equal(missingToolFileEdited?.consequenceBaseline, "low");
  for (const [id, summary] of [
    ["edit-miss", editMissObservationTranscript],
    ["failing-test", failingTestObservationTranscript],
  ] as const) {
    assert.notEqual(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:missing-tool-${id}`,
        taskId: `task:evidence:missing-tool-${id}`,
        timestamp,
        type: "task.updated",
        title: "tool failure",
        summary,
        status: "failed",
      })?.kind,
      "observational_payload",
    );
  }
  for (const toolFamily of ["bash", "exec_command"] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${toolFamily}-file-created-observation`,
        taskId: `task:evidence:${toolFamily}-file-created-observation`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily} failure`,
        summary: "OBSERVATION: File created successfully at: /testbed/exception_test.py",
        status: "failed",
        toolFamily,
      })?.kind,
      "unclassified_failure",
      `${toolFamily} failures must not soften from operation-success text alone`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:unenveloped-file-created-observation",
      taskId: "task:evidence:unenveloped-file-created-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "File created successfully at: /testbed/exception_test.py",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "missing-tool operation success requires the explicit observation envelope",
  );
  for (const [id, summary] of [
    [
      "expected-exception-group-reference",
      "OBSERVATION: Expected output:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    ],
    [
      "sample-exception-group-reference",
      "OBSERVATION: Sample output:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    ],
    [
      "reference-exception-group-reference",
      "OBSERVATION: Reference diagnostics:\nExceptionGroup: Group of errors (2 sub-exceptions)",
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: "tool failure",
        summary,
        status: "failed",
      })?.kind,
      "unclassified_failure",
      `${id} must not become terminal diagnostic evidence`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:expected-file-created-reference",
      taskId: "task:evidence:expected-file-created-reference",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: Expected output: File created successfully at: /testbed/exception_test.py",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "expected file-created output must not become operation-success evidence",
  );
  for (const [id, summary, kind] of [
    [
      "generic-review-instructions",
      "OBSERVATION: Thank you for your work on this issue. Please carefully follow the steps below to help review your changes.",
      "unclassified_failure",
    ],
    [
      "quoted-success-instructions",
      'OBSERVATION: The output should say "All quote formatting tests passed!" after the patch.',
      "unclassified_failure",
    ],
    [
      "banner-success-instructions",
      "OBSERVATION: === Testing quote formatting === The expected output is All quote formatting tests passed! after the patch.",
      "unclassified_failure",
    ],
    [
      "unittest-success-instructions",
      "OBSERVATION: Ran 3 tests in 0.012s. The report should end with OK before submission.",
      "unclassified_failure",
    ],
    [
      "pytest-success-instructions",
      "OBSERVATION: 7 passed in 0.42s is the expected result; then submit the patch.",
      "unclassified_failure",
    ],
    [
      "command-success-instructions",
      "OBSERVATION: Running pytest should report all tests passed before you continue.",
      "unclassified_failure",
    ],
    [
      "no-problems-instructions",
      "OBSERVATION: Problems found: No problems found should appear before submission.",
      "unclassified_failure",
    ],
    [
      "paraphrased-no-problems-instructions",
      "OBSERVATION: Review requirement: Problems found: No problems found must appear in the final response.",
      "unclassified_failure",
    ],
    [
      "expected-output-fail-instructions",
      "OBSERVATION: === Testing parser === Expected output: FAIL",
      "unclassified_failure",
    ],
    [
      "final-response-error-instructions",
      "OBSERVATION: === Testing parser === The final response should say ERROR",
      "unclassified_failure",
    ],
    [
      "validate-concrete-value-instructions",
      "OBSERVATION: === Testing parser === Validate foo() = true",
      "unclassified_failure",
    ],
    [
      "expect-concrete-value-instructions",
      "OBSERVATION: === Testing parser === Expect foo() = true",
      "unclassified_failure",
    ],
    [
      "confirm-no-problems-instructions",
      "OBSERVATION: === Testing parser === Confirm the output contains Problems found: No problems found.",
      "unclassified_failure",
    ],
    [
      "check-concrete-value-instructions",
      "OBSERVATION: === Testing parser === Check that foo() = true.",
      "unclassified_failure",
    ],
    [
      "embedded-must-ensure-instructions",
      "OBSERVATION: === Testing parser === You must ensure foo() = true.",
      "unclassified_failure",
    ],
    [
      "embedded-confirm-instructions",
      "OBSERVATION: === Testing parser === To confirm, foo() = true.",
      "unclassified_failure",
    ],
    [
      "embedded-reviewer-check-instructions",
      "OBSERVATION: === Testing parser === The reviewer should check that foo() = true.",
      "unclassified_failure",
    ],
    [
      "embedded-reference-instructions",
      "OBSERVATION: === Testing parser === For reference, foo() = true.",
      "unclassified_failure",
    ],
    [
      "confirm-fail-reference-instructions",
      "OBSERVATION: === Testing parser === Confirm the output says FAIL.",
      "unclassified_failure",
    ],
    [
      "reference-error-instructions",
      "OBSERVATION: === Testing parser === For reference, the test reports ERROR.",
      "unclassified_failure",
    ],
    [
      "embedded-must-check-instructions",
      "OBSERVATION: === Testing parser === You must check foo() = true.",
      "unclassified_failure",
    ],
    [
      "leading-check-instructions",
      "OBSERVATION: === Testing parser === Check foo() = true.",
      "unclassified_failure",
    ],
    [
      "refer-to-instructions",
      "OBSERVATION: === Testing parser === Refer to foo() = true.",
      "unclassified_failure",
    ],
    [
      "as-reference-instructions",
      "OBSERVATION: === Testing parser === Use foo() = true as a reference.",
      "unclassified_failure",
    ],
    ["zero-failure-summary", "OBSERVATION: FAILED (failures=0, errors=0)", "unclassified_failure"],
    [
      "abbreviated-note-without-payload",
      "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE>",
      "unclassified_failure",
    ],
    [
      "str-replace-usage-diagnostic",
      "OBSERVATION: usage: str_replace_editor [-h] [--view_range VIEW_RANGE VIEW_RANGE] command path str_replace_editor: error: argument --view_range: expected 2 arguments",
      "terminal_failure",
    ],
    [
      "syntax-error-diagnostic",
      'OBSERVATION: File "/testbed/test_fixes.py", line 8 print("x") ^ SyntaxError: invalid syntax',
      "terminal_failure",
    ],
    [
      "failing-unittest-diagnostic",
      "OBSERVATION: test_disabled (tests.rules.test_anchors.AnchorsTestCase) ... FAIL FAILED (failures=1, errors=1)",
      "terminal_failure",
    ],
    [
      "mixed-success-and-failure",
      "OBSERVATION: === Testing quote formatting === All quote formatting tests passed! FAILED (failures=1)",
      "terminal_failure",
    ],
    [
      "sectioned-mixed-success-and-failure",
      "OBSERVATION: === Testing parser === All parser tests passed! === Testing formatter === FAIL: expected single quotes",
      "terminal_failure",
    ],
    ["sectioned-bare-fail", "OBSERVATION: === Testing parser === FAIL", "terminal_failure"],
    ["sectioned-bare-error", "OBSERVATION: === Testing parser === ERROR", "terminal_failure"],
    [
      "sectioned-unittest-fail",
      "OBSERVATION: === Testing parser === test_parse ... FAIL",
      "terminal_failure",
    ],
    [
      "sectioned-assertion-error",
      "OBSERVATION: === Testing parser === AssertionError: expected 1",
      "terminal_failure",
    ],
    ["sectioned-one-failure", "OBSERVATION: === Testing parser === 1 failure", "terminal_failure"],
    [
      "sectioned-failures-count",
      "OBSERVATION: === Testing parser === Failures: 1",
      "terminal_failure",
    ],
    ["sectioned-errors-count", "OBSERVATION: === Testing parser === Errors: 1", "terminal_failure"],
    [
      "sectioned-fail-with-expected-output",
      "OBSERVATION: === Testing parser === FAIL: expected output foo, got bar",
      "terminal_failure",
    ],
    [
      "sectioned-assertion-with-expected-output",
      "OBSERVATION: === Testing parser === AssertionError: expected output foo, got bar",
      "terminal_failure",
    ],
    [
      "sectioned-error-with-final-response",
      "OBSERVATION: === Testing parser === ERROR: final response differed",
      "terminal_failure",
    ],
    [
      "sectioned-build-log-error",
      "OBSERVATION: === Testing parser === [ 10%] Building parser object\n[ 20%] Linking parser target\nERROR: expected 1",
      "terminal_failure",
    ],
    [
      "sectioned-fail-before-source",
      "OBSERVATION: === Testing parser === FAIL:\nconst x = 1;\nfunction actual() { return x; }",
      "terminal_failure",
    ],
    ["direct-failed-count", "OBSERVATION: 1 failed", "terminal_failure"],
    ["direct-failed-phrase", "OBSERVATION: test failed: expected 1", "terminal_failure"],
    ["negated-failed-tests", "OBSERVATION: No tests failed. 0 failed.", "unclassified_failure"],
    [
      "failed-source-literal",
      "OBSERVATION: const result = `1 failed`; return result;",
      "observational_payload",
    ],
    [
      "failed-readback-literal",
      'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const expected = "1 failed";',
      "observational_payload",
    ],
    [
      "failed-commented-source-literal",
      "OBSERVATION: // fixture: FAILED (failures=1, errors=0)\nexport const expected = true;",
      "observational_payload",
    ],
    [
      "failed-phrase-source-literal",
      "OBSERVATION: const message = `test failed`; return message;",
      "observational_payload",
    ],
    [
      "failed-phrase-readback-literal",
      'OBSERVATION: Here is the result of running cat -n on /tmp/test.ts: 1 const message = "test failed";',
      "observational_payload",
    ],
    [
      "failed-phrase-commented-source-literal",
      "OBSERVATION: // fixture: tests failed\nexport const expected = true;",
      "observational_payload",
    ],
    [
      "no-problems-source-literal",
      'OBSERVATION: const report = "Problems found: No problems found";\nreturn report;',
      "observational_payload",
    ],
    [
      "banner-no-problems-source-literal",
      'OBSERVATION: === Testing parser === const report = "Problems found: No problems found";\nreturn report;',
      "observational_payload",
    ],
    [
      "banner-assertion-source-literal",
      'OBSERVATION: === Testing parser === const report = "AssertionError: expected 1";\nreturn report;',
      "observational_payload",
    ],
    [
      "banner-failure-count-source-literal",
      'OBSERVATION: === Testing parser === const report = "Failures: 1";\nreturn report;',
      "observational_payload",
    ],
    [
      "banner-error-comment-source-literal",
      "OBSERVATION: === Testing parser === // ERROR is supported\nexport const ok = true;",
      "observational_payload",
    ],
    [
      "banner-async-function-error-source-literal",
      'OBSERVATION: === Testing parser === async function parse() {\n  throw new Error("bad");\n}',
      "observational_payload",
    ],
    [
      "banner-async-python-assertion-source-literal",
      'OBSERVATION: === Testing parser === async def parse():\n    raise AssertionError("bad")',
      "observational_payload",
    ],
    [
      "banner-decorated-source-literal",
      'OBSERVATION: === Testing parser === @dataclass\nclass ErrorCase:\n    message: str = "Failures: 1"',
      "observational_payload",
    ],
    [
      "banner-error-label-source-literal",
      "OBSERVATION: === Testing parser === error_handler:\n  mov rax, 1\n  call report_assertion\n  ret",
      "observational_payload",
    ],
    [
      "banner-failure-label-source-literal",
      "OBSERVATION: === Testing parser === failure_path:\n  mov rax, 0\n  call report_failure\n  ret",
      "observational_payload",
    ],
  ] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:missing-tool-${id}`,
        taskId: `task:evidence:missing-tool-${id}`,
        timestamp,
        type: "task.updated",
        title: "tool failure",
        summary,
        status: "failed",
      })?.kind,
      kind,
    );
  }
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

test("task failure evidence uses explicit event tool family without text inference", () => {
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:event-tool",
      taskId: "task:evidence:event-tool",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
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

test("task failure evidence does not use context as tool-family evidence", () => {
  const evidence = readTaskFailureSemanticEvidence({
    id: "evt:evidence:context-tool-family",
    taskId: "task:evidence:context-tool-family",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    context: {
      items: [{ id: "tool_family", label: "Tool Family", value: "bash" }],
    },
  });

  assert.equal(evidence?.kind, "unclassified_failure");
  assert.equal(evidence?.toolFamily, undefined);
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

  assert.equal(readsAsRoutineObservationalStatusConflict(event, semantic), true);
  assert.equal(
    readsAsRoutineObservationalStatusConflict(event, {
      ...semantic,
      confidence: "medium",
    }),
    false,
  );
  assert.equal(
    readsAsRoutineObservationalStatusConflict(event, {
      ...semantic,
      toolFamily: "read",
    }),
    false,
  );
  assert.equal(readsAsRoutineObservationalStatusConflict(event, semantic, true), false);
});

test("observational status-conflict evidence includes structured, read, and search observations", () => {
  assert.deepEqual(
    readObservationalStatusConflict(
      {
        id: "evt:evidence:execution-success-observation-conflict",
        taskId: "task:evidence:execution-success-observation-conflict",
        timestamp,
        type: "task.updated",
        title: "tool failure",
        summary: '{"exit_code":0,"wall_time":"0.0510 seconds","output":"collected 42 rows"}',
        status: "failed",
      },
      {
        intentFrame: "status_update" as const,
        activityClass: "status_update" as const,
        consequence: "low" as const,
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["task status indicates failure but the update reads like observational output"],
      },
    ),
    {
      kind: "execution_success_observation",
      baselineConsequence: "low",
    },
  );
  assert.equal(
    readsAsRoutineObservationalStatusConflict(
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
    readsAsRoutineObservationalStatusConflict(
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
    readsAsRoutineObservationalStatusConflict(
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
  const ownedReadArrowWindow =
    "1\u2192# GFX1151 Reference (Non-CK) 2\u2192 3\u2192This file keeps hardware/profiling/runtime facts for this machine. 4\u2192CK-specific notes are in `CK_REFERENCE.md`. 5\u2192 6\u2192## Hardware Snapshot 7\u2192 8\u2192| Item | Value | 9\u2192|---|---| 10\u2192| GPU | RDNA 3.5 (`gfx1151`) 11\u2192...";

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
  for (const [id, summary] of [
    [
      "read-owned-amd-logo-arrow-window",
      '1\u2192![AMD logo](2dfa6ac3edfe874f68aa0cbccaa42322_img.jpg) 2\u2192 3\u2192The AMD logo is displayed in the upper center of the page. It consists of the letters "AMD" in a bold, black, sans-serif font, followed by a stylized square icon that represent...',
    ],
    ["read-owned-gfx-reference-arrow-window", ownedReadArrowWindow],
    [
      "read-owned-hip-plan-arrow-window",
      "1\u2192# HIP GEMM Kernel Optimization Plan 2\u2192 3\u2192## Target 4\u2192 5\u2192Kernel: `scaled_mm_kernel_wmma_k0mk1` fp8x fp16 mixed-precision GEMM on RDNA 3.5 (gfx1151). 6\u2192Best config: `(2,4,2,2,4,4)` maps to BlockM=128, BlockN=256...",
    ],
    [
      "read-owned-dmidecode-arrow-window",
      "1\u2192# dmidecode 3.6 2\u2192Getting SMBIOS data from sysfs. 3\u2192SMBIOS 3.7.0 present. 4\u2192 5\u2192Handle 0x0011, DMI type 16, 23 bytes 6\u2192Physical Memory Array 7\u2192 Location: System Board Or Motherboard 8\u2192 Use: System Memory 9\u2192 Error Correction Type: None 10\u2192...",
    ],
    [
      "read-owned-arrow-source-diagnostic-literal",
      '1\u2192const message = "SyntaxError: invalid syntax"; 2\u2192return message; 3\u2192...',
    ],
    [
      "read-owned-natural-number-body-arrow-window",
      "1\u2192There are 2 systems in the rack 2\u2192Second body 3\u2192Third body...",
    ],
    [
      "read-owned-natural-memory-size-arrow-window",
      "1\u2192Requires 4 GB of memory 2\u2192Second body 3\u2192Third body...",
    ],
    [
      "read-owned-natural-type-count-arrow-window",
      "1\u2192Supports 4 type variants 2\u2192Second body 3\u2192Third body...",
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
      "observational_payload",
      `${id} should be a read-owned observation`,
    );
  }
  for (const toolFamily of [undefined, "bash", "edit", "search", "web"] as const) {
    assert.equal(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:read-owned-arrow-boundary-${toolFamily ?? "missing"}`,
        taskId: `task:evidence:read-owned-arrow-boundary-${toolFamily ?? "missing"}`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily ?? "tool"} failure`,
        summary: ownedReadArrowWindow,
        status: "failed",
        ...(toolFamily !== undefined ? { toolFamily } : {}),
      })?.kind,
      "unclassified_failure",
      "read-owned arrow windows require explicit read ownership",
    );
  }
  for (const [id, summary] of [
    ["read-owned-nonconsecutive-arrow-window", "1\u2192# Guide 3\u2192Skipped line 4\u2192..."],
    ["read-owned-nonmonotone-arrow-window", "2\u2192# Guide 1\u2192Earlier line 3\u2192..."],
    ["read-owned-mixed-numbering-window", "1\u2192# Guide 2 Plain body 3\u2192..."],
    [
      "read-owned-mixed-numbering-after-arrow-window",
      "1\u2192# Guide 2\u2192Body 3\u2192More 4 # Legacy...",
    ],
    [
      "read-owned-mixed-numbering-before-arrow-window",
      "9 # Legacy 1\u2192# Guide 2\u2192Body 3\u2192More...",
    ],
    [
      "read-owned-prefixed-mixed-numbering-before-arrow-window",
      "prefix 9 # Legacy 1\u2192# Guide 2\u2192## Build 3\u2192- Configure 4\u2192- Run tests...",
    ],
    [
      "read-owned-duplicate-mixed-numbering-window",
      "1\u2192# Guide 2 # Legacy 2\u2192## Build 3\u2192- Configure 4\u2192- Run tests...",
    ],
    [
      "read-owned-mixed-numbering-skipped-legacy-row",
      "1\u2192# Guide 2\u2192Body 3\u2192More 5 # Legacy...",
    ],
    ["read-owned-empty-arrow-window", "1\u2192 2\u2192 3\u2192..."],
    [
      "read-owned-unclipped-arrow-prose",
      "1\u2192First instruction 2\u2192Second instruction 3\u2192Third instruction",
    ],
    [
      "read-owned-flattened-python-without-transport-window",
      'import os import sys from functools import lru_cache from typing import Optional import torch from torch.utils.cpp_extension import load_inline import time @lru_cache(maxsize=1) def _load_hip_extension(): source_path = os.path.join(os.path.dirname(__file__), "kernel.cpp")...',
    ],
    [
      "read-owned-flattened-markdown-instructions",
      "# Review Steps Please import the class and return to the review instructions. ## Notes - Use the requested output format - Do not edit unrelated files...",
    ],
    [
      "read-owned-unclipped-ts-config-like-text",
      'options: params.options.map((o) => o.label), answer: null, details: { type: "question" } as QuestionDetails',
    ],
    [
      "read-owned-flattened-review-instructions",
      "Please import the class and return to the review instructions before editing the file...",
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
      `${id} should not satisfy read-owned observation grammar`,
    );
  }
  for (const [id, summary] of [
    ["read-owned-read-failure", "Failed to read /tmp/missing.txt"],
    ["read-owned-traceback", "Traceback (most recent call last): RuntimeError"],
    ["read-owned-syntax-error", "SyntaxError: invalid syntax"],
    ["read-owned-compiler-error", "src/app.ts:4:1: error: expected token"],
    [
      "read-owned-arrow-window-compiler-error",
      "1\u2192import os 2\u2192const x = 1; 3\u2192src/app.ts:4:1: error: expected token...",
    ],
    [
      "read-owned-flattened-compiler-error",
      "import os import sys def build(): path = os.path.join('/tmp') src/app.ts:4:1: error: expected token...",
    ],
    [
      "read-owned-flattened-syntax-error",
      "import os import sys def build(): path = os.path.join('/tmp') SyntaxError: invalid syntax...",
    ],
    [
      "read-owned-flattened-read-failure",
      "import os import sys def build(): path = os.path.join('/tmp') Failed to read /tmp/x...",
    ],
    [
      "read-owned-arrow-window-read-failed",
      "1\u2192partial content 2\u2192more content 3\u2192Read failed: backend unavailable...",
    ],
    [
      "read-owned-arrow-window-file-not-found-error",
      "1\u2192partial content 2\u2192FileNotFoundError: missing path 3\u2192...",
    ],
    [
      "read-owned-arrow-window-key-error",
      "1\u2192partial content 2\u2192KeyError: missing key 3\u2192...",
    ],
    [
      "read-owned-arrow-window-os-error",
      "1\u2192partial content 2\u2192OSError: disk unavailable 3\u2192...",
    ],
    [
      "read-owned-arrow-window-timeout-error",
      "1\u2192partial content 2\u2192TimeoutError: request timed out 3\u2192...",
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
      `${id} should keep terminal precedence`,
    );
  }
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-arrow-numbered-python-source",
      taskId: "task:evidence:read-arrow-numbered-python-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "1\u2192import os 2\u2192from functools import lru_cache 3\u2192from typing import Optional 4\u2192 5\u2192import torch 6\u2192from torch.utils.cpp_extension import load_inline 7\u2192import time 8\u2192 9\u2192 10\u2192@lru_cache(maxsize=1) 11\u2192def _load_hip_extension(): 12\u2192 source_path ...",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
    "arrow-numbered flattened source readbacks should stay high-consequence observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-arrow-numbered-markdown-document",
      taskId: "task:evidence:read-arrow-numbered-markdown-document",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "1\u2192# Project Guide 2\u2192## Build 3\u2192- Configure the project 4\u2192- Run the build",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
    "arrow-numbered markdown readbacks should reuse document structure rules",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-flattened-ts-file-start-source",
      taskId: "task:evidence:read-flattened-ts-file-start-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        '/** * Interactive mode for the coding agent. * Handles TUI rendering and user interaction. */ import * as crypto from "node:crypto"; import * as fs from "node:fs"; import * as os from "node:os";...',
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
    "read-owned flattened file-start TypeScript source should stay source-level",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-flattened-ts-mid-file-source",
      taskId: "task:evidence:read-flattened-ts-mid-file-source",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        'options: params.options.map((o) => (typeof o === "string" ? o : o.label)), answer: null, details: { content: [{ type: "text", text: "Error: No options provided" }] } as QuestionDetails, if (params.options.length === 0) { return ...',
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "high",
    "read-owned flattened mid-file TypeScript source requires multiple syntax families",
  );
  assert.deepEqual(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-flattened-markdown-technical-document",
      taskId: "task:evidence:read-flattened-markdown-technical-document",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "# @mariozechner/pi-tui Minimal terminal UI framework with differential rendering and synchronized output for interactive CLI applications. ## Features - **Differential Rendering**: Three-strategy rendering system - **Components**: Reusable terminal widgets...",
      status: "failed",
      toolFamily: "read",
    })?.consequenceBaseline,
    "medium",
    "read-owned flattened markdown technical documents should be medium observations",
  );
  for (const [id, summary, toolFamily] of [
    [
      "bash-flattened-ts-mid-file-source-stays-failure",
      'options: params.options.map((o) => (typeof o === "string" ? o : o.label)), answer: null, details: { content: [{ type: "text", text: "Error: No options provided" }] } as QuestionDetails, if (params.options.length === 0) { return ...',
      "bash",
    ],
    [
      "bash-flattened-markdown-technical-document-stays-failure",
      "# @mariozechner/pi-tui Minimal terminal UI framework with differential rendering and synchronized output for interactive CLI applications. ## Features - **Differential Rendering**: Three-strategy rendering system - **Components**: Reusable terminal widgets...",
      "bash",
    ],
    [
      "missing-tool-flattened-markdown-technical-document-stays-failure",
      "# @mariozechner/pi-tui Minimal terminal UI framework with differential rendering and synchronized output for interactive CLI applications. ## Features - **Differential Rendering**: Three-strategy rendering system - **Components**: Reusable terminal widgets...",
      undefined,
    ],
  ] as const) {
    assert.notEqual(
      readTaskFailureSemanticEvidence({
        id: `evt:evidence:${id}`,
        taskId: `task:evidence:${id}`,
        timestamp,
        type: "task.updated",
        title: `${toolFamily ?? "tool"} failure`,
        summary,
        status: "failed",
        ...(toolFamily !== undefined ? { toolFamily } : {}),
      })?.kind,
      "observational_payload",
      `${id} should not inherit read-owned flattened file grammar`,
    );
  }
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-arrow-numbered-amd-manual-fragment",
      taskId: "task:evidence:read-arrow-numbered-amd-manual-fragment",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary:
        "2783\u2192## 7.6. Dual Issue VALU 2784\u2192 2785\u2192The VOPD instruction encoding allows a single shader instruction to encode two separate VALU operations that are executed in parallel. The two operations must be independent of each other. This ins...",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "observational_payload",
    "numbered technical manual fragments are read observations even when clipped to one section",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:read-legacy-numbered-markdown-document",
      taskId: "task:evidence:read-legacy-numbered-markdown-document",
      timestamp,
      type: "task.updated",
      title: "read failure",
      summary: "1 # Project Guide\n2 ## Build\n3 - Configure the project\n4 - Run tests",
      status: "failed",
      toolFamily: "read",
    })?.kind,
    "unclassified_failure",
    "raw reads only accept arrow-numbered document structure in this tranche",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-arrow-numbered-source",
      taskId: "task:evidence:missing-tool-arrow-numbered-source",
      timestamp,
      type: "task.updated",
      title: "observation",
      summary:
        "1\u2192import os 2\u2192from functools import lru_cache 3\u2192from typing import Optional 4\u2192import torch",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "missing-tool-family arrow source text is not enough to create a read observation",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-nonzero-arrow-source",
      taskId: "task:evidence:structured-nonzero-arrow-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"exit_code":1,"wall_time":"0.0510 seconds","output":"1\u2192import os 2\u2192from functools import lru_cache 3\u2192from typing import Optional"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "nonzero structured command exits retain terminal precedence over arrow source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:structured-mixed-numbered-document",
      taskId: "task:evidence:structured-mixed-numbered-document",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        '{"wall_time":"0.0510 seconds","output":"1 # Project Guide\\n2 ## Build\\n3 - Configure\\n4 - Run tests\\n5\u2192- Ship"}',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "structured document observations do not mix legacy and arrow numbering modes",
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
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:recovered-line-numbered-technical-manual",
      taskId: "task:evidence:recovered-line-numbered-technical-manual",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0501 seconds","output":"2300\\t\\n 2301\\t3.4. Wave State Registers\\n 2302\\t\\n 2303\\t21 of 644\\n 2304\\t\\n 2305\\t\\n\\"RDNA3.5\\" Instruction Set Architecture\\n 2306\\t\\n 2307\\t3.4.2. Mode register\\n 2308\\t\\n 2309\\tMode register ...',
      status: "failed",
      toolFamily: "exec_command",
    })?.consequenceBaseline,
    "medium",
    "recovered line-numbered technical manual snippets are owned observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:recovered-uppercase-shell-source",
      taskId: "task:evidence:recovered-uppercase-shell-source",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0515 seconds","output":"1\\t#!/bin/bash\\n 2\\tset -euo pipefail\\n 3\\t\\n 4\\tROOT_DIR=\\"$(cd \\\\\\"$(dirname \\\\\\"${BASH_SOURCE[0]}\\\\\\")\\\\\\" && pwd)\\"\\n 5\\tOUT_DIR=\\"${ROOT_DIR}/pc_sampling_test_out\\"\\n 6\\tLOG_ROOT=\\"${ROOT_DIR}/pc_samp...',
      status: "failed",
      toolFamily: "exec_command",
    })?.consequenceBaseline,
    "high",
    "recovered clipped shell snippets recognize uppercase assignment source structure",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-flattened-python-source",
      taskId: "task:evidence:raw-command-flattened-python-source",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        'import functools import os from pathlib import Path from torch.utils.cpp_extension import _import_module_from_library, load def get_rocm_lib_dirs() -> list[str]: rocm_lib_dirs = [] for env_var in ("ROCM_HOME", "ROCM_PATH"): rocm_home = o...',
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "observational_payload",
    "explicit command-owned flattened source excerpts are observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-flattened-import-instructions",
      taskId: "task:evidence:raw-command-flattened-import-instructions",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "Please import the class and return to the review instructions before editing the file...",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "command-owned flattened source recognition rejects instructional prose",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-flattened-typescript-compiler-error",
      taskId: "task:evidence:raw-command-flattened-typescript-compiler-error",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary:
        "> check > tsgo --noEmit Checked 405 files in 233ms. No fixes applied. packages/coding-agent/examples/extensions/modal-editor.ts(83,50): error TS2554: Expected 2 arguments, but got 1...",
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "terminal_failure",
    "flattened TypeScript compiler diagnostics stay terminal failures",
  );

  const clippedJavaScriptRuntimeSourceContextDiagnostic =
    '/workspace/project/node_modules/tsx/dist/register-D46fvsV_.cjs:3 `)},"createLog"),x=I(g.bgLightYellow(g.black(" CJS "))),ae=I(g.bgBlue(" ESM "));function createExtensions(){return new URLSearchParams()}...';
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:raw-command-clipped-js-runtime-source-context",
      taskId: "task:evidence:raw-command-clipped-js-runtime-source-context",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: clippedJavaScriptRuntimeSourceContextDiagnostic,
      status: "failed",
      toolFamily: "bash",
    })?.kind,
    "unclassified_failure",
    "clipped JavaScript runtime source context without visible diagnostics remains ambiguous",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-explicit-flattened-source-observation",
      taskId: "task:evidence:missing-tool-explicit-flattened-source-observation",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: def check(conf, token, prev, next, nextnext, context): if (conf['forbid'] is True and isinstance(token, yaml.FlowSequenceStartToken)): yield LintProblem(token.start_mark.line + 1, token.end_mark.column + 1, 'forbidden flow s...",
      status: "failed",
    })?.kind,
    "observational_payload",
    "explicit observation ownership can carry flattened source without inferring a tool family",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:missing-tool-explicit-negative-edit-outcome",
      taskId: "task:evidence:missing-tool-explicit-negative-edit-outcome",
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary:
        "OBSERVATION: No replacement was performed, old_str `@singledispatch def format_exception( __exc: BaseException, limit: Optional[int] = None, chain: bool = True, ) -> List[str]: return list( PatchedTracebackException( type(__exc), __exc, ...",
      status: "failed",
    })?.kind,
    "unclassified_failure",
    "negative operation outcomes keep failure shape even when they quote source",
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
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-source-location-assembly",
      taskId: "task:evidence:exec-command-truncated-source-location-assembly",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/home/user/repo/runtime/trap_handler/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31\\n/home/user/repo/runtime/trap_handler/trap...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "structured_tool_output_observation",
    "clipped path-qualified assembly source hits are source observations",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-c-like-argument-source",
      taskId: "task:evidence:exec-command-truncated-c-like-argument-source",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"d_a, d_b_prepacked, d_bias, d_c,\\nopts.m, opts.n, opts.k,\\n1, // has_bias=1\\nopts.block_warps_m, opts.block_warps_n, opts.unroll_k,\\nstream\\n);\\nif (!launched) {...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "structured_tool_output_observation",
    "clipped C-like argument blocks are source observations when anchored by code context",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-pointer-argument-source",
      taskId: "task:evidence:exec-command-truncated-pointer-argument-source",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"ctx->first,\\nctx->second,\\nctx->third,\\nstream\\n);\\nif (!launched) {...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "structured_tool_output_observation",
    "clipped C-like argument blocks accept pointer-member arguments",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-c-like-stream-source",
      taskId: "task:evidence:exec-command-truncated-c-like-stream-source",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"if (!launched) {\\nstd::cerr << \\"Failed to launch kernel: unsupported config\\" << std::endl;\\nreturn EXIT_FAILURE;\\n}\\nCHECK_HIP(hipStreamSynchronize(stream));\\nstd::vector<float> timing...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "structured_tool_output_observation",
    "diagnostic literals inside clipped C++ stream source stay observational",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:edit-truncated-c-like-stream-source",
      taskId: "task:evidence:edit-truncated-c-like-stream-source",
      timestamp,
      type: "task.updated",
      title: "edit failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"if (!launched) {\\nstd::cerr << \\"Failed to launch kernel: unsupported config\\" << std::endl;\\nreturn EXIT_FAILURE;\\n}\\nCHECK_HIP(hipStreamSynchronize(stream));\\nstd::vector<float> timing...',
      status: "failed",
      toolFamily: "edit",
    })?.kind,
    "unclassified_failure",
    "recovered clipped C++ stream source hardening does not leak into edit semantics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-weak-list-prose",
      taskId: "task:evidence:exec-command-truncated-weak-list-prose",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"first item,\\nsecond item,\\nthird item,\\n);\\nmaybe later...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "unclassified_failure",
    "clipped argument-block observations require code-shaped anchors",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:exec-command-truncated-identifier-list-prose",
      taskId: "task:evidence:exec-command-truncated-identifier-list-prose",
      timestamp,
      type: "task.updated",
      title: "exec_command failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"alpha_item,\\nbeta_item,\\ngamma_item,\\n);\\nreturn later;\\nnotes...',
      status: "failed",
      toolFamily: "exec_command",
    })?.kind,
    "unclassified_failure",
    "clipped argument-block observations require strong member-access evidence",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:edit-truncated-c-like-argument-source",
      taskId: "task:evidence:edit-truncated-c-like-argument-source",
      timestamp,
      type: "task.updated",
      title: "edit failure",
      summary:
        '{"wall_time":"0.0000 seconds","output":"d_a, d_b_prepacked, d_bias, d_c,\\nopts.m, opts.n, opts.k,\\nopts.block_warps_m, opts.block_warps_n, opts.unroll_k,\\nstream\\n);\\nif (!launched) {...',
      status: "failed",
      toolFamily: "edit",
    })?.kind,
    "unclassified_failure",
    "recovered clipped command-output source hardening does not leak into edit semantics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:edit-truncated-source-location-assembly",
      taskId: "task:evidence:edit-truncated-source-location-assembly",
      timestamp,
      type: "task.updated",
      title: "edit failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/home/user/repo/runtime/trap_handler/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31\\n/home/user/repo/runtime/trap_handler/trap...',
      status: "failed",
      toolFamily: "edit",
    })?.kind,
    "unclassified_failure",
    "recovered clipped command source-location hardening does not leak into edit semantics",
  );
  assert.equal(
    readTaskFailureSemanticEvidence({
      id: "evt:evidence:web-truncated-source-location-unsupported",
      taskId: "task:evidence:web-truncated-source-location-unsupported",
      timestamp,
      type: "task.updated",
      title: "web failure",
      summary:
        '{"wall_time":"0.0513 seconds","output":"/home/user/repo/runtime/trap_handler/trap_handler.s:71:.set TTMP6_SPI_TTMPS_SETUP_DISABLED_SHIFT , 31\\n/home/user/repo/runtime/trap_handler/trap...',
      status: "failed",
      toolFamily: "web",
    })?.kind,
    "unclassified_failure",
    "structured command-output recovery remains tool-family bounded",
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
    [
      "arrow-numbered-prose",
      "1\u2192type the command into the terminal 2\u2192from the report, copy settings 3\u2192return later",
    ],
    [
      "raw-read-flattened-import-instructions",
      "Please import the class and return to the review instructions before editing the file...",
    ],
    [
      "recovered-line-numbered-technical-prose-without-anchors",
      '{"wall_time":"0.0510 seconds","output":"1\\tfirst step\\n2\\tsecond step\\n3\\tthird step\\n4\\tfourth step...',
    ],
    [
      "mixed-arrow-space-numbered-source",
      "1\u2192import os 2 from pathlib import Path 3\u2192import sys 4\u2192import re",
    ],
    [
      "mixed-space-arrow-numbered-source",
      "1 import os 2 import sys 3\u2192import re 4 import pathlib",
    ],
    [
      "mixed-arrow-space-numbered-document",
      "1\u2192# Project Guide 2 Legacy row 3\u2192## Build 4\u2192- Configure 5\u2192- Run tests",
    ],
    [
      "mixed-arrow-duplicate-numbered-document",
      "1\u2192# Project Guide 2 # Legacy row 2\u2192## Build 3\u2192- Configure 4\u2192- Run tests",
    ],
    [
      "mixed-prefix-arrow-numbered-document",
      "prefix 9 # Legacy 1\u2192# Project Guide 2\u2192## Build 3\u2192- Configure 4\u2192- Run tests",
    ],
    [
      "nonmonotone-arrow-numbered-source",
      "1\u2192import os 3\u2192from pathlib import Path 2\u2192import sys",
    ],
    ["blank-arrow-numbered-source", "1\u2192 2\u2192 3\u2192import os 4\u2192"],
    [
      "arrow-numbered-heading-prose",
      "1\u2192# Notes 2\u2192## Build 3\u2192plain paragraph 4\u2192another paragraph",
    ],
    [
      "arrow-numbered-nontechnical-section-prose",
      "1\u2192## 1. Build 2\u2192 3\u2192plain paragraph without technical anchors 4\u2192another plain paragraph",
    ],
    [
      "arrow-numbered-acronym-prose-without-clipping",
      "101\u2192## 7.6. API SDK Notes 102\u2192 103\u2192The API and SDK entries are discussed here without an emitted read-window clipping boundary.",
    ],
    [
      "nonconsecutive-arrow-numbered-read-window",
      "2783\u2192## 7.6. Dual Issue VALU 2785\u2192 2786\u2192The VOPD instruction encoding allows a single shader instruction to encode two separate VALU operations that are executed in parallel...",
    ],
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

  assert.equal(readsAsRoutineObservationalStatusConflict(event, semantic), false);
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

  assert.equal(readsAsRoutineObservationalStatusConflict(event, semantic), true);
});
