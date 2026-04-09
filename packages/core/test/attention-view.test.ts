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
    now: null,
    next: [],
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
    createTaskView({ now: failed }),
    createTaskView({ now: approval }),
  ]);

  assert.equal(attentionView.now?.interactionId, "interaction:approval");
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
    createTaskView({ now: quiet }),
    createTaskView({ now: sticky }),
  ]);

  assert.equal(attentionView.now?.interactionId, "interaction:sticky");
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

  const attentionView = buildAttentionView([createTaskView({ now: quiet })]);

  assert.equal(attentionView.now, null);
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:quiet");
});

test("global attention leaves score-zero ambient work unfocused", () => {
  const quiet = createFrame({
    taskId: "task:zero",
    interactionId: "interaction:zero",
    title: "Completed successfully",
  });

  const attentionView = buildAttentionView([createTaskView({ now: quiet })]);

  assert.equal(attentionView.now, null);
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:zero");
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
    [createTaskView({ now: blocked })],
    { globalAttentionState: "overloaded" satisfies AttentionState },
  );

  assert.equal(attentionView.now, null);
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
    [createTaskView({ now: failed })],
    { globalAttentionState: "overloaded" satisfies AttentionState },
  );

  assert.equal(attentionView.now?.interactionId, "interaction:failed");
});

test("newer focused work outranks stale focused work when base scores match", () => {
  const stale = createFrame({
    taskId: "task:stale",
    interactionId: "interaction:stale",
    tone: "focused",
    consequence: "medium",
    title: "Stale blocked follow-up",
    timing: {
      createdAt: "2026-03-09T08:00:00.000Z",
      updatedAt: "2026-03-09T08:00:00.000Z",
    },
  });
  const fresh = createFrame({
    taskId: "task:fresh",
    interactionId: "interaction:fresh",
    tone: "focused",
    consequence: "medium",
    title: "Fresh blocked follow-up",
    timing: {
      createdAt: "2026-03-09T12:25:00.000Z",
      updatedAt: "2026-03-09T12:25:00.000Z",
    },
  });

  const attentionView = buildAttentionView(
    [createTaskView({ now: stale }), createTaskView({ now: fresh })],
    { now: "2026-03-09T12:30:00.000Z" },
  );

  assert.equal(attentionView.now?.interactionId, "interaction:fresh");
  assert.equal(attentionView.ambient[0]?.interactionId, "interaction:stale");
});

test("aging does not suppress recent critical work during overload", () => {
  const failed = createFrame({
    taskId: "task:recent-failed",
    interactionId: "interaction:recent-failed",
    tone: "critical",
    consequence: "high",
    title: "Recent critical failure",
    timing: {
      createdAt: "2026-03-09T12:20:00.000Z",
      updatedAt: "2026-03-09T12:20:00.000Z",
    },
  });

  const attentionView = buildAttentionView(
    [createTaskView({ now: failed })],
    {
      globalAttentionState: "overloaded" satisfies AttentionState,
      now: "2026-03-09T12:30:00.000Z",
    },
  );

  assert.equal(attentionView.now?.interactionId, "interaction:recent-failed");
});

test("focus hold preserves the engaged interaction across small interrupt churn", () => {
  const engaged = createFrame({
    taskId: "task:engaged",
    interactionId: "interaction:engaged",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve deploy",
    responseSpec: { kind: "approval", actions: [] },
    timing: {
      createdAt: "2026-03-09T12:00:00.000Z",
      updatedAt: "2026-03-09T12:00:00.000Z",
    },
  });
  const challenger = createFrame({
    taskId: "task:challenger",
    interactionId: "interaction:challenger",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve follow-up deploy",
    responseSpec: { kind: "approval", actions: [] },
    timing: {
      createdAt: "2026-03-09T12:01:00.000Z",
      updatedAt: "2026-03-09T12:01:00.000Z",
    },
  });

  const attentionView = buildAttentionView(
    [createTaskView({ now: engaged }), createTaskView({ now: challenger })],
    {
      focusedInteractionId: engaged.interactionId,
      now: "2026-03-09T12:02:00.000Z",
    },
  );

  assert.equal(attentionView.now?.interactionId, engaged.interactionId);
  assert.equal(attentionView.next[0]?.interactionId, challenger.interactionId);
});

test("focus hold yields to clearly stronger critical interruptions", () => {
  const engaged = createFrame({
    taskId: "task:engaged",
    interactionId: "interaction:engaged",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve deploy",
    responseSpec: { kind: "approval", actions: [] },
  });
  const critical = createFrame({
    taskId: "task:critical",
    interactionId: "interaction:critical",
    mode: "approval",
    tone: "critical",
    consequence: "high",
    title: "Critical production rollback",
    responseSpec: { kind: "approval", actions: [] },
  });

  const attentionView = buildAttentionView(
    [createTaskView({ now: engaged }), createTaskView({ now: critical })],
    {
      focusedInteractionId: engaged.interactionId,
      now: "2026-03-09T12:02:00.000Z",
    },
  );

  assert.equal(attentionView.now?.interactionId, critical.interactionId);
});
