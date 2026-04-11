import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXTUAL_RESOLVE_PHRASES,
  ESCALATE_PHRASES,
  HIGH_RISK_PHRASES,
  ISSUE_SIGNAL_PHRASES,
  REPEAT_PHRASES,
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

test("expected diagnostic failure detection excludes terminal-style failures", () => {
  const diagnostic = normalizeSemanticText(
    "Form is valid false Form errors errorlist Decompress result none usd",
  );
  const terminalFailure = normalizeSemanticText(
    "Form is valid false Exception traceback while running the repro",
  );

  assert.equal(detectExpectedDiagnosticFailure(diagnostic, "bash"), true);
  assert.equal(detectExpectedDiagnosticFailure(terminalFailure, "bash"), false);
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
