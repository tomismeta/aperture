import test from "node:test";
import assert from "node:assert/strict";

import {
  ApertureCore,
  type SourceEvent,
  type SourceRef,
} from "../src/index.js";
import { interpretSourceEvent } from "../src/semantic-interpreter.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";

const timestamp = "2026-03-10T12:00:00.000Z";

function source(id: string): SourceRef {
  return { id };
}

test("normalizes high-risk human input into critical approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("claude-code"),
    title: "Approve Bash command",
    summary: "git push --force origin main",
    request: { kind: "approval" },
    riskHint: "high",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "critical");
    assert.equal(normalized.consequence, "high");
  }
});

test("normalizes medium-risk human input into focused approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("codex"),
    title: "Approve command",
    summary: "git push origin main",
    request: { kind: "approval" },
    riskHint: "medium",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "medium");
  }
});

test("normalizes low-risk human input into focused low-consequence approval semantics", () => {
  const event: SourceEvent = {
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("claude-code"),
    title: "Approve read",
    summary: "Read src/index.ts",
    request: { kind: "approval" },
    riskHint: "low",
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "low");
  }
});

test("uses medium consequence by default when no risk hint is provided", () => {
  const event: SourceEvent = {
    id: "evt:choice",
    type: "human.input.requested",
    taskId: "task:1",
    interactionId: "interaction:1",
    timestamp,
    source: source("custom-agent"),
    title: "Choose environment",
    summary: "Select a deployment target",
    request: {
      kind: "choice",
      options: [
        { id: "prod", label: "Production" },
        { id: "staging", label: "Staging" },
      ],
    },
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type === "human.input.requested") {
    assert.equal(normalized.tone, "focused");
    assert.equal(normalized.consequence, "medium");
  }
});

test("semantic interpreter infers high-risk approval semantics from dangerous text", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:danger",
    type: "human.input.requested",
    taskId: "task:danger",
    interactionId: "interaction:danger",
    timestamp,
    source: source("custom-agent"),
    title: "Approve production cleanup",
    summary: "Run rm -rf on production cache before deploy",
    request: { kind: "approval" },
  });

  assert.equal(interpretation.intentFrame, "approval_request");
  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.requestExplicitness, "explicit");
});

test("explicit semantic hints override inferred semantics", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:hinted",
    type: "human.input.requested",
    taskId: "task:hinted",
    interactionId: "interaction:hinted",
    timestamp,
    source: source("custom-agent"),
    title: "Approve read",
    summary: "Read a file in the repo",
    request: { kind: "approval" },
    semanticHints: {
      consequence: "high",
      whyNow: "A policy escalation requires senior review.",
      reasons: ["adapter provided a trusted escalation hint"],
    },
  });

  assert.equal(interpretation.consequence, "high");
  assert.equal(interpretation.whyNow, "A policy escalation requires senior review.");
  assert.ok(interpretation.reasons.includes("adapter provided a trusted escalation hint"));
});

test("normalizes task status updates with semantic enrichment instead of raw passthrough", () => {
  const event: SourceEvent = {
    id: "evt:failed",
    type: "task.updated",
    taskId: "task:run:1",
    timestamp,
    source: source("custom-agent"),
    title: "Run failed",
    summary: "Migration failed in staging",
    status: "failed",
    progress: 82,
  };

  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, event.type);
  if (normalized.type === "task.updated") {
    assert.equal(normalized.activityClass, "tool_failure");
    assert.equal(normalized.semantic?.intentFrame, "failure");
    assert.equal(normalized.semantic?.consequence, "high");
    assert.equal(normalized.semantic?.operatorActionRequired, true);
  }
});

test("task updates can infer implied operator asks from status text", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:blocked",
    type: "task.updated",
    taskId: "task:blocked",
    timestamp,
    source: source("custom-agent"),
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue",
    status: "waiting",
  });

  assert.equal(normalized.type, "task.updated");
  if (normalized.type === "task.updated") {
    assert.equal(normalized.semantic?.requestExplicitness, "implied");
    assert.equal(normalized.semantic?.operatorActionRequired, true);
  }
});

