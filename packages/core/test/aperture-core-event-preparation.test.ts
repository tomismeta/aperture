import assert from "node:assert/strict";
import test from "node:test";

import {
  preparePublishedEvent,
  preparePublishedSourceEvent,
} from "../src/aperture-core-event-preparation.js";

test("preparePublishedSourceEvent normalizes source events into finalized runtime events", () => {
  const prepared = preparePublishedSourceEvent({
    id: "evt:source",
    type: "human.input.requested",
    taskId: "task:source",
    interactionId: "interaction:source",
    timestamp: "2026-04-06T00:00:00.000Z",
    title: "Approve file read",
    summary: "Read src/index.ts before continuing.",
    request: { kind: "approval" },
    riskHint: "low",
  });

  assert.equal(prepared.transitionKind, "source_normalized");
  assert.equal(prepared.originalEvent.type, "human.input.requested");
  assert.equal(prepared.finalizedEvent.type, "human.input.requested");
  if (prepared.finalizedEvent.type !== "human.input.requested") {
    return;
  }

  assert.equal(prepared.finalizedEvent.consequence, "low");
  assert.equal(prepared.finalizedEvent.tone, "focused");
  assert.equal(prepared.finalizedEvent.semantic.toolFamily, "read");
});

test("preparePublishedEvent enriches direct events by default", () => {
  const prepared = preparePublishedEvent({
    id: "evt:direct",
    type: "human.input.requested",
    taskId: "task:direct",
    interactionId: "interaction:direct",
    timestamp: "2026-04-06T00:01:00.000Z",
    title: "Approve file read",
    summary: "Read src/index.ts before continuing.",
    request: { kind: "approval" },
  });

  assert.equal(prepared.transitionKind, "direct_enriched");
  assert.equal(prepared.finalizedEvent.type, "human.input.requested");
  if (prepared.finalizedEvent.type !== "human.input.requested") {
    return;
  }

  assert.equal(prepared.finalizedEvent.consequence, "low");
  assert.equal(prepared.finalizedEvent.semantic.toolFamily, "read");
});

test("preparePublishedEvent can preserve a direct event without semantic defaults", () => {
  const prepared = preparePublishedEvent({
    id: "evt:passthrough",
    type: "human.input.requested",
    taskId: "task:passthrough",
    interactionId: "interaction:passthrough",
    timestamp: "2026-04-06T00:02:00.000Z",
    title: "Approve file read",
    summary: "Read src/index.ts before continuing.",
    request: { kind: "approval" },
  }, {
    applySemanticDefaults: false,
  });

  assert.equal(prepared.transitionKind, "direct_passthrough");
  assert.equal(prepared.finalizedEvent.type, "human.input.requested");
  if (prepared.finalizedEvent.type !== "human.input.requested") {
    return;
  }

  assert.equal(prepared.finalizedEvent.semantic, undefined);
  assert.equal(prepared.finalizedEvent.consequence, undefined);
});
