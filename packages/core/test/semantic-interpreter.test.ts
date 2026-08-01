import assert from "node:assert/strict";
import test from "node:test";

import { interpretSourceEvent } from "../src/semantic-interpreter.js";

const timestamp = "2026-04-06T12:00:00.000Z";
const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

function source(id: string) {
  return { id, kind: "agent" as const };
}

test("risk hints on human input become source-backed consequence and confidence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:risk-hint",
    type: "human.input.requested",
    taskId: "task:risk-hint",
    interactionId: "interaction:risk-hint",
    timestamp,
    source: source("custom-agent"),
    title: "Approve deploy",
    summary: "The adapter marked this as high risk.",
    request: { kind: "approval" },
    riskHint: "high",
  });

  assert.equal(interpretation.intentFrame, "approval_request");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.confidence, "high");
  assert.equal(interpretation.provenance?.consequence, "source");
  assert.equal(interpretation.provenance?.confidence, "source");
});

test("waiting status with explicit blocking wording becomes blocked work semantically", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:blocked-waiting",
    type: "task.updated",
    taskId: "task:blocked-waiting",
    timestamp,
    source: source("custom-agent"),
    title: "Waiting on credentials",
    summary: "Cannot continue until credentials are provided.",
    status: "waiting",
  });

  assert.equal(interpretation.intentFrame, "blocked_work");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "medium");
  assert.ok(interpretation.reasons.includes("status wording indicates work cannot continue yet"));
});

test("failed readback output stays observational instead of becoming a hard failure", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:observational-failure",
    type: "task.updated",
    taskId: "task:observational-failure",
    timestamp,
    source: source("custom-agent"),
    title: "Read failure output",
    summary: "Observation: contents of /workspace/app.log showing top 20 lines",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.confidence, "high");
});

test("failed empty tool payloads become medium-consequence source-quality gaps", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:empty-failure-payload",
    type: "task.updated",
    taskId: "task:empty-failure-payload",
    timestamp,
    source: source("custom-agent"),
    title: "edit failure",
    summary: "{}",
    status: "failed",
    toolFamily: "edit",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.toolFamily, "edit");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "high");
  assert.equal(interpretation.whyNow, "Work has failed and should be reviewed.");
});

test("failed task semantic interpretation routes observation-core evidence shapes", () => {
  const cases = [
    {
      id: "tool-rejection",
      title: "bash failure",
      summary: rejectedToolUseMessage,
      toolFamily: "bash",
      expected: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        toolFamily: "bash",
      },
    },
    {
      id: "success-observation",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      toolFamily: "bash",
      expected: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        toolFamily: "bash",
      },
    },
    {
      id: "payload-observation",
      title: "read failure output",
      summary: "Observation: contents of /workspace/app.log showing top 20 lines",
      toolFamily: "read",
      expected: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        toolFamily: "read",
      },
    },
    {
      id: "expected-diagnostic",
      title: "bash failure",
      summary:
        "OBSERVATION: Form is valid: False. Form errors: amount required. Decompress result: [None, 'USD']",
      toolFamily: "bash",
      expected: {
        intentFrame: "failure",
        activityClass: "tool_failure",
        consequence: "medium",
        toolFamily: "bash",
      },
    },
    {
      id: "terminal-failure",
      title: "bash failure",
      summary: "Traceback (most recent call last): RuntimeError: deploy failed",
      toolFamily: "bash",
      expected: {
        intentFrame: "failure",
        activityClass: "tool_failure",
        consequence: "high",
        toolFamily: "bash",
      },
    },
  ];

  for (const testCase of cases) {
    const interpretation = interpretSourceEvent({
      id: `evt:observation-core:${testCase.id}`,
      type: "task.updated",
      taskId: `task:observation-core:${testCase.id}`,
      timestamp,
      source: source("custom-agent"),
      title: testCase.title,
      summary: testCase.summary,
      status: "failed",
      toolFamily: testCase.toolFamily,
    });

    assert.equal(interpretation.intentFrame, testCase.expected.intentFrame, testCase.id);
    assert.equal(interpretation.activityClass, testCase.expected.activityClass, testCase.id);
    assert.equal(interpretation.consequence, testCase.expected.consequence, testCase.id);
    assert.equal(interpretation.toolFamily, testCase.expected.toolFamily, testCase.id);
  }
});

