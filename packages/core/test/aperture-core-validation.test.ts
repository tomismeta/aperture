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

test("assertValidSourceEvent rejects non-object metadata", () => {
  assert.throws(() => {
    assertValidSourceEvent({
      id: "evt:invalid-metadata",
      type: "task.started",
      taskId: "task:invalid-metadata",
      timestamp: "2026-04-06T00:05:00.000Z",
      title: "Started work",
      metadata: [] as never,
    });
  }, /event\.metadata must be an object/);
});

test("source evidence is bounded to failed task updates", () => {
  assert.throws(() => {
    assertValidSourceEvent({
      id: "evt:evidence-running",
      type: "task.updated",
      taskId: "task:evidence-running",
      timestamp: "2026-04-06T00:05:00.000Z",
      title: "Running",
      status: "running",
      evidence: {
        kind: "payload",
        subject: "search",
        channel: "search",
        complete: true,
      },
    });
  }, /event\.evidence must be valid bounded source evidence/);
});

test("source evidence rejects invalid variants and undeclared fields", () => {
  for (const evidence of [
    {
      kind: "diagnostic",
      diagnostic: "source_limit",
      channel: "read",
      window: { unit: "bytes", offset: 0, length: 100, total: 100 },
    },
    {
      kind: "authorization",
      state: "required",
      execution: "started",
      result: "absent",
    },
    {
      kind: "payload",
      subject: "search",
      channel: "search",
      complete: true,
      judgment: "ambient",
    },
  ]) {
    assert.throws(() => {
      assertValidSourceEvent({
        id: "evt:evidence-invalid",
        type: "task.updated",
        taskId: "task:evidence-invalid",
        timestamp: "2026-04-06T00:05:00.000Z",
        title: "Failed",
        status: "failed",
        evidence: evidence as never,
      });
    }, /event\.evidence(?:\.window)? must be valid bounded source evidence/);
  }
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

test("assertValidFrameResponse rejects malformed answer fields", () => {
  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:choice",
      interactionId: "interaction:choice",
      response: { kind: "option_selected", optionIds: ["   "] },
    });
  }, /response\.optionIds\[\] must be a non-empty string/);

  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:text",
      interactionId: "interaction:text",
      response: { kind: "text_submitted", text: "   " },
    });
  }, /response\.text must be a non-empty string/);

  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:approval",
      interactionId: "interaction:approval",
      response: { kind: "approved", reason: 42 } as never,
    });
  }, /response\.reason must be a string/);
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
