import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAttentionOntologyDiagnostic,
  projectSemanticOntologyDiagnostic,
  readAttentionOntologyDiagnostic,
  readSemanticOntologyDiagnostic,
} from "../src/semantic.js";

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

test("attention ontology entrypoints preserve semantic ontology compatibility", () => {
  const event = {
    id: "evt:ontology:attention-alias",
    taskId: "task:ontology:attention-alias",
    type: "task.updated" as const,
    timestamp,
    title: "Deploy failed",
    summary: "The deployment command failed during verification.",
    status: "failed" as const,
  };
  const attention = readAttentionOntologyDiagnostic(event);
  const semantic = readSemanticOntologyDiagnostic(event);

  assert.deepEqual(attention, semantic);
  assert.deepEqual(
    projectAttentionOntologyDiagnostic(event, {
      intentFrame: "failure",
      activityClass: "tool_failure",
      consequence: "medium",
      whyNow: "The task failed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["status is failed"],
      provenance: {
        intentFrame: "source",
        activityClass: "source",
        consequence: "source",
        confidence: "source",
      },
    }),
    projectSemanticOntologyDiagnostic(event, {
      intentFrame: "failure",
      activityClass: "tool_failure",
      consequence: "medium",
      whyNow: "The task failed.",
      factors: ["task.updated", "failed"],
      relationHints: [],
      confidence: "high",
      reasons: ["status is failed"],
      provenance: {
        intentFrame: "source",
        activityClass: "source",
        consequence: "source",
        confidence: "source",
      },
    }),
  );
});

test("passive waiting status stays a high-confidence status-shaped waiting ontology read", () => {
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
    confidence: "high",
    source: "explicit",
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
      relationHints: [
        { kind: "same_issue", target: "task:ontology:previous-deploy-failure" },
        { kind: "repeats", target: "task:ontology:previous-deploy-failure" },
      ],
      confidence: "high",
    },
  });

  assert.equal(diagnostic.activity, "failure");
  assert.equal(diagnostic.blocking, "non_blocking");
  assert.equal(diagnostic.episode, "resurfaced");
  assert.equal(diagnostic.source, "hinted");
});

test("duplicate relation hints do not demote source-shaped ontology reads to hinted", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:duplicate-relation-hints",
    taskId: "task:ontology:duplicate-relation-hints",
    type: "task.updated",
    timestamp,
    title: "Deploy failed again",
    summary: "The same deploy failure came back after another retry.",
    status: "failed",
    semanticHints: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
    },
  });

  assert.equal(diagnostic.activity, "failure");
  assert.equal(diagnostic.episode, "resurfaced");
  assert.equal(diagnostic.source, "explicit");
});

test("blocked wording can promote a waiting status into a blocking ontology read", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:blocked-wording",
    taskId: "task:ontology:blocked-wording",
    type: "task.updated",
    timestamp,
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
  });

  assert.deepEqual(diagnostic, {
    ask: "status",
    activity: "task_progress",
    consequence: "medium",
    blocking: "blocking",
    episode: "unknown",
    confidence: "medium",
    source: "inferred",
  });
});

test("request-like semantic hints can promote status-shaped events into request-shaped ontology reads", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:hinted-approval",
    taskId: "task:ontology:hinted-approval",
    type: "task.updated",
    timestamp,
    title: "Approval checkpoint reached",
    summary: "A higher-level source marked this as an approval checkpoint.",
    status: "waiting",
    semanticHints: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      confidence: "high",
    },
  });

  assert.deepEqual(diagnostic, {
    ask: "approval",
    activity: "decision_request",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "high",
    source: "hinted",
  });
});

test("decorative whyNow hints do not demote explicit status-shaped ontology reads", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:decorative-why-now",
    taskId: "task:ontology:decorative-why-now",
    type: "task.updated",
    timestamp,
    title: "Deploy failed",
    summary: "The deployment command failed during verification.",
    status: "failed",
    semanticHints: {
      whyNow: "Adapter supplied a friendlier explanation.",
    },
  });

  assert.equal(diagnostic.activity, "failure");
  assert.equal(diagnostic.confidence, "high");
  assert.equal(diagnostic.source, "explicit");
});

test("operator-directed status asks stay inferred in ontology even when the lifecycle fact is explicit", () => {
  const diagnostic = readSemanticOntologyDiagnostic({
    id: "evt:ontology:direct-ask-status",
    taskId: "task:ontology:direct-ask-status",
    type: "task.updated",
    timestamp,
    title: "Need your approval before continuing",
    summary: "Can you approve the deploy so work can continue?",
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
      relationHints: [{ kind: "resolves", target: "task:ontology:previous-deploy-failure" }],
      confidence: "high",
    },
  });

  assert.equal(diagnostic.activity, "task_completion");
  assert.equal(diagnostic.episode, "resolved");
  assert.equal(diagnostic.source, "hinted");
});

test("attention ontology preserves explicit lifecycle activity while relation hints shape episode", () => {
  const diagnostic = readAttentionOntologyDiagnostic({
    id: "evt:ontology:completed-with-noisy-relations",
    taskId: "task:ontology:completed-with-noisy-relations",
    type: "task.updated",
    timestamp,
    title: "Deploy completed after retry",
    summary: "The deployment completed, though adapter context relates it to a prior failure.",
    status: "completed",
    semanticHints: {
      relationHints: [
        { kind: "same_issue", target: "task:ontology:previous-deploy-failure" },
        { kind: "repeats", target: "task:ontology:previous-deploy-failure" },
      ],
      confidence: "high",
    },
  });

  assert.equal(diagnostic.ask, "status");
  assert.equal(diagnostic.activity, "task_completion");
  assert.equal(diagnostic.blocking, "non_blocking");
  assert.equal(diagnostic.episode, "resurfaced");
  assert.equal(diagnostic.source, "hinted");
});

test("normalized events can project ontology diagnostics without re-interpreting source events", () => {
  const diagnostic = projectSemanticOntologyDiagnostic(
    {
      id: "evt:ontology:normalized",
      taskId: "task:ontology:normalized",
      type: "task.updated",
      timestamp,
      title: "Waiting on credentials",
      summary: "Credentials are still missing.",
      status: "waiting",
      semantic: {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        consequence: "medium",
        whyNow: "Work is blocked and may require operator attention.",
        factors: ["task.updated", "waiting", "semantic blocking signal"],
        relationHints: [],
        confidence: "medium",
        reasons: ["status wording indicates work cannot continue yet"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          whyNow: "inferred",
          confidence: "inferred",
        },
      },
    },
    {
      intentFrame: "blocked_work",
      activityClass: "status_update",
      consequence: "medium",
      whyNow: "Work is blocked and may require operator attention.",
      factors: ["task.updated", "waiting", "semantic blocking signal"],
      relationHints: [],
      confidence: "medium",
      reasons: ["status wording indicates work cannot continue yet"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
      },
    },
  );

  assert.equal(diagnostic.blocking, "blocking");
  assert.equal(diagnostic.source, "inferred");
});
