import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttentionFrame as Frame,
} from "@tomismeta/aperture-core";
import type { AttentionSignalSummary as SignalSummary } from "../../core/src/signal-summary.js";
import type { AttentionState } from "../../core/src/attention-state.js";

import {
  handleActiveKeypress,
  handleInputKeypress,
  describeResponse,
  createAutomaticInputDraft,
  shouldReserveSpaceForExpand,
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
    attentionView: { now: null, next: [], ambient: [] },
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
    getAttentionView: () => ({ now: null, next: [], ambient: [] }),
    getSignalSummary: () => ({} as SignalSummary),
    getAttentionState: () => "calm" as AttentionState,
    subscribeAttentionView: () => () => {},
    onResponse: () => () => {},
    engage: () => {},
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

test("handleActiveKeypress opens a multi-select draft instead of submitting immediately", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({
    responseSpec: {
      kind: "choice",
      selectionMode: "multiple",
      options: [
        { id: "tests", label: "tests" },
        { id: "docs", label: "docs" },
      ],
      actions: [{ id: "submit", label: "Submit", kind: "submit", emphasis: "primary" }],
    },
  });

  handleActiveKeypress(surface, state, frame, { sequence: "2" });

  assert.equal(submitted.length, 0);
  assert.deepEqual(state.inputDraft, {
    kind: "choice",
    interactionId: "interaction-1",
    optionIds: ["docs"],
  });
});

test("handleActiveKeypress opens text replies with shared editing language", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({
    title: "Explain why this deploy is safe",
    responseSpec: {
      kind: "choice",
      allowTextResponse: true,
      options: [{ id: "approve", label: "Approve" }],
    },
  });

  handleActiveKeypress(surface, state, frame, { name: "i" });

  assert.equal(state.inputDraft?.kind, "text");
  assert.equal(state.statusLine, "Editing reply");
});

test("handleActiveKeypress does nothing for none responseSpec", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const state = makeState();
  const frame = makeFrame({ responseSpec: { kind: "none" } });

  handleActiveKeypress(surface, state, frame, { name: "a" });

  assert.equal(submitted.length, 0);
});

test("createAutomaticInputDraft auto-opens form responses", () => {
  const frame = makeFrame({
    responseSpec: {
      kind: "form",
      fields: [
        { id: "reply", label: "Reply", type: "textarea" },
      ],
    },
  });

  const draft = createAutomaticInputDraft(frame);

  assert.deepEqual(draft, {
    kind: "form",
    interactionId: "interaction-1",
    fieldIndex: 0,
    values: {},
    buffer: "",
  });
});

test("createAutomaticInputDraft auto-opens multiple-choice responses", () => {
  const frame = makeFrame({
    responseSpec: {
      kind: "choice",
      selectionMode: "multiple",
      options: [
        { id: "tests", label: "tests" },
        { id: "docs", label: "docs" },
      ],
      actions: [{ id: "submit", label: "Submit", kind: "submit", emphasis: "primary" }],
    },
  });

  const draft = createAutomaticInputDraft(frame);

  assert.deepEqual(draft, {
    kind: "choice",
    interactionId: "interaction-1",
    optionIds: [],
  });
});

test("createAutomaticInputDraft does not auto-open approvals", () => {
  const frame = makeFrame();

  const draft = createAutomaticInputDraft(frame);

  assert.equal(draft, null);
});

test("shouldReserveSpaceForExpand keeps space global for empty drafts", () => {
  assert.equal(shouldReserveSpaceForExpand({
    kind: "choice",
    interactionId: "interaction-1",
    optionIds: [],
  }), true);

  assert.equal(shouldReserveSpaceForExpand({
    kind: "form",
    interactionId: "interaction-1",
    fieldIndex: 0,
    values: {},
    buffer: "",
  }), true);

  assert.equal(shouldReserveSpaceForExpand({
    kind: "text",
    interactionId: "interaction-1",
    buffer: "",
  }), true);
});

test("shouldReserveSpaceForExpand releases space after typing starts", () => {
  assert.equal(shouldReserveSpaceForExpand({
    kind: "choice",
    interactionId: "interaction-1",
    optionIds: ["docs"],
  }), true);

  assert.equal(shouldReserveSpaceForExpand({
    kind: "form",
    interactionId: "interaction-1",
    fieldIndex: 0,
    values: {},
    buffer: "hello",
  }), false);

  assert.equal(shouldReserveSpaceForExpand({
    kind: "text",
    interactionId: "interaction-1",
    buffer: "hello",
  }), false);
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

test("handleInputKeypress keeps reply validation language calm and direct", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const active = makeFrame({
    responseSpec: {
      kind: "choice",
      allowTextResponse: true,
      options: [{ id: "approve", label: "Approve" }],
    },
  });
  const state = makeState({
    attentionView: { now: active, next: [], ambient: [] },
    inputDraft: { kind: "text", interactionId: active.interactionId, buffer: "" },
  });

  handleInputKeypress(surface, state, { name: "return" });

  assert.equal(state.statusLine, "Enter a reply before sending");
  assert.equal(submitted.length, 0);
});

test("handleInputKeypress toggles and submits multiple-choice selections", () => {
  const submitted: FrameResponse[] = [];
  const surface = makeSurface(submitted);
  const active = makeFrame({
    responseSpec: {
      kind: "choice",
      selectionMode: "multiple",
      options: [
        { id: "tests", label: "tests" },
        { id: "docs", label: "docs" },
        { id: "runtime", label: "runtime" },
      ],
      actions: [{ id: "submit", label: "Submit", kind: "submit", emphasis: "primary" }],
    },
  });
  const state = makeState({
    attentionView: { now: active, next: [], ambient: [] },
    inputDraft: { kind: "choice", interactionId: active.interactionId, optionIds: [] },
  });

  handleInputKeypress(surface, state, { sequence: "3" });
  handleInputKeypress(surface, state, { sequence: "1" });
  handleInputKeypress(surface, state, { name: "return" });

  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0], {
    taskId: "task-1",
    interactionId: "interaction-1",
    response: {
      kind: "option_selected",
      optionIds: ["tests", "runtime"],
    },
  });
});

test("describeResponse uses concise sent language for freeform and form replies", () => {
  const replyResponse: FrameResponse = {
    taskId: "t1",
    interactionId: "i1",
    response: { kind: "text_submitted", text: "Ship it." },
  };
  const formResponse: FrameResponse = {
    taskId: "t1",
    interactionId: "i1",
    response: { kind: "form_submitted", values: { reason: "Looks good" } },
  };

  assert.equal(describeResponse(replyResponse, null), "Sent reply");
  assert.equal(describeResponse(formResponse, null), "Sent form");
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
