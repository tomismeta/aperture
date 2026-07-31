import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXTUAL_RESOLVE_PHRASES,
  ESCALATE_PHRASES,
  HIGH_RISK_PHRASES,
  ISSUE_SIGNAL_PHRASES,
  REPEAT_PHRASES,
  ROUTINE_SUCCESS_PHRASES,
} from "../src/semantic-patterns.js";
import {
  detectExpectedDiagnosticFailure,
  detectObservationalFailureStatus,
  detectRoutineObservationalFailureLowConsequence,
  detectSemanticBlockingSignal,
  detectSemanticRelationHints,
  inferConsequenceFromSemanticText,
  inferSemanticToolFamily,
  normalizeSemanticText,
  readExplicitSemanticToolFamily,
} from "../src/semantic-detection.js";

test("risk phrase matching does not overread product-like words as prod risk", () => {
  const text = normalizeSemanticText(
    "Review the productivity dashboard and product roadmap before the staging deploy.",
  );

  assert.equal(inferConsequenceFromSemanticText(text, "low"), "low");
});

test("risk phrase matching still reads exact prod tokens as high consequence", () => {
  const text = normalizeSemanticText("Approve the prod deploy before continuing.");

  assert.equal(inferConsequenceFromSemanticText(text, "low"), "high");
});

test("blocking phrase detection survives normalization of apostrophes", () => {
  const text = normalizeSemanticText("Work can't continue until credentials are provided.");

  assert.equal(detectSemanticBlockingSignal(text), "blocking");
});

test("blocking phrase detection stays bounded to whole phrases", () => {
  const text = normalizeSemanticText(
    "The service can continue automatically after the queue drains.",
  );

  assert.equal(detectSemanticBlockingSignal(text), null);
});

test("blocking phrase detection does not overread constant-like log tokens", () => {
  const text = normalizeSemanticText(
    "Kernel log emitted CANNOT_CONTINUE_READING while draining the queue.",
  );

  assert.equal(detectSemanticBlockingSignal(text), null);
});

test("semantic pattern families keep repeat and contextual resolve phrases distinct", () => {
  const overlap = REPEAT_PHRASES.filter((phrase) => CONTEXTUAL_RESOLVE_PHRASES.includes(phrase));

  assert.deepEqual(overlap, []);
  assert.ok(HIGH_RISK_PHRASES.includes("prod"));
});

test("regression remains an intentional overlap between issue and escalation phrase families", () => {
  assert.ok(ISSUE_SIGNAL_PHRASES.includes("regression"));
  assert.ok(ESCALATE_PHRASES.includes("regression"));
});

test("explicit tool family can come from metadata or context", () => {
  assert.equal(
    readExplicitSemanticToolFamily({
      title: "ignored",
      metadata: { toolFamily: "BASH" },
    }),
    "bash",
  );

  assert.equal(
    readExplicitSemanticToolFamily({
      title: "ignored",
      context: {
        items: [{ id: "tool_family", label: "Tool Family", value: "read" }],
      },
    }),
    "read",
  );
});

test("tool family inference can read task wording without an explicit tool family", () => {
  assert.equal(
    inferSemanticToolFamily({
      title: "Agent wants to inspect the config",
      summary: "Read the deployment settings before answering.",
    }),
    "read",
  );
});

test("tool family inference prefers the highest-risk family over incidental read wording", () => {
  assert.equal(
    inferSemanticToolFamily({
      title: "Agent wants to read the config and run a shell command",
      summary: "Inspect the settings, then execute the validation command.",
    }),
    "bash",
  );

  assert.equal(
    inferSemanticToolFamily({
      title: "Agent wants to read and write files",
      summary: "Inspect the existing source before writing the patch.",
    }),
    "write",
  );
});

test("observational failure detection recognizes readback payloads but not filenames alone", () => {
  const readback = normalizeSemanticText(
    "Observation: contents of /workspace/app.log showing top 20 lines",
  );
  const filenameOnly = normalizeSemanticText(
    "README_FAILED_TESTS.md was mentioned during the review.",
  );

  assert.equal(detectObservationalFailureStatus(readback, "read"), true);
  assert.equal(detectObservationalFailureStatus(filenameOnly, "read"), false);
});

test("routine observational failure stays low consequence for log-like reads but not source code", () => {
  const logObservation = normalizeSemanticText(
    "Observation path /var/log/system.log showing first 20 lines [ 12.34 ] kernel: ok",
  );
  const sourceCodeObservation = normalizeSemanticText(
    "Observation path /workspace/src/app.ts export function run() { return true; }",
  );

  assert.equal(detectRoutineObservationalFailureLowConsequence(logObservation, "read"), true);
  assert.equal(
    detectRoutineObservationalFailureLowConsequence(sourceCodeObservation, "read"),
    false,
  );
});

