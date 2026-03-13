import test from "node:test";
import assert from "node:assert/strict";

import type { Frame } from "../src/frame.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { InteractionCoordinator } from "../src/interaction-coordinator.js";

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:session",
    interactionId: "interaction:new",
    mode: "status",
    tone: "focused",
    consequence: "medium",
    title: "Episode update",
    responseSpec: { kind: "none" },
    priority: "normal",
    blocking: false,
    timestamp: "2026-03-08T12:01:00.000Z",
    episodeId: "episode:shared",
    episodeKey: "claude-code:interruptive:/workspace/config.ts",
    episodeState: "waiting",
    episodeSize: 2,
    ...overrides,
  };
}

function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame:current",
    taskId: "task:session",
    interactionId: "interaction:current",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Current approval",
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
    metadata: {
      episode: {
        id: "episode:shared",
        key: "claude-code:interruptive:/workspace/config.ts",
        state: "actionable",
        size: 2,
        lastInteractionId: "interaction:current",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    },
    ...overrides,
  };
}

test("same-episode status stays bundled with the active blocking episode", () => {
  const coordinator = new InteractionCoordinator();
  const decision = coordinator.coordinate(createFrame(), createCandidate());

  assert.equal(decision.kind, "ambient");
});

test("same episode can promote a new blocking step over a status frame", () => {
  const coordinator = new InteractionCoordinator();
  const decision = coordinator.coordinate(
    createFrame({
      mode: "status",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      mode: "approval",
      blocking: true,
      priority: "high",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
      episodeState: "actionable",
    }),
  );

  assert.equal(decision.kind, "activate");
});
