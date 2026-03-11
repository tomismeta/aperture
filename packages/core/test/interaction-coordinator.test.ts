import test from "node:test";
import assert from "node:assert/strict";

import type { Frame } from "../src/index.js";

import { InteractionCoordinator } from "../src/interaction-coordinator.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import type { AttentionView } from "../src/frame.js";

const coordinator = new InteractionCoordinator();

function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame:current",
    taskId: "task:1",
    interactionId: "interaction:current",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Current review",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    timing: {
      createdAt: "2026-03-08T12:00:00.000Z",
      updatedAt: "2026-03-08T12:00:00.000Z",
    },
    ...overrides,
  };
}

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:1",
    interactionId: "interaction:new",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "New review",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    priority: "high",
    blocking: true,
    timestamp: "2026-03-08T12:01:00.000Z",
    ...overrides,
  };
}

test("activates a candidate when nothing is active", () => {
  const decision = coordinator.coordinate(null, createCandidate());
  assert.equal(decision.kind, "activate");
});

test("keeps background work ambient while a blocking frame is waiting", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "ambient");
});

test("queues lower-consequence candidates at equal priority", () => {
  const decision = coordinator.coordinate(
    createFrame({ consequence: "high" }),
    createCandidate({ consequence: "medium" }),
  );

  assert.equal(decision.kind, "queue");
});

test("activates higher-consequence candidates at equal priority", () => {
  const decision = coordinator.coordinate(
    createFrame({ consequence: "medium" }),
    createCandidate({ consequence: "high" }),
  );

  assert.equal(decision.kind, "activate");
});

test("re-activates updates to the same interaction id", () => {
  const decision = coordinator.coordinate(
    createFrame({ interactionId: "interaction:same" }),
    createCandidate({ interactionId: "interaction:same" }),
  );

  assert.equal(decision.kind, "activate");
});

test("queues non-blocking high-status work while a blocking frame is waiting", () => {
  const decision = coordinator.coordinate(
    createFrame(),
    createCandidate({
      mode: "status",
      tone: "critical",
      consequence: "high",
      priority: "high",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("promotes blocking work over non-blocking status frames", () => {
  const decision = coordinator.coordinate(
    createFrame({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: true,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("uses stored attention offsets to keep more important current work active", () => {
  const decision = coordinator.coordinate(
    createFrame({
      metadata: {
        attention: {
          scoreOffset: 20,
          rationale: ["history indicates this work matters quickly"],
        },
      },
    }),
    createCandidate({
      consequence: "medium",
      attentionScoreOffset: 0,
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("keeps low-value status queued when urgent backlog is already present", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "critical",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
    {
      attentionView: {
        active: createFrame({
          taskId: "task:critical:1",
          interactionId: "interaction:critical:1",
          mode: "status",
          tone: "critical",
          consequence: "high",
          responseSpec: { kind: "none" },
          timing: {
            createdAt: "2026-03-08T12:00:20.000Z",
            updatedAt: "2026-03-08T12:00:20.000Z",
          },
        }),
        queued: [
          createFrame({
            taskId: "task:critical:2",
            interactionId: "interaction:critical:2",
            mode: "status",
            tone: "critical",
            consequence: "high",
            responseSpec: { kind: "none" },
            timing: {
              createdAt: "2026-03-08T12:00:30.000Z",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
    },
  );

  assert.equal(decision.kind, "queue");
});

test("escalates repeatedly deferred status when scores are otherwise tied", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:stuck",
      interactionId: "interaction:stuck",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      taskSummary: {
        recentSignals: 6,
        lifetimeSignals: 12,
        counts: {
          presented: 2,
          viewed: 0,
          responded: 0,
          dismissed: 0,
          deferred: 3,
          contextExpanded: 0,
          contextSkipped: 0,
          timedOut: 0,
          returned: 2,
          attentionShifted: 0,
        },
        deferred: {
          queued: 3,
          suppressed: 0,
          manual: 0,
        },
        responseRate: 0,
        dismissalRate: 0,
        averageResponseLatencyMs: null,
        averageDismissalLatencyMs: null,
        lastSignalAt: "2026-03-08T12:00:30.000Z",
      },
    },
  );

  assert.equal(decision.kind, "activate");
});