test("routine successful bash observations demote failed transport status", () => {
  for (const phrase of ROUTINE_SUCCESS_PHRASES) {
    const routineSuccess = normalizeSemanticText(phrase);

    assert.equal(detectObservationalFailureStatus(routineSuccess, "bash"), true);
    assert.equal(detectRoutineObservationalFailureLowConsequence(routineSuccess, "bash"), true);
  }
});

test("routine successful bash observation detection stays bounded", () => {
  const routineSuccess = normalizeSemanticText(
    "Your command ran successfully and did not produce any output.",
  );
  const nearMiss = normalizeSemanticText("The command completed successfully.");
  const terminalFailure = normalizeSemanticText(
    "Traceback (most recent call last): Error: subprocess failed.",
  );
  const mixedFailure = normalizeSemanticText(
    "Your command ran successfully and did not produce any output. Traceback follows.",
  );
  const mixedExitCodeFailure = normalizeSemanticText(
    "Your command ran successfully and did not produce any output. Error: deployment failed with exit code 1.",
  );
  const prefixedSuccess = normalizeSemanticText(
    "OBSERVATION: Your command ran successfully and did not produce any output.",
  );
  const titledSuccess = normalizeSemanticText(
    "bash failure Your command ran successfully and did not produce any output.",
  );

  assert.equal(detectObservationalFailureStatus(prefixedSuccess, "bash"), true);
  assert.equal(detectRoutineObservationalFailureLowConsequence(prefixedSuccess, "bash"), true);
  assert.equal(detectObservationalFailureStatus(titledSuccess, "bash"), true);
  assert.equal(detectRoutineObservationalFailureLowConsequence(titledSuccess, "bash"), true);
  assert.equal(detectObservationalFailureStatus(routineSuccess), false);
  assert.equal(detectRoutineObservationalFailureLowConsequence(routineSuccess), false);
  assert.equal(detectObservationalFailureStatus(routineSuccess, "read"), false);
  assert.equal(detectRoutineObservationalFailureLowConsequence(routineSuccess, "read"), false);
  assert.equal(detectObservationalFailureStatus(nearMiss, "bash"), false);
  assert.equal(detectRoutineObservationalFailureLowConsequence(nearMiss, "bash"), false);
  assert.equal(detectObservationalFailureStatus(terminalFailure, "bash"), false);
  assert.equal(detectRoutineObservationalFailureLowConsequence(terminalFailure, "bash"), false);
  assert.equal(detectObservationalFailureStatus(mixedFailure, "bash"), false);
  assert.equal(detectRoutineObservationalFailureLowConsequence(mixedFailure, "bash"), false);
  assert.equal(detectObservationalFailureStatus(mixedExitCodeFailure, "bash"), false);
  assert.equal(
    detectRoutineObservationalFailureLowConsequence(mixedExitCodeFailure, "bash"),
    false,
  );
});

test("expected diagnostic failure detection excludes terminal-style failures", () => {
  const diagnostic = normalizeSemanticText(
    "Form is valid false Form errors errorlist Decompress result none usd",
  );
  const terminalFailure = normalizeSemanticText(
    "Form is valid false Exception traceback while running the repro",
  );
  const exitCodeFailure = normalizeSemanticText(
    "Form is valid false Form errors errorlist exited with code 1",
  );

  assert.equal(detectExpectedDiagnosticFailure(diagnostic, "bash"), true);
  assert.equal(detectExpectedDiagnosticFailure(terminalFailure, "bash"), false);
  assert.equal(detectExpectedDiagnosticFailure(exitCodeFailure, "bash"), false);
});

test("relation detection recognizes repeating escalations with issue language", () => {
  const text = normalizeSemanticText(
    "The deploy issue came back again and regressed after recovery.",
  );

  assert.deepEqual(
    detectSemanticRelationHints(text).map((hint) => hint.kind),
    ["same_issue", "repeats", "escalates"],
  );
});

test("relation detection survives surface punctuation and spacing noise", () => {
  assert.deepEqual(
    detectSemanticRelationHints(
      "BUILD   failed   AGAIN !!. The   same   BUILD   is   STILL   failing   in   production. !!",
    ).map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.deepEqual(
    detectSemanticRelationHints(
      "DEPLOY   issue   did   not   REGRESS !!. The   production   DEPLOY   issue   did   not   REGRESS   after   the   fix   and   shows   no   regression   NOW. !!",
    ),
    [],
  );
});

test("relation detection reads asserted cues after prior negated clauses", () => {
  assert.deepEqual(
    detectSemanticRelationHints("The issue was not fixed before. It is fixed now.").map(
      (hint) => hint.kind,
    ),
    ["same_issue", "resolves"],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue did not regress yesterday. It regressed today.").map(
      (hint) => hint.kind,
    ),
    ["same_issue", "escalates"],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue did not regress before but regressed today.").map(
      (hint) => hint.kind,
    ),
    ["same_issue", "escalates"],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue did not return yesterday. It returned today.").map(
      (hint) => hint.kind,
    ),
    ["same_issue", "repeats"],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue did not return before but returned today.").map(
      (hint) => hint.kind,
    ),
    ["same_issue", "repeats"],
  );
});

