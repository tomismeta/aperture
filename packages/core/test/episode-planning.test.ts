import test from "node:test";
import assert from "node:assert/strict";

import type { AttentionView } from "../src/frame.js";
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

test("visible queued episode work batches new related interactions with no active task frame", () => {
  const coordinator = new InteractionCoordinator();
  const decision = coordinator.coordinate(null, createCandidate({
    episodeState: "batched",
  }), {
    attentionView: {
      active: null,
      queued: [
        createFrame({
          taskId: "task:other",
          interactionId: "interaction:queued",
          mode: "status",
          responseSpec: { kind: "none" },
          metadata: {
            episode: {
              id: "episode:shared",
              key: "claude-code:interruptive:/workspace/config.ts",
              state: "batched",
              size: 2,
              lastInteractionId: "interaction:queued",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          },
        }),
      ],
      ambient: [],
    } satisfies AttentionView,
  });

  assert.equal(decision.kind, "queue");
});

test("visible queued episode work stays bundled even when unrelated current work is active", () => {
  const coordinator = new InteractionCoordinator();
  const decision = coordinator.coordinate(
    createFrame({
      id: "frame:unrelated",
      taskId: "task:other-current",
      interactionId: "interaction:other-current",
      metadata: {
        episode: {
          id: "episode:other",
          key: "claude-code:interruptive:/workspace/other.ts",
          state: "actionable",
          size: 1,
          lastInteractionId: "interaction:other-current",
          updatedAt: "2026-03-08T12:00:00.000Z",
        },
      },
    }),
    createCandidate({
      episodeState: "batched",
    }),
    {
      attentionView: {
        active: createFrame({
          id: "frame:other-active",
          taskId: "task:other-current",
          interactionId: "interaction:other-current",
          metadata: {
            episode: {
              id: "episode:other",
              key: "claude-code:interruptive:/workspace/other.ts",
              state: "actionable",
              size: 1,
              lastInteractionId: "interaction:other-current",
              updatedAt: "2026-03-08T12:00:00.000Z",
            },
          },
        }),
        queued: [
          createFrame({
            taskId: "task:batched",
            interactionId: "interaction:queued",
            mode: "status",
            responseSpec: { kind: "none" },
            metadata: {
              episode: {
                id: "episode:shared",
                key: "claude-code:interruptive:/workspace/config.ts",
                state: "batched",
                size: 2,
                lastInteractionId: "interaction:queued",
                updatedAt: "2026-03-08T12:00:30.000Z",
              },
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
    },
  );

  assert.equal(decision.kind, "queue");
});
