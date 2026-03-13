import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { EpisodeStore, readFrameEpisodeId } from "../src/episode-store.js";
import { FramePlanner } from "../src/frame-planner.js";

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:session",
    interactionId: "interaction:one",
    source: { id: "session:1", kind: "claude-code" },
    mode: "approval",
    tone: "focused",
    consequence: "low",
    title: "Read config.ts",
    summary: "config.ts",
    context: {
      items: [
        { id: "file_path", label: "file_path", value: "/workspace/config.ts" },
      ],
    },
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    priority: "normal",
    blocking: true,
    timestamp: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

test("episode store groups related interactions by source and anchor", () => {
  const store = new EpisodeStore();
  const first = store.assign(createCandidate());
  const second = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      mode: "form",
      title: "Edit config.ts",
      responseSpec: {
        kind: "form",
        fields: [],
        actions: [{ id: "submit", label: "Continue", kind: "submit", emphasis: "primary" }],
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(first.episodeId, second.episodeId);
  assert.equal(second.episodeState, "actionable");
  assert.equal(second.episodeSize, 2);
});

test("frame planner persists episode metadata onto frames", () => {
  const planner = new FramePlanner();
  const frame = planner.plan(
    createCandidate({
      episodeId: "episode:test",
      episodeKey: "claude-code:interruptive:/workspace/config.ts",
      episodeState: "actionable",
      episodeSize: 2,
    }),
    null,
  );

  assert.equal(readFrameEpisodeId(frame), "episode:test");
  assert.deepEqual(frame.metadata?.episode, {
    id: "episode:test",
    key: "claude-code:interruptive:/workspace/config.ts",
    state: "actionable",
    size: 2,
    lastInteractionId: "interaction:one",
    updatedAt: "2026-03-08T12:00:00.000Z",
  });
});

test("episode store marks repeated non-blocking work as batched", () => {
  const store = new EpisodeStore();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      responseSpec: { kind: "none" },
    }),
  );
  const second = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      title: "Still working on config.ts",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "batched");
  assert.equal(second.episodeSize, 2);
});
