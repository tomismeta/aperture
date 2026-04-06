import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionResponse } from "../src/frame-response.js";
import type { AttentionFrame, AttentionView } from "../src/frame.js";

import {
  buildAttentionTransitionSignals,
  buildAutoResponseSignal,
  buildDeferredSignal,
  buildObservationSignal,
  buildResponseSignal,
} from "../src/aperture-core-signals.js";

function makeFrame(overrides: Partial<AttentionFrame> = {}): AttentionFrame {
  return {
    id: "frame:1",
    taskId: "task:1",
    interactionId: "interaction:1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve change",
    responseSpec: {
      kind: "approval",
      actions: [{ id: "approve", label: "Approve", kind: "approve", emphasis: "primary" }],
    },
    timing: {
      createdAt: "2026-04-06T15:00:00.000Z",
      updatedAt: "2026-04-06T15:00:00.000Z",
    },
    ...overrides,
  };
}

function makeView(overrides: Partial<AttentionView> = {}): AttentionView {
  return {
    now: null,
    next: [],
    ambient: [],
    ...overrides,
  };
}

test("buildResponseSignal records dismissals distinctly with latency", () => {
  const frame = makeFrame();
  const response: AttentionResponse = {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "dismissed" },
  };

  const signal = buildResponseSignal(frame, response, "2026-04-06T15:00:05.000Z");

  assert.equal(signal.kind, "dismissed");
  if (signal.kind === "dismissed") {
    assert.equal(signal.latencyMs, 5000);
  }
});

test("buildAutoResponseSignal marks auto-resolved candidate responses", () => {
  const signal = buildAutoResponseSignal({
    taskId: "task:auto",
    interactionId: "interaction:auto",
    mode: "approval",
    tone: "focused",
    consequence: "high",
    title: "Approve auto change",
    judgmentInput: {
      ontology: {
        ask: "approval",
        activity: "decision_request",
        consequence: "high",
        blocking: "blocking",
        episode: "new",
        confidence: "high",
        source: "explicit",
      },
      semanticEvidence: {
        confidence: "high",
        source: "explicit",
        strength: "strong",
        abstained: false,
      },
      blockedLikeStatus: false,
      relationEvidence: null,
    },
    responseSpec: {
      kind: "approval",
      actions: [{ id: "approve", label: "Approve", kind: "approve", emphasis: "primary" }],
    },
    priority: "high",
    blocking: true,
    timestamp: "2026-04-06T15:00:00.000Z",
  }, {
    taskId: "task:auto",
    interactionId: "interaction:auto",
    response: { kind: "dismissed" },
  }, "2026-04-06T15:00:01.000Z");

  assert.equal(signal.kind, "responded");
  if (signal.kind === "responded") {
    assert.equal(signal.responseKind, "acknowledged");
    assert.equal(signal.metadata?.autoResolved, true);
  }
});

test("buildDeferredSignal preserves source interaction metadata", () => {
  const frame = makeFrame({
    timing: {
      createdAt: "2026-04-06T15:00:00.000Z",
      updatedAt: "2026-04-06T15:00:03.000Z",
    },
  });

  const signal = buildDeferredSignal(frame, "next");

  assert.equal(signal.kind, "deferred");
  if (signal.kind === "deferred") {
    assert.equal(signal.reason, "next");
    assert.equal(signal.timestamp, "2026-04-06T15:00:03.000Z");
  }
});

test("buildAttentionTransitionSignals records cross-task shifts and returns", () => {
  const previous = makeFrame({
    id: "frame:previous",
    taskId: "task:previous",
    interactionId: "interaction:previous",
  });
  const next = makeFrame({
    id: "frame:next",
    taskId: "task:next",
    interactionId: "interaction:next",
  });

  const signals = buildAttentionTransitionSignals(
    makeView({ now: previous, next: [next] }),
    makeView({ now: next }),
    "2026-04-06T15:01:00.000Z",
  );

  assert.deepEqual(signals.map((signal) => signal.kind), [
    "attention_shifted",
    "attention_shifted",
    "returned",
  ]);
  assert.equal(signals[2]?.kind, "returned");
  if (signals[2]?.kind === "returned") {
    assert.equal(signals[2].from, "next");
  }
});

test("buildObservationSignal carries surface and section metadata", () => {
  const signal = buildObservationSignal(
    "context_expanded",
    "task:view",
    "interaction:view",
    "2026-04-06T15:02:00.000Z",
    makeFrame(),
    { surface: "lab", section: "provenance" },
  );

  assert.equal(signal.kind, "context_expanded");
  if (signal.kind === "context_expanded") {
    assert.equal(signal.surface, "lab");
    assert.equal(signal.section, "provenance");
  }
});
