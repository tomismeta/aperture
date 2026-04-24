import assert from "node:assert/strict";
import test from "node:test";

import { enrichApertureEvent, normalizeSourceEvent } from "../src/semantic-normalizer.js";

const timestamp = "2026-04-05T22:00:00.000Z";

test("source normalization and direct enrichment share human-input semantic defaults", () => {
  const sourceEvent = {
    id: "evt:source-approval",
    type: "human.input.requested" as const,
    taskId: "task:approval",
    interactionId: "interaction:approval",
    timestamp,
    source: { id: "custom-agent" },
    title: "Approve file read",
    summary: "Read src/index.ts before continuing.",
    request: { kind: "approval" as const },
    riskHint: "low" as const,
  };

  const directEvent = {
    id: sourceEvent.id,
    type: sourceEvent.type,
    taskId: sourceEvent.taskId,
    interactionId: sourceEvent.interactionId,
    timestamp: sourceEvent.timestamp,
    source: sourceEvent.source,
    title: sourceEvent.title,
    summary: sourceEvent.summary,
    request: sourceEvent.request,
    consequence: "low" as const,
  };

  assert.deepEqual(enrichApertureEvent(directEvent), normalizeSourceEvent(sourceEvent));
});

test("source normalization and direct enrichment share task-update semantic defaults", () => {
  const sourceEvent = {
    id: "evt:source-status",
    type: "task.updated" as const,
    taskId: "task:status",
    timestamp,
    source: { id: "custom-agent" },
    title: "Waiting for approval",
    summary: "Waiting for approval before the deploy can continue.",
    status: "waiting" as const,
  };

  const directEvent = {
    id: sourceEvent.id,
    type: sourceEvent.type,
    taskId: sourceEvent.taskId,
    timestamp: sourceEvent.timestamp,
    source: sourceEvent.source,
    title: sourceEvent.title,
    summary: sourceEvent.summary,
    status: sourceEvent.status,
  };

  assert.deepEqual(enrichApertureEvent(directEvent), normalizeSourceEvent(sourceEvent));
});

test("source normalization preserves adapter metadata for downstream review surfaces", () => {
  const sourceEvent = {
    id: "evt:source-background",
    type: "task.updated" as const,
    taskId: "task:background",
    timestamp,
    title: "Nightly maintenance",
    summary: "Waiting for approval before continuing.",
    status: "waiting" as const,
    metadata: {
      automation: {
        runMode: "scheduled",
        trigger: "schedule",
      },
      governance: {
        policyId: "policy:nightly-maintenance",
        approvalState: "pending",
      },
    },
  };

  const normalized = normalizeSourceEvent(sourceEvent);
  assert.deepEqual(normalized.metadata, sourceEvent.metadata);
});
