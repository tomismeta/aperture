import test from "node:test";
import assert from "node:assert/strict";

import { buildAttentionView } from "../src/attention-view.js";
import type { AttentionState } from "../src/attention-state.js";
import type { Frame, TaskView } from "../src/frame.js";

function createFrame(overrides: Partial<Frame> = {}): Frame {
  const interactionId = overrides.interactionId ?? "interaction:test";
  const taskId = overrides.taskId ?? "task:test";

  return {
    id: overrides.id ?? `frame:${interactionId}`,
    taskId,
    interactionId,
    version: 1,
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Background update",
    responseSpec: { kind: "none" },
    timing: {
      createdAt: overrides.timing?.createdAt ?? "2026-03-09T12:00:00.000Z",
      updatedAt: overrides.timing?.updatedAt ?? "2026-03-09T12:00:00.000Z",
    },
    ...overrides,
  };
}

function createTaskView(overrides: Partial<TaskView> = {}): TaskView {
  return {
    active: null,
    queued: [],
    ambient: [],
    ...overrides,
  };
}

test("global attention prefers blocking work over non-blocking status", () => {
  const approval = createFrame({
    taskId: "task:approval",
    interactionId: "interaction:approval",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve deploy",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
  });
  const failed = createFrame({
    taskId: "task:failed",
    interactionId: "interaction:failed",
    tone: "critical",
    consequence: "high",
    title: "Deploy failed",
  });

  const attentionView = buildAttentionView([
    createTaskView({ active: failed }),
    createTaskView({ active: approval }),
  ]);

  assert.equal(attentionView.active?.interactionId, "interaction:approval");
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:failed");
});

test("global attention uses persisted attention offsets to order similar status frames", () => {
  const quiet = createFrame({
    taskId: "task:quiet",
    interactionId: "interaction:quiet",
    tone: "focused",
    consequence: "medium",
    title: "Quiet status",
    metadata: {
      attention: {
        scoreOffset: -25,
        rationale: ["recent task activity suggests attention is already saturated"],
      },
    },
  });
  const sticky = createFrame({
    taskId: "task:sticky",
    interactionId: "interaction:sticky",
    tone: "focused",
    consequence: "medium",
    title: "Sticky status",
    metadata: {
      attention: {
        scoreOffset: 5,
        rationale: ["this task often requires deeper context before action"],
      },
    },
  });

  const attentionView = buildAttentionView([
    createTaskView({ active: quiet }),
    createTaskView({ active: sticky }),
  ]);

  assert.equal(attentionView.active?.interactionId, "interaction:sticky");
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:quiet");
});

test("global attention can leave low-value ambient work unfocused when it has been quieted below zero", () => {
  const quiet = createFrame({
    taskId: "task:quiet",
    interactionId: "interaction:quiet",
    title: "Quiet status",
    metadata: {
      attention: {
        scoreOffset: -5,
        rationale: ["overall operator activity suggests attention is already saturated"],
      },
    },
  });

  const attentionView = buildAttentionView([createTaskView({ active: quiet })]);

  assert.equal(attentionView.active, null);
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:quiet");
});

test("global overload keeps medium ambient status out of focus", () => {
  const blocked = createFrame({
    taskId: "task:blocked",
    interactionId: "interaction:blocked",
    tone: "focused",
    consequence: "medium",
    title: "Blocked follow-up",
  });

  const attentionView = buildAttentionView(
    [createTaskView({ active: blocked })],
    { globalAttentionState: "overloaded" satisfies AttentionState },
  );

  assert.equal(attentionView.active, null);
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:blocked");
});

test("global overload still allows critical ambient status to take focus", () => {
  const failed = createFrame({
    taskId: "task:failed",
    interactionId: "interaction:failed",
    tone: "critical",
    consequence: "high",
    title: "Critical failure",
    metadata: {
      attention: {
        score: 242,
        scoreOffset: 20,
        rationale: ["high-consequence status should remain more visible"],
      },
    },
  });

  const attentionView = buildAttentionView(
    [createTaskView({ active: failed })],
    { globalAttentionState: "overloaded" satisfies AttentionState },
  );

  assert.equal(attentionView.active?.interactionId, "interaction:failed");
});
