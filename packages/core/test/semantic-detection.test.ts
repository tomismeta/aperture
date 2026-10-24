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
  detectImpliedOperatorAsk,
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

test("command risk recognizes equivalent destructive flags within command families", () => {
  for (const toolFamily of ["bash", "exec_command", "run_shell_command"]) {
    for (const command of [
      "rm -rf ./dist",
      "rm -fr ./dist",
      "rm -rfv ./dist",
      "rm -rvf ./dist",
      "rm -v -r --verbose -f ./dist",
      "rm -r -f ./dist",
      "rm -f -r ./dist",
      "rm -R -f ./dist",
      "rm --recursive --force ./dist",
      "rm --force --recursive ./dist",
      "rm -r --force ./dist",
      "rm --force -r ./dist",
      "rm --recursive -f ./dist",
      "rm -f --recursive ./dist",
      "git push -f origin main",
      "git push --force origin main",
      "git push --force-with-lease origin main",
    ]) {
      assert.equal(
        inferConsequenceFromSemanticText(command, "medium", toolFamily),
        "high",
        command,
      );
    }
    for (const command of [
      "pwd",
      "git push origin main",
      "git status",
      "rm ./scratch",
      "rm -- -rf",
    ]) {
      assert.equal(
        inferConsequenceFromSemanticText(command, "medium", toolFamily),
        "medium",
        command,
      );
    }
  }
});

test("command-shaped read and search content does not imply command execution", () => {
  for (const toolFamily of ["read", "search"]) {
    for (const content of ["rm -fr ./dist", "git push -f origin main", "git reset --hard HEAD"]) {
      assert.equal(inferConsequenceFromSemanticText(content, "low", toolFamily), "low");
    }
  }
  for (const toolFamily of [undefined, "custom"]) {
    assert.equal(
      inferConsequenceFromSemanticText("git reset --hard HEAD", "medium", toolFamily),
      "medium",
    );
    assert.equal(
      inferConsequenceFromSemanticText("git push -f origin main", "medium", toolFamily),
      "medium",
    );
  }
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

test("implied ask detection reads direct operator confirmation requests", () => {
  const text = normalizeSemanticText("Can you confirm the deploy result before I close this out?");

  assert.equal(detectImpliedOperatorAsk(text), true);
});

test("implied ask detection honors negated operator request wording", () => {
  const text = normalizeSemanticText("No action needed; continuing automatically.");

  assert.equal(detectImpliedOperatorAsk(text), false);
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

test("explicit tool family comes only from the event field", () => {
  assert.equal(
    readExplicitSemanticToolFamily({
      title: "ignored",
      toolFamily: "BASH",
    }),
    "bash",
  );

  assert.equal(
    readExplicitSemanticToolFamily({
      title: "ignored",
      summary: "metadata no longer carries authority",
      // @ts-expect-error metadata is intentionally outside the semantic tool-family contract.
      metadata: { toolFamily: "BASH" },
    }),
    null,
  );

  assert.equal(
    readExplicitSemanticToolFamily({
      title: "ignored",
      // @ts-expect-error context is intentionally outside the semantic tool-family contract.
      context: {
        items: [{ id: "tool_family", label: "Tool Family", value: "read" }],
      },
    }),
    null,
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

test("relation detection does not treat bounded read guidance as supersession", () => {
  assert.deepEqual(
    detectSemanticRelationHints(
      "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    ),
    [],
  );
});

test("relation detection recognizes bounded imperative supersession wording", () => {
  for (const text of [
    "Use the canary plan instead.",
    "Use this rollback manifest instead.",
    "Switch to the safe deploy plan instead.",
    "Adopt the queued remediation path instead.",
    "Follow the operator recovery checklist instead.",
    "Replace the canary plan with rollback.",
  ]) {
    assert.deepEqual(
      detectSemanticRelationHints(text).map((hint) => hint.kind),
      ["same_issue", "supersedes"],
      text,
    );
  }
});

test("relation detection excludes instead-of constructions from supersession", () => {
  for (const text of [
    "Use offset and limit parameters instead of reading the whole file.",
    "Search for specific content instead of reading the whole file.",
    "The agent may use the cache and retry instead.",
    "Should we use rollback instead?",
    "Don't use rollback instead.",
    "The tool can follow redirects instead.",
    "The agent may replace the current plan with rollback.",
  ]) {
    assert.deepEqual(detectSemanticRelationHints(text), [], text);
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
