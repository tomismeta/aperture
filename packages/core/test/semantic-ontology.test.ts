import assert from "node:assert/strict";
import test from "node:test";

import { readSemanticOntologyDiagnostic } from "../src/semantic.js";

const timestamp = "2026-04-05T18:00:00.000Z";

test("approval requests project to a narrow ontology diagnostic", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:approval",
    taskId: "task:ontology:approval",
    type: "human.input.requested",
    interactionId: "interaction:ontology:approval",
    timestamp,
    title: "Approve production deploy",
    summary: "Deploy the prepared release to production.",
    request: { kind: "approval" },
    riskHint: "high",
  });

  assert.deepEqual(diagnostic, {
    ask: "approval",
    activity: "decision_request",
    consequence: "high",
    blocking: "blocking",
    episode: "new",
    confidence: "high",
    source: "explicit",
  });
});

test("waiting status stays a status-shaped, waiting ontology read", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:waiting",
    taskId: "task:ontology:waiting",
    type: "task.updated",
    timestamp,
    title: "Waiting for approval",
    summary: "Work is waiting on an operator decision before continuing.",
    status: "waiting",
  });

  assert.deepEqual(diagnostic, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "low",
    source: "inferred",
  });
});

test("same-issue repeats project to a resurfaced episode diagnostic", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:resurfaced",
    taskId: "task:ontology:resurfaced",
    type: "task.updated",
    timestamp,
    title: "Deploy failed again",
    summary: "The same deploy failure has resurfaced after another retry.",
    status: "failed",
    semanticHints: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "high",
    },
  });

  assert.equal(diagnostic.activity, "failure");
  assert.equal(diagnostic.blocking, "non_blocking");
  assert.equal(diagnostic.episode, "resurfaced");
  assert.equal(diagnostic.source, "hinted");
});

test("resolving relation hints project to a resolved episode diagnostic", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:resolved",
    taskId: "task:ontology:resolved",
    type: "task.updated",
    timestamp,
    title: "Deploy completed successfully",
    summary: "The previous deploy issue is now resolved.",
    status: "completed",
    semanticHints: {
      relationHints: [{ kind: "resolves" }],
      confidence: "high",
    },
  });

  assert.equal(diagnostic.activity, "task_completion");
  assert.equal(diagnostic.episode, "resolved");
  assert.equal(diagnostic.source, "hinted");
});
