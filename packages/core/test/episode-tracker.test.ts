import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { EpisodeTracker, readFrameEpisodeId } from "../src/episode-tracker.js";
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

test("episode tracker groups related interactions by source and anchor", () => {
  const store = new EpisodeTracker();
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
  assert.equal(second.episodeEvidenceScore, 6);
  assert.ok(second.episodeEvidenceReasons?.includes("operator-facing work makes this episode immediately actionable"));
  assert.ok(second.episodeEvidenceReasons?.includes("multiple related interactions have accumulated in this episode"));
});

test("frame planner persists episode metadata onto frames", () => {
  const planner = new FramePlanner();
  const frame = planner.plan(
    createCandidate({
      episodeId: "episode:test",
      episodeKey: "claude-code:interruptive:/workspace/config.ts",
      episodeState: "actionable",
      episodeSize: 2,
      episodeEvidenceScore: 5,
      episodeEvidenceReasons: ["multiple related interactions have accumulated in this episode"],
    }),
    null,
  );

  assert.equal(readFrameEpisodeId(frame), "episode:test");
  assert.deepEqual(frame.metadata?.episode, {
    id: "episode:test",
    key: "claude-code:interruptive:/workspace/config.ts",
    state: "actionable",
    size: 2,
    evidenceScore: 5,
    evidenceReasons: ["multiple related interactions have accumulated in this episode"],
    lastInteractionId: "interaction:one",
    updatedAt: "2026-03-08T12:00:00.000Z",
  });
});

test("episode tracker marks repeated non-blocking work as batched", () => {
  const store = new EpisodeTracker();
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

test("high-signal recurring status work can make an episode actionable", () => {
  const store = new EpisodeTracker();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      consequence: "high",
      responseSpec: { kind: "none" },
    }),
  );
  const second = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      consequence: "high",
      title: "Config sync failed again",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "actionable");
  assert.equal(second.episodeEvidenceScore, 4);
  assert.ok(second.episodeEvidenceReasons?.includes("high-signal evidence is stacking up across the episode"));
});

test("relation hints increase episode evidence for recurring and escalating work", () => {
  const store = new EpisodeTracker();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      consequence: "medium",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
    }),
  );

  const second = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      consequence: "medium",
      title: "Config sync is worse again",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }, { kind: "escalates" }],
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "actionable");
  assert.ok((second.episodeEvidenceScore ?? 0) >= 4);
  assert.ok(second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is recurring"));
  assert.ok(second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is escalating"));
});

test("relation targets group wording-drifted updates into the same episode", () => {
  const store = new EpisodeTracker();
  const first = store.assign(
    createCandidate({
      taskId: "task:one",
      interactionId: "interaction:one",
      blocking: false,
      mode: "status",
      title: "Cache rebuild still running",
      summary: "The production cache rebuild is still in progress.",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:cache:prod" }],
    }),
  );

  const second = store.assign(
    createCandidate({
      taskId: "task:two",
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      title: "Resync remains stalled again",
      summary: "The cache pipeline is worse again.",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:cache:prod" },
        { kind: "repeats", target: "issue:cache:prod" },
      ],
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(first.episodeId, second.episodeId);
  assert.ok(second.episodeKey?.includes("issue:cache:prod"));
});