test("completed task updates become completion semantics without adapter hints", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-update",
    type: "task.updated",
    taskId: "task:completed-update",
    timestamp,
    source: source("custom-agent"),
    title: "Codex command completed",
    summary: "Codex finished the command.",
    status: "completed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "completion");
  assert.equal(interpretation.activityClass, "tool_completion");
  assert.equal(interpretation.toolFamily, "bash");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "high");
  assert.deepEqual(interpretation.reasons, [
    "task update status explicitly indicates completed work",
  ]);
  assert.equal(interpretation.provenance?.intentFrame, "inferred");
  assert.equal(interpretation.provenance?.activityClass, "inferred");
});

test("completed task updates with implied asks stay low-confidence status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-implied-ask",
    type: "task.updated",
    taskId: "task:completed-implied-ask",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy completed",
    summary: "Can you confirm the deploy result before I close this out?",
    status: "completed",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.whyNow, "Status text implies the operator may need to respond.");
});

test("completed task updates with blocking text stay blocked status updates", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-blocking",
    type: "task.updated",
    taskId: "task:completed-blocking",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy completed",
    summary: "Cannot continue until credentials are provided.",
    status: "completed",
  });

  assert.equal(interpretation.intentFrame, "blocked_work");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "medium");
  assert.equal(interpretation.whyNow, "Work is blocked and may require operator attention.");
});

test("completed task updates with waiting text stay status-shaped", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-waiting",
    type: "task.updated",
    taskId: "task:completed-waiting",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy completed",
    summary: "Approval required before continuing.",
    status: "completed",
  });

  assert.equal(interpretation.intentFrame, "status_update");
  assert.equal(interpretation.activityClass, "status_update");
  assert.equal(interpretation.confidence, "high");
});

test("completed task updates with negated asks remain completion-shaped", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-no-action",
    type: "task.updated",
    taskId: "task:completed-no-action",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy completed",
    summary: "No action needed; continuing automatically.",
    status: "completed",
  });

  assert.equal(interpretation.intentFrame, "completion");
  assert.equal(interpretation.activityClass, "tool_completion");
  assert.equal(interpretation.confidence, "high");
});

test("completed task updates preserve explicit source activity semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-session-status",
    type: "task.updated",
    taskId: "task:completed-session-status",
    timestamp,
    source: source("custom-agent"),
    title: "Workspace ready",
    summary: "The workspace setup completed.",
    status: "completed",
    activityClass: "session_status",
  });

  assert.equal(interpretation.intentFrame, "completion");
  assert.equal(interpretation.activityClass, "session_status");
  assert.equal(interpretation.provenance?.activityClass, "source");
});

test("semantic hints can override completed task update defaults", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:completed-hinted",
    type: "task.updated",
    taskId: "task:completed-hinted",
    timestamp,
    source: source("custom-agent"),
    title: "Workspace recovered",
    summary: "The workspace recovered from a stream interruption.",
    status: "completed",
    semanticHints: {
      activityClass: "session_status",
      confidence: "medium",
      reasons: ["adapter preserved platform lifecycle context"],
    },
  });

  assert.equal(interpretation.intentFrame, "completion");
  assert.equal(interpretation.activityClass, "session_status");
  assert.equal(interpretation.confidence, "medium");
  assert.equal(interpretation.provenance?.activityClass, "hint");
});

test("high-risk wording can still lift an empty failure payload", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:empty-failure-high-risk",
    type: "task.updated",
    taskId: "task:empty-failure-high-risk",
    timestamp,
    source: source("custom-agent"),
    title: "prod deploy failure",
    summary: "{}",
    status: "failed",
    toolFamily: "bash",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.confidence, "high");
});

test("approval requests with explicit low-risk read work stay medium-confidence low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-approval",
    type: "human.input.requested",
    taskId: "task:read-approval",
    interactionId: "interaction:read-approval",
    timestamp,
    source: source("custom-agent"),
    title: "Approve runbook read",
    summary: "Read the production runbook before continuing.",
    request: { kind: "approval" },
    toolFamily: "read",
  });

  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.consequence, "low");
  assert.equal(interpretation.confidence, "medium");
  assert.equal(interpretation.provenance?.toolFamily, "source");
});

test("choice requests keep explicit context tool family without pretending the ask is higher confidence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:choice-context-tool",
    type: "human.input.requested",
    taskId: "task:choice-context-tool",
    interactionId: "interaction:choice-context-tool",
    timestamp,
    source: source("custom-agent"),
    title: "Choose the next step",
    summary: "Decide whether to continue.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "continue", label: "Continue" },
        { id: "stop", label: "Stop" },
      ],
    },
  });

  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.toolFamily, "source");
});

