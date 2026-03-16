import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttentionFrame as Frame,
  AttentionSignalSummary as SignalSummary,
  AttentionState,
  AttentionView,
} from "@tomismeta/aperture-core";

import {
  handleActiveKeypress,
  describeResponse,
} from "../src/interaction.js";
import type { AttentionSurface, TuiState, FrameResponse } from "../src/types.js";
import { createAnimationState } from "../src/animation.js";

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Test frame",
    summary: "Test summary",
    timing: {
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<TuiState> = {}): TuiState {
  return {
    attentionView: { active: null, queued: [], ambient: [] },
    statusLine: "",
    inputDraft: null,
    expanded: false,
    whyMode: false,
    traceCache: new Map(),
    posture: "calm",
    previousPosture: "calm",
    animation: createAnimationState(),
    ...overrides,
  };
}

function makeSurface(submitted: FrameResponse[] = []): AttentionSurface {
  return {
    getAttentionView: () => ({ active: null, queued: [], ambient: [] }),
    getSignalSummary: () => ({} as SignalSummary),
    getAttentionState: () => "calm" as AttentionState,
    subscribeAttentionView: () => () => {},
    onResponse: () => () => {},
    submit: (response: FrameResponse) => submitted.push(response),
  };
}

// ── handleActiveKeypress ──────────────────────────────────────────

test("handleActiveKeypress submits approved on 'a' for approval frame", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame();

  handleActiveKeypress(surface, state, frame, { name: "a" });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.response.kind, "approved");
});

test("handleActiveKeypress submits rejected on 'r' for approval frame", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame();

  handleActiveKeypress(surface, state, frame, { name: "r" });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.response.kind, "rejected");
});

test("handleActiveKeypress submits dismissed on 'x' for approval frame", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame();

  handleActiveKeypress(surface, state, frame, { name: "x" });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.response.kind, "dismissed");
});

test("handleActiveKeypress submits acknowledged on 'return' for acknowledge frame", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({
    responseSpec: {
      kind: "acknowledge",
      actions: [{ id: "acknowledge", label: "Acknowledge", kind: "acknowledge", emphasis: "primary" }],
    },
  });

  handleActiveKeypress(surface, state, frame, { name: "return" });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.response.kind, "acknowledged");
});

test("handleActiveKeypress selects choice by digit key", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({
    responseSpec: {
      kind: "choice",
      options: [
        { id: "staging", label: "staging" },
        { id: "prod", label: "production" },
      ],
    },
  });

  handleActiveKeypress(surface, state, frame, { sequence: "2" });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.response.kind, "option_selected");
});

test("handleActiveKeypress does nothing for none responseSpec", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({ responseSpec: { kind: "none" } });

  handleActiveKeypress(surface, state, frame, { name: "a" });

  assert.equal(submitted.length, 0);
});

// ── describeResponse ──────────────────────────────────────────────

test("describeResponse returns label for simple responses", () => {
  const response: FrameResponse = {
    taskId: "t1",
    interactionId: "i1",
    response: { kind: "approved" },
  };

  assert.equal(describeResponse(response, null), "Approved");
});

test("describeResponse appends next active info when different", () => {
  const response: FrameResponse = {
    taskId: "t1",
    interactionId: "i1",
    response: { kind: "approved" },
  };

  const nextActive = makeFrame({ interactionId: "i2", title: "Next task" });
  const result = describeResponse(response, nextActive);

  assert.match(result, /Approved/);
  assert.match(result, /Next task/);
});
