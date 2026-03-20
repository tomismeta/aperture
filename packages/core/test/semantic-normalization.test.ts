import test from "node:test";
import assert from "node:assert/strict";

import {
  ApertureCore,
  type SourceEvent,
  type SourceRef,
} from "../src/index.js";
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

test("preserves factual task status updates without adapter-owned semantic drift", () => {
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
  assert.deepEqual(normalized, event);
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