test("medium risk hints on choice requests do not inflate confidence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:choice-risk-hint",
    type: "human.input.requested",
    taskId: "task:choice-risk-hint",
    interactionId: "interaction:choice-risk-hint",
    timestamp,
    source: source("custom-agent"),
    title: "Choose deploy target",
    summary: "Pick the environment to deploy.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "staging", label: "Staging" },
        { id: "production", label: "Production" },
      ],
    },
    riskHint: "medium",
  });

  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.consequence, "source");
  assert.equal(interpretation.provenance?.confidence, "inferred");
});

test("semantic hints override inferred values while preserving merged rationale", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:hints-override",
    type: "task.updated",
    taskId: "task:hints-override",
    timestamp,
    source: source("custom-agent"),
    title: "Still running",
    summary: "The task remains active.",
    status: "running",
    semanticHints: {
      intentFrame: "failure",
      consequence: "high",
      reasons: ["adapter marked this as a trusted failure signal"],
      factors: ["trusted adapter escalation"],
    },
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.consequence, "high");
  assert.ok(interpretation.reasons.includes("adapter marked this as a trusted failure signal"));
  assert.ok(interpretation.factors.includes("trusted adapter escalation"));
  assert.equal(interpretation.provenance?.intentFrame, "hint");
  assert.equal(interpretation.provenance?.consequence, "hint");
});

test("semantic hints cannot inflate inferred confidence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:confidence-inflation",
    type: "task.updated",
    taskId: "task:confidence-inflation",
    timestamp,
    source: source("custom-agent"),
    title: "Need your approval before continuing",
    summary: "Can you approve the deploy so work can continue?",
    status: "waiting",
    semanticHints: {
      whyNow: "Adapter supplied a friendlier explanation.",
      confidence: "high",
    },
  });

  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.confidence, "inferred");
  assert.equal(interpretation.provenance?.whyNow, "hint");
});

test("semantic hints can demote confidence when the source is uncertain", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:confidence-demotion",
    type: "task.updated",
    taskId: "task:confidence-demotion",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy failed",
    summary: "The deployment command failed during verification.",
    status: "failed",
    semanticHints: {
      confidence: "low",
    },
  });

  assert.equal(interpretation.confidence, "low");
  assert.equal(interpretation.provenance?.confidence, "hint");
});

test("empty relation hints do not erase inferred relations", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:empty-relation-hints",
    type: "task.updated",
    taskId: "task:empty-relation-hints",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy failed again",
    summary: "The same deploy failure came back after another retry.",
    status: "failed",
    semanticHints: {
      relationHints: [],
    },
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.equal(interpretation.provenance?.relationHints, "inferred");
});

test("read source-window limit guidance does not infer supersession", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:read-source-window-limit",
    type: "task.updated",
    taskId: "task:read-source-window-limit",
    timestamp,
    source: source("custom-agent"),
    title: "read failure",
    summary:
      "File content (347.9KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.",
    status: "failed",
    toolFamily: "read",
  });

  assert.equal(interpretation.intentFrame, "failure");
  assert.equal(interpretation.activityClass, "tool_failure");
  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.consequence, "medium");
  assert.equal(interpretation.confidence, "high");
  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    [],
  );
});

test("relation hints merge with inferred relations", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:merged-relation-hints",
    type: "task.updated",
    taskId: "task:merged-relation-hints",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy failed again",
    summary: "The same deploy failure came back after another retry.",
    status: "failed",
    semanticHints: {
      relationHints: [{ kind: "supersedes" }],
    },
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats", "supersedes"],
  );
  assert.equal(interpretation.provenance?.relationHints, "hint");
});

test("duplicate relation hints do not upgrade inferred relation provenance", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:duplicate-relation-hints",
    type: "task.updated",
    taskId: "task:duplicate-relation-hints",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy failed again",
    summary: "The same deploy failure came back after another retry.",
    status: "failed",
    semanticHints: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
    },
  });

  assert.deepEqual(
    interpretation.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.equal(interpretation.provenance?.relationHints, "inferred");
});

test("negated resolve wording does not invent resolved relation hints", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:not-resolved",
    type: "task.updated",
    taskId: "task:not-resolved",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy issue not resolved",
    summary: "The production deploy issue is not resolved and did not recover after rollback.",
    status: "failed",
  });

  assert.deepEqual(interpretation.relationHints, []);
});

test("negated regression wording does not invent escalating relation hints", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:not-regressed",
    type: "task.updated",
    taskId: "task:not-regressed",
    timestamp,
    source: source("custom-agent"),
    title: "Deploy issue did not regress",
    summary:
      "The production deploy issue did not regress after the fix and shows no regression now.",
    status: "running",
  });

  assert.deepEqual(interpretation.relationHints, []);
});