test("relation detection lets later negated clauses override stale assertions", () => {
  assert.deepEqual(
    detectSemanticRelationHints("The issue was fixed yesterday. It is not fixed now."),
    [],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue regressed yesterday. It did not regress today."),
    [],
  );
  assert.deepEqual(
    detectSemanticRelationHints("The issue returned yesterday. It did not return today."),
    [],
  );
});

test("relation detection lets latest asserted relation family govern continuity", () => {
  const cases: Array<{ text: string; hints: string[] }> = [
    {
      text: "The issue was fixed yesterday, but returned today.",
      hints: ["same_issue", "repeats"],
    },
    {
      text: "The issue returned yesterday, but it is fixed today.",
      hints: ["same_issue", "resolves"],
    },
    {
      text: "The issue was fixed yesterday, but use this plan instead today.",
      hints: ["same_issue", "supersedes"],
    },
    {
      text: "The issue had to use this plan instead yesterday, but it is fixed today.",
      hints: ["same_issue", "resolves"],
    },
    {
      text: "The issue was fixed yesterday, but regressed today.",
      hints: ["same_issue", "escalates"],
    },
    {
      text: "The issue regressed yesterday, but it is fixed today.",
      hints: ["same_issue", "resolves"],
    },
  ];

  for (const { text, hints } of cases) {
    assert.deepEqual(
      detectSemanticRelationHints(text).map((hint) => hint.kind),
      hints,
      text,
    );
  }
});

test("relation detection treats preserved separators as lexical negation boundaries", () => {
  for (const separator of [" ", "-", "_", "/", "."]) {
    assert.deepEqual(
      detectSemanticRelationHints(`The deploy issue shows no${separator}regression now.`),
      [],
      separator,
    );
    assert.deepEqual(
      detectSemanticRelationHints(`The deploy issue is not${separator}returning now.`),
      [],
      separator,
    );
  }
});

test("contextual resolve wording only resolves when issue context is present", () => {
  const withIssueContext = normalizeSemanticText("The production outage recovered after rollback.");
  const withoutIssueContext = normalizeSemanticText("Completed successfully after cleanup.");

  assert.deepEqual(
    detectSemanticRelationHints(withIssueContext).map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
  assert.deepEqual(detectSemanticRelationHints(withoutIssueContext), []);
});

test("negated resolve wording does not infer resolved relation hints", () => {
  const text = normalizeSemanticText(
    "The deploy issue is not resolved and did not recover after the rollback.",
  );

  assert.deepEqual(detectSemanticRelationHints(text), []);
});

test("prospective verification wording does not infer resolved relation hints", () => {
  const examples = [
    "Run the script again to confirm that the issue is fixed.",
    "Rerun the test to see if the error is fixed.",
    "Please verify whether the regression is resolved.",
    "Can you confirm the issue was fixed?",
    "1. Confirm the failure is resolved before submitting.",
    "The deploy issue should be fixed after the retry.",
  ];

  for (const example of examples) {
    const hints = detectSemanticRelationHints(example).map((hint) => hint.kind);
    assert.equal(hints.includes("resolves"), false, example);
  }
});

test("asserted fixed wording still infers resolved relation hints", () => {
  const examples = [
    "Great! The error is fixed.",
    "The retry fixed the issue.",
    "Tests confirm the issue is fixed.",
    "Verify dashboards now; the production outage recovered after rollback.",
  ];

  for (const example of examples) {
    assert.deepEqual(
      detectSemanticRelationHints(example).map((hint) => hint.kind),
      ["same_issue", "resolves"],
      example,
    );
  }
});

test("negated escalation wording does not infer escalating relation hints", () => {
  const text = normalizeSemanticText(
    "The deploy issue did not regress after the fix and shows no regression now.",
  );

  assert.deepEqual(detectSemanticRelationHints(text), []);
});

test("positive no-longer-blocked wording still infers a resolved relation", () => {
  const text = normalizeSemanticText(
    "The deploy issue is no longer blocked after the credentials landed.",
  );

  assert.deepEqual(
    detectSemanticRelationHints(text).map((hint) => hint.kind),
    ["same_issue", "resolves"],
  );
});