test("negated approval wording does not invent an implied operator ask", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:no-approval-needed",
    type: "task.updated",
    taskId: "task:no-approval-needed",
    timestamp,
    source: source("custom-agent"),
    title: "Continuing automatically",
    summary: "No approval needed, continuing automatically.",
    status: "running",
  });

  assert.equal(interpretation.requestExplicitness, "none");
  assert.equal(interpretation.operatorActionRequired, false);
});

test("task updates can infer relation hints from recurring and resolving language", () => {
  const repeated = interpretSourceEvent({
    id: "evt:repeat",
    type: "task.updated",
    taskId: "task:repeat",
    timestamp,
    source: source("custom-agent"),
    title: "Build failed again",
    summary: "The same build is still failing in production",
    status: "failed",
  });

  const resolved = interpretSourceEvent({
    id: "evt:resolved",
    type: "task.updated",
    taskId: "task:repeat",
    timestamp,
    source: source("custom-agent"),
    title: "Build issue resolved",
    summary: "The deploy is fixed and no longer blocked",
    status: "completed",
  });

  assert.deepEqual(repeated.relationHints.map((hint) => hint.kind), ["same_issue", "repeats"]);
  assert.deepEqual(resolved.relationHints.map((hint) => hint.kind), ["same_issue", "resolves"]);
});

test("passive dramatic status does not infer repeat relations from wording alone", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:dramatic-passive",
    type: "task.updated",
    taskId: "task:dramatic-passive",
    timestamp,
    source: source("custom-agent"),
    title: "Critical path still running",
    summary: "Critical path still running, no action needed.",
    status: "running",
  });

  assert.deepEqual(interpretation.relationHints, []);
});

test("read-oriented approvals mentioning production stay low consequence", () => {
  const interpretation = interpretSourceEvent({
    id: "evt:prod-read",
    type: "human.input.requested",
    taskId: "task:prod-read",
    interactionId: "interaction:prod-read",
    timestamp,
    source: source("custom-agent"),
    title: "Approve production runbook read",
    summary: "Read the production deploy runbook before answering.",
    request: { kind: "approval" },
    toolFamily: "read",
  });

  assert.equal(interpretation.toolFamily, "read");
  assert.equal(interpretation.consequence, "low");
});

test("equivalent source approvals normalize to equivalent semantics across sources", () => {
  const sources = [source("claude-code"), source("codex"), source("opencode")];

  const normalized = sources.map((src, index) =>
    normalizeSourceEvent({
      id: `evt:${index}`,
      type: "human.input.requested",
      taskId: `task:${index}`,
      interactionId: `interaction:${index}`,
      timestamp,
      source: src,
      title: "Approve operation",
      summary: "The source requested approval.",
      request: { kind: "approval" },
      riskHint: "high",
    }),
  );

  for (const event of normalized) {
    assert.equal(event.type, "human.input.requested");
    if (event.type === "human.input.requested") {
      assert.equal(event.tone, "critical");
      assert.equal(event.consequence, "high");
      assert.equal(event.request.kind, "approval");
    }
  }
});

test("publishSourceEvent feeds normalized events into the existing attention engine", () => {
  const core = new ApertureCore();

  core.publishSourceEvent({
    id: "evt:approval",
    type: "human.input.requested",
    taskId: "task:deploy",
    interactionId: "interaction:deploy",
    timestamp,
    source: source("claude-code"),
    title: "Approve deploy",
    summary: "A risky deploy is waiting.",
    request: { kind: "approval" },
    riskHint: "high",
  });

  const frame = core.getFrame("task:deploy");
  assert.ok(frame);
  assert.equal(frame?.mode, "approval");
  assert.equal(frame?.tone, "critical");
  assert.equal(frame?.consequence, "high");
  assert.equal(frame?.responseSpec.kind, "approval");
});

test("publishSourceEvent can use the semantic layer to elevate dangerous approvals without an explicit risk hint", () => {
  const core = new ApertureCore();

  core.publishSourceEvent({
    id: "evt:destructive",
    type: "human.input.requested",
    taskId: "task:cleanup",
    interactionId: "interaction:cleanup",
    timestamp,
    source: source("claude-code"),
    title: "Approve production cleanup",
    summary: "Run rm -rf on production cache before deploy",
    request: { kind: "approval" },
  });

  const frame = core.getFrame("task:cleanup");
  assert.ok(frame);
  assert.equal(frame?.mode, "approval");
  assert.equal(frame?.tone, "critical");
  assert.equal(frame?.consequence, "high");
});
