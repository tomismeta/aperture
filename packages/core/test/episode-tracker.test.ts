import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { EpisodeTracker, readFrameEpisodeId } from "../src/episode-tracker.js";
import { FramePlanner } from "../src/frame-planner.js";

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  const candidate = {
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

  return {
    ...candidate,
    judgmentInput: overrides.judgmentInput ?? {
      blockedLikeStatus: false,
    },
  };
}

function weakInferredSemanticEvidence() {
  return {
    confidence: "medium" as const,
    source: "inferred" as const,
    strength: "weak" as const,
    abstained: false,
  };
}

function strongHintedSemanticEvidence() {
  return {
    confidence: "high" as const,
    source: "hinted" as const,
    strength: "strong" as const,
    abstained: false,
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

test("non-blocking updates can move an actionable episode into waiting", () => {
  const store = new EpisodeTracker();
  store.assign(createCandidate());

  const waitingUpdate = store.assign(
    createCandidate({
      interactionId: "interaction:one",
      blocking: false,
      mode: "status",
      title: "Config approval is still being processed",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(waitingUpdate.episodeState, "waiting");
  assert.equal(waitingUpdate.episodeSize, 1);
  assert.equal(waitingUpdate.episodeEvidenceScore, 1);
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
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
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
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "actionable");
  assert.ok((second.episodeEvidenceScore ?? 0) >= 4);
  assert.ok(second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is recurring"));
  assert.ok(second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is escalating"));
});

test("weak inferred relation hints stay diagnostic until stronger evidence arrives", () => {
  const store = new EpisodeTracker();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      consequence: "medium",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: weakInferredSemanticEvidence(),
      },
    }),
  );

  const second = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      consequence: "medium",
      title: "Config sync regressed again",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }, { kind: "escalates" }],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: weakInferredSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "batched");
  assert.equal(second.episodeEvidenceScore, 1);
  assert.ok(!second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is recurring"));
  assert.ok(!second.episodeEvidenceReasons?.includes("semantic relation hints indicate this issue is escalating"));
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

test("resolved episodes reopen with a fresh identity and reset evidence", () => {
  const store = new EpisodeTracker();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      responseSpec: { kind: "none" },
    }),
  );
  const batched = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      title: "Config sync is still running",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  store.resolveInteraction("interaction:two");

  const reopened = store.assign(
    createCandidate({
      interactionId: "interaction:three",
      blocking: false,
      mode: "status",
      title: "Config sync resumed",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );

  assert.notEqual(reopened.episodeId, batched.episodeId);
  assert.equal(reopened.episodeSize, 1);
  assert.equal(reopened.episodeState, "emerging");
  assert.equal(reopened.episodeEvidenceScore, 0);
});

test("long-quiet episodes reopen with a fresh identity and reset evidence", () => {
  const store = new EpisodeTracker();
  store.assign(
    createCandidate({
      blocking: false,
      mode: "status",
      responseSpec: { kind: "none" },
    }),
  );
  const batched = store.assign(
    createCandidate({
      interactionId: "interaction:two",
      blocking: false,
      mode: "status",
      title: "Config sync is still running",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  const reopened = store.assign(
    createCandidate({
      interactionId: "interaction:three",
      blocking: false,
      mode: "status",
      title: "Config sync resumed after a long pause",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:20:00.000Z",
    }),
  );

  assert.notEqual(reopened.episodeId, batched.episodeId);
  assert.equal(reopened.episodeSize, 1);
  assert.equal(reopened.episodeState, "emerging");
  assert.equal(reopened.episodeEvidenceScore, 0);
});
