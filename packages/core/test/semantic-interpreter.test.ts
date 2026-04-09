import assert from "node:assert/strict";
import test from "node:test";

import { interpretSourceEvent } from "../src/semantic-interpreter.js";

const timestamp = "2026-04-06T12:00:00.000Z";

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
    summary: "The production deploy issue did not regress after the fix and shows no regression now.",
    status: "running",
  });

  assert.deepEqual(interpretation.relationHints, []);
});
