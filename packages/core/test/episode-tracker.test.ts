import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionCandidate } from "../src/interaction-candidate.js";
import type { AttentionFrame, AttentionView } from "../src/frame.js";
import {
  EpisodeTracker,
  findVisibleEpisodeFrames,
  readFrameEpisodeId,
} from "../src/episode-tracker.js";
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
      items: [{ id: "file_path", label: "file_path", value: "/workspace/config.ts" }],
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

function weakInferredRelationEvidence() {
  return {
    source: "inferred" as const,
    strength: "weak" as const,
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

function createEpisodeFrame(
  overrides: Partial<InteractionCandidate> = {},
  state: NonNullable<InteractionCandidate["episodeState"]> = "actionable",
): AttentionFrame {
  return new FramePlanner().plan(
    createCandidate({
      episodeId: "episode:test",
      episodeKey: "claude-code:interruptive:/workspace/config.ts",
      episodeState: state,
      episodeSize: 2,
      episodeEvidenceScore: 5,
      episodeEvidenceReasons: ["multiple related interactions have accumulated in this episode"],
      ...overrides,
    }),
    null,
  );
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
  assert.ok(
    second.episodeEvidenceReasons?.includes(
      "operator-facing work makes this episode immediately actionable",
    ),
  );
  assert.ok(
    second.episodeEvidenceReasons?.includes(
      "multiple related interactions have accumulated in this episode",
    ),
  );
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

test("visible episode lookup filters by lane", () => {
  const attentionView: AttentionView = {
    now: createEpisodeFrame({ interactionId: "interaction:now" }),
    next: [createEpisodeFrame({ interactionId: "interaction:next" })],
    ambient: [createEpisodeFrame({ interactionId: "interaction:ambient" })],
  };

  assert.deepEqual(
    findVisibleEpisodeFrames(attentionView, "episode:test", { lanes: ["now", "ambient"] }).map(
      (frame) => frame.interactionId,
    ),
    ["interaction:now", "interaction:ambient"],
  );
});

test("visible episode lookup excludes the current interaction", () => {
  const attentionView: AttentionView = {
    now: createEpisodeFrame({ interactionId: "interaction:current" }),
    next: [createEpisodeFrame({ interactionId: "interaction:other" })],
    ambient: [],
  };

  assert.deepEqual(
    findVisibleEpisodeFrames(attentionView, "episode:test", {
      excludedInteractionId: "interaction:current",
    }).map((frame) => frame.interactionId),
    ["interaction:other"],
  );
});

test("visible episode lookup ignores dormant episode frames", () => {
  const attentionView: AttentionView = {
    now: createEpisodeFrame({ interactionId: "interaction:stale" }, "stale"),
    next: [createEpisodeFrame({ interactionId: "interaction:resolved" }, "resolved")],
    ambient: [createEpisodeFrame({ interactionId: "interaction:live" })],
  };

  assert.deepEqual(
    findVisibleEpisodeFrames(attentionView, "episode:test").map((frame) => frame.interactionId),
    ["interaction:live"],
  );
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
  assert.ok(
    second.episodeEvidenceReasons?.includes(
      "high-signal evidence is stacking up across the episode",
    ),
  );
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
  assert.ok(
    second.episodeEvidenceReasons?.includes(
      "semantic relation hints indicate this issue is recurring",
    ),
  );
  assert.ok(
    second.episodeEvidenceReasons?.includes(
      "semantic relation hints indicate this issue is escalating",
    ),
  );
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
        relationEvidence: weakInferredRelationEvidence(),
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
        relationEvidence: weakInferredRelationEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(second.episodeState, "batched");
  assert.equal(second.episodeEvidenceScore, 1);
  assert.ok(
    !second.episodeEvidenceReasons?.includes(
      "semantic relation hints indicate this issue is recurring",
    ),
  );
  assert.ok(
    !second.episodeEvidenceReasons?.includes(
      "semantic relation hints indicate this issue is escalating",
    ),
  );
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

test("qualified resolving relation marks the episode resolved and resets evidence", () => {
  const store = new EpisodeTracker();
  const failed = store.assign(
    createCandidate({
      taskId: "task:build:failure",
      interactionId: "interaction:build:failure",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again before release.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:release" },
        { kind: "repeats", target: "issue:build:release" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
    }),
  );

  const resolved = store.assign(
    createCandidate({
      taskId: "task:build:resolution",
      interactionId: "interaction:build:resolution",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build is fixed and no longer blocked.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:release" },
        { kind: "resolves", target: "issue:build:release" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(resolved.episodeId, failed.episodeId);
  assert.equal(resolved.episodeState, "resolved");
  assert.equal(resolved.episodeEvidenceScore, 0);
  assert.deepEqual(resolved.episodeEvidenceReasons, [
    "semantic relation hints indicate this episode is resolved",
  ]);

  const reopened = store.assign(
    createCandidate({
      taskId: "task:build:reopened",
      interactionId: "interaction:build:reopened",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again after the fix.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:release" }],
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );

  assert.notEqual(reopened.episodeId, failed.episodeId);
  assert.equal(reopened.episodeSize, 1);
  assert.equal(reopened.episodeEvidenceScore, 2);
});

test("resolved status episodes reopen with a fresh identity when interaction id is reused", () => {
  const store = new EpisodeTracker();
  const failed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:reused-status" }],
    }),
  );

  const resolved = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build is fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:reused-status" },
        { kind: "resolves", target: "issue:build:reused-status" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  const reopened = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again after the fix.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:reused-status" }],
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );

  assert.equal(resolved.episodeId, failed.episodeId);
  assert.equal(resolved.episodeState, "resolved");
  assert.notEqual(reopened.episodeId, failed.episodeId);
  assert.equal(reopened.episodeSize, 1);
  assert.equal(reopened.episodeState, "emerging");
});

test("delayed pre-resolution status updates stay attached to the resolved episode", () => {
  const store = new EpisodeTracker();
  const failed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:delayed" }],
      timestamp: "2026-03-08T12:00:00.000Z",
    }),
  );
  const resolved = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build is fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:delayed" },
        { kind: "resolves", target: "issue:build:delayed" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );

  const delayed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed before the fix landed.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:delayed" }],
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(resolved.episodeId, failed.episodeId);
  assert.equal(delayed.episodeId, resolved.episodeId);
  assert.equal(delayed.episodeState, "resolved");
  assert.equal(delayed.episodeEvidenceScore, 0);
  assert.equal(delayed.episodeObsolete, true);
});

test("suppressed stale updates do not contribute future episode evidence", () => {
  const firstOptions: Partial<InteractionCandidate> = {
    taskId: "task:sync",
    interactionId: "interaction:sync:first",
    blocking: false,
    mode: "status",
    title: "Sync is running",
    summary: "The sync is running.",
    consequence: "low",
    tone: "ambient",
    responseSpec: { kind: "none" },
    relationHints: [{ kind: "same_issue", target: "issue:sync:stale-neutral" }],
    timestamp: "2026-03-08T12:00:00.000Z",
  };
  const freshOptions: Partial<InteractionCandidate> = {
    ...firstOptions,
    interactionId: "interaction:sync:fresh",
    title: "Sync is still running",
    summary: "The sync is still running.",
    timestamp: "2026-03-08T12:01:00.000Z",
  };
  const staleOptions: Partial<InteractionCandidate> = {
    ...firstOptions,
    interactionId: "interaction:sync:stale-replay",
    title: "Sync failed earlier",
    summary: "The sync failed before the latest status.",
    consequence: "high",
    tone: "critical",
    timestamp: "2026-03-08T11:59:00.000Z",
  };

  const baselineStore = new EpisodeTracker();
  baselineStore.assign(createCandidate(firstOptions));
  const baseline = baselineStore.assign(createCandidate(freshOptions));

  const store = new EpisodeTracker();
  const first = store.assign(createCandidate(firstOptions));
  const stale = store.assign(createCandidate(staleOptions));
  const fresh = store.assign(createCandidate(freshOptions));

  assert.equal(stale.episodeId, first.episodeId);
  assert.equal(stale.episodeObsolete, true);
  assert.equal(stale.episodeSize, first.episodeSize);
  assert.equal(fresh.episodeSize, baseline.episodeSize);
  assert.equal(fresh.episodeEvidenceScore, baseline.episodeEvidenceScore);
  assert.deepEqual(fresh.episodeEvidenceReasons, baseline.episodeEvidenceReasons);
  assert.equal(fresh.episodeState, baseline.episodeState);
  assert.equal(store.stats().boundInteractions, baselineStore.stats().boundInteractions);
});

test("delayed resolution replays stay attached but obsolete", () => {
  const store = new EpisodeTracker();
  const failed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:delayed-resolution" }],
      timestamp: "2026-03-08T12:00:00.000Z",
    }),
  );
  const resolved = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build is fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:delayed-resolution" },
        { kind: "resolves", target: "issue:build:delayed-resolution" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );

  const replayed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build had already been fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:delayed-resolution" },
        { kind: "resolves", target: "issue:build:delayed-resolution" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );

  assert.equal(resolved.episodeId, failed.episodeId);
  assert.equal(replayed.episodeId, resolved.episodeId);
  assert.equal(replayed.episodeState, "resolved");
  assert.equal(replayed.episodeEvidenceScore, 0);
  assert.equal(replayed.episodeObsolete, true);
});

test("delayed dormant replay does not steal a fresh recurrence episode index", () => {
  const store = new EpisodeTracker();
  const failed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:initial-status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:index-replay" }],
      timestamp: "2026-03-08T12:00:00.000Z",
    }),
  );
  const resolved = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:initial-status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved",
      summary: "The deploy build is fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:index-replay" },
        { kind: "resolves", target: "issue:build:index-replay" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:02:00.000Z",
    }),
  );
  const recurrence = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:retry-status",
      blocking: false,
      mode: "status",
      title: "Build failed again",
      summary: "The deploy build failed again after the fix.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [{ kind: "same_issue", target: "issue:build:index-replay" }],
      timestamp: "2026-03-08T12:03:00.000Z",
    }),
  );
  const replayed = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:initial-status",
      blocking: false,
      mode: "status",
      title: "Build issue resolved earlier",
      summary: "The deploy build had already been fixed.",
      consequence: "low",
      tone: "ambient",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:index-replay" },
        { kind: "resolves", target: "issue:build:index-replay" },
      ],
      judgmentInput: {
        blockedLikeStatus: false,
        semanticEvidence: strongHintedSemanticEvidence(),
      },
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  );
  const continued = store.assign(
    createCandidate({
      taskId: "task:build",
      interactionId: "interaction:task:build:retry-followup-status",
      blocking: false,
      mode: "status",
      title: "Build is still failing",
      summary: "The deploy build is still failing after the retry.",
      consequence: "high",
      tone: "critical",
      responseSpec: { kind: "none" },
      relationHints: [
        { kind: "same_issue", target: "issue:build:index-replay" },
        { kind: "repeats", target: "issue:build:index-replay" },
      ],
      timestamp: "2026-03-08T12:04:00.000Z",
    }),
  );

  assert.equal(resolved.episodeId, failed.episodeId);
  assert.notEqual(recurrence.episodeId, failed.episodeId);
  assert.equal(replayed.episodeId, resolved.episodeId);
  assert.equal(replayed.episodeObsolete, true);
  assert.equal(continued.episodeId, recurrence.episodeId);
  assert.equal(continued.episodeSize, 2);
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

test("episode tracker prunes dormant records after long idle gaps", () => {
  const store = new EpisodeTracker();

  store.assign(createCandidate());
  store.assign(
    createCandidate({
      interactionId: "interaction:stale-successor",
      timestamp: "2026-03-08T12:16:00.000Z",
    }),
  );
  store.assign(
    createCandidate({
      taskId: "task:other",
      interactionId: "interaction:fresh",
      timestamp: "2026-03-10T12:16:00.000Z",
      context: {
        items: [{ id: "file_path", label: "file_path", value: "/workspace/other.ts" }],
      },
      summary: "other.ts",
      title: "Read other.ts",
    }),
  );

  const stats = store.stats();
  assert.equal(stats.activeRecords, 2);
  assert.equal(stats.dormantRecords, 0);
  assert.equal(stats.boundInteractions, 2);
  assert.equal(stats.prunedRecords >= 1, true);
  assert.equal(stats.latestEpisodeAt, "2026-03-10T12:16:00.000Z");
});
