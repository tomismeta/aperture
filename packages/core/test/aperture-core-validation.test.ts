import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidEvent,
  assertValidFrameResponse,
  assertValidSignal,
  assertValidSourceEvent,
} from "../src/aperture-core-validation.js";

test("assertValidEvent accepts a minimal valid direct event", () => {
  assert.doesNotThrow(() => {
    assertValidEvent({
      id: "evt:valid",
      type: "task.started",
      taskId: "task:valid",
      timestamp: "2026-04-06T00:03:00.000Z",
      title: "Started work",
    });
  });
});

test("assertValidSourceEvent rejects unsupported consequence hints", () => {
  assert.throws(() => {
    assertValidSourceEvent({
      id: "evt:invalid-risk",
      type: "human.input.requested",
      taskId: "task:invalid-risk",
      interactionId: "interaction:invalid-risk",
      timestamp: "2026-04-06T00:04:00.000Z",
      title: "Approve deploy",
      summary: "Approve the next step.",
      request: { kind: "approval" },
      riskHint: "severe" as never,
    });
  }, /event\.riskHint must be a valid consequence level/);
});

test("assertValidFrameResponse rejects empty option selections", () => {
  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:choice",
      interactionId: "interaction:choice",
      response: {
        kind: "option_selected",
        optionIds: [],
      },
    });
  }, /response\.optionIds must contain at least one option id/);
});

test("assertValidSignal rejects invalid timestamps", () => {
  assert.throws(() => {
    assertValidSignal({
      kind: "viewed",
      taskId: "task:signal",
      interactionId: "interaction:signal",
      timestamp: "not-a-timestamp",
    });
  }, /signal\.timestamp must be a valid ISO timestamp/);
});
