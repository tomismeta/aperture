import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidEvent,
  assertValidFrameResponse,
  assertValidSignal,
  assertValidSourceEvent,
} from "../src/aperture-core-validation.js";
import { ApertureCore } from "../src/aperture-core.js";
import {
  ApertureCoreValidationError,
  ApertureCoreResponseExpiredError,
} from "../src/aperture-core-error.js";
import type { HumanInputRequest } from "../src/events.js";
import type { AttentionResponse } from "../src/frame-response.js";

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

test("assertValidFrameResponse rejects unknown variants and undeclared fields", () => {
  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:unknown",
      interactionId: "interaction:unknown",
      response: { kind: "bogus" },
    } as never);
  }, /response\.response must have a supported kind/);

  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:extra",
      interactionId: "interaction:extra",
      response: { kind: "approved", extra: true },
    } as never);
  }, /response\.response contains undeclared fields/);

  assert.throws(() => {
    assertValidFrameResponse({
      taskId: "task:extra-top-level",
      interactionId: "interaction:extra-top-level",
      response: { kind: "dismissed" },
      extra: true,
    } as never);
  }, /response contains undeclared fields/);
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

test("submit rejects frame-incompatible answers before changing state or notifying listeners", () => {
  const cases: Array<{
    request: HumanInputRequest;
    invalid: AttentionResponse["response"][];
    valid: AttentionResponse["response"];
  }> = [
    {
      request: { kind: "approval", requireReason: true },
      invalid: [
        { kind: "acknowledged" },
        { kind: "approved" },
        { kind: "rejected", reason: " " },
        { kind: "text_submitted", text: "yes" },
      ],
      valid: { kind: "approved", reason: "Reviewed" },
    },
    {
      request: {
        kind: "choice",
        selectionMode: "single",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      invalid: [
        { kind: "approved" },
        { kind: "option_selected", optionIds: ["unknown"] },
        { kind: "option_selected", optionIds: ["a", "b"] },
        { kind: "option_selected", optionIds: ["a", "a"] },
        { kind: "text_submitted", text: "custom" },
      ],
      valid: { kind: "option_selected", optionIds: ["a"] },
    },
    {
      request: {
        kind: "form",
        fields: [
          { id: "name", label: "Name", type: "text", required: true },
          { id: "count", label: "Count", type: "number", required: true },
          { id: "enabled", label: "Enabled", type: "boolean", required: true },
          {
            id: "target",
            label: "Target",
            type: "select",
            options: [{ value: "dev", label: "Dev" }],
            required: true,
          },
        ],
      },
      invalid: [
        { kind: "acknowledged" },
        { kind: "text_submitted", text: "name" },
        ...[
          {},
          { name: " ", count: 1, enabled: true, target: "dev" },
          { name: "Name", count: "1", enabled: true, target: "dev" },
          { name: "Name", count: Number.NaN, enabled: true, target: "dev" },
          { name: "Name", count: 1, enabled: "true", target: "dev" },
          { name: "Name", count: 1, enabled: true, target: "prod" },
          { name: "Name", count: 1, enabled: true, target: "dev", surprise: true },
        ].map((values): AttentionResponse["response"] => ({ kind: "form_submitted", values })),
      ],
      valid: {
        kind: "form_submitted",
        values: { name: "Name", count: 0, enabled: false, target: "dev" },
      },
    },
  ];
  for (const { request, invalid, valid } of cases) {
    const core = responseCore(request);
    core.engage("task:response", "interaction:response");
    const view = core.getAttentionView();
    const signals = core.getSignals();
    let emissions = 0;
    const unsubscribers = [
      core.subscribe("task:response", () => {
        emissions += 1;
      }),
      core.subscribeTaskView("task:response", () => {
        emissions += 1;
      }),
      core.subscribeAttentionView(() => {
        emissions += 1;
      }),
      core.onSignal(() => {
        emissions += 1;
      }),
      core.onResponse(() => {
        emissions += 1;
      }),
    ];
    emissions = 0;
    for (const response of invalid) {
      assert.throws(
        () =>
          core.submit({ taskId: "task:response", interactionId: "interaction:response", response }),
        ApertureCoreValidationError,
      );
      assert.deepEqual(core.getAttentionView(), view);
      assert.deepEqual(core.getSignals(), signals);
      assert.equal(emissions, 0);
    }
    core.submit({
      taskId: "task:response",
      interactionId: "interaction:response",
      response: valid,
    });
    assert.equal(core.getFrame("task:response"), null);
    assert.ok(emissions > 0);
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
});

test("submit preserves explicit text, multi-select, dismissal and missing-interaction contracts", () => {
  const cases: Array<{ request: HumanInputRequest; response: AttentionResponse["response"] }> = [
    { request: { kind: "approval", requireReason: true }, response: { kind: "dismissed" } },
    {
      request: {
        kind: "choice",
        selectionMode: "single",
        allowTextResponse: true,
        options: [{ id: "a", label: "A" }],
      },
      response: { kind: "text_submitted", text: "custom" },
    },
    {
      request: {
        kind: "choice",
        selectionMode: "multiple",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      response: { kind: "option_selected", optionIds: ["a", "b"] },
    },
    {
      request: {
        kind: "form",
        fields: [{ id: "text", label: "Text", type: "textarea", required: true }],
      },
      response: { kind: "text_submitted", text: "answer" },
    },
    {
      request: { kind: "form", fields: [{ id: "count", label: "Count", type: "number" }] },
      response: { kind: "form_submitted", values: {} },
    },
  ];
  for (const { request, response } of cases) {
    const core = responseCore(request);
    const responses: AttentionResponse[] = [];
    core.onResponse((answer) => responses.push(answer));
    core.submit({
      taskId: "task:response",
      interactionId: "missing",
      response: { kind: "approved" },
    });
    assert.equal(responses.length, 0);
    core.submit({ taskId: "task:response", interactionId: "interaction:response", response });
    assert.equal(responses.length, 1);
    assert.equal(core.getFrame("task:response"), null);
  }
});

test("expired responses retain the frame and feedback even when the response kind matches", () => {
  let now = Date.parse("2026-04-06T00:00:00.000Z");
  const core = responseCore({ kind: "approval" }, { timeSource: () => now, responseExpiryMs: 100 });
  const view = core.getAttentionView();
  const signals = core.getSignals();
  now += 101;
  assert.throws(
    () =>
      core.submit({
        taskId: "task:response",
        interactionId: "interaction:response",
        response: { kind: "approved" },
      }),
    ApertureCoreResponseExpiredError,
  );
  assert.deepEqual(core.getAttentionView(), view);
  assert.deepEqual(core.getSignals(), signals);
});

function responseCore(
  request: HumanInputRequest,
  options: { timeSource?: () => number; responseExpiryMs?: number } = {},
): ApertureCore {
  const core = new ApertureCore(options);
  core.publish({
    id: "evt:response",
    type: "human.input.requested",
    taskId: "task:response",
    interactionId: "interaction:response",
    timestamp: "2026-04-06T00:00:00.000Z",
    title: "Human input",
    summary: "Review this request.",
    request,
  });
  return core;
}
