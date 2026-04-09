import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace as PublicApertureTrace } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";
import { readFrameEpisodeId } from "../src/episode-tracker.js";
import {
  subscribeInternalTrace,
  type ApertureTrace as InternalApertureTrace,
} from "../src/internal-contract.js";

test("global urgent backlog demotes lower-value queued status into ambient", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve agent hire",
    summary: "A hire request needs approval.",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:blocked",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    title: "Additional background context",
    summary: "Supporting status update.",
    status: "blocked",
  });

  core.publish({
    id: "evt:failed",
    taskId: "task:failed",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    title: "Bash failed",
    summary: "The deploy command failed.",
    status: "failed",
  });

  const attentionView = core.getAttentionView();

  assert.equal(attentionView.now?.interactionId, "interaction:approval");
  assert.equal(attentionView.next.length, 0);
  assert.deepEqual(
    attentionView.ambient.map((frame) => frame.title),
    ["Bash failed", "Additional background context"],
  );
});

test("absent operator keeps blocking requests queued in the shared view", () => {
  const core = new ApertureCore({ operatorPresence: "absent" });

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve agent hire",
    summary: "A hire request needs approval.",
    request: { kind: "approval" },
  });

  const attentionView = core.getAttentionView();

  assert.equal(attentionView.now, null);
  assert.equal(attentionView.next.length, 1);
  assert.equal(attentionView.next[0]?.interactionId, "interaction:approval");
});

test("trace reasons explain why lower-priority work is queued", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:trace",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve force push",
    summary: "A force push needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:queued",
    taskId: "task:trace",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:queued",
    title: "Choose fallback path",
    summary: "A fallback path is needed.",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "next");
  assert.match(
    candidateTrace.coordination.reasons.join(" "),
    /current work still outranks the new candidate/,
  );
});

test("trace includes attention pressure for candidate decisions", () => {
  const core = new ApertureCore();
  const traces: InternalApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:active",
    taskId: "task:pressure",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:status",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    title: "Background sync",
    summary: "A background sync is still running.",
    status: "running",
    progress: 50,
  });

  core.publish({
    id: "evt:choice",
    taskId: "task:choice",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:choice",
    title: "Choose rollout option",
    summary: "A rollout option is needed.",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.ok(candidateTrace.pressureForecast.score >= 0);
  assert.ok(["low", "rising", "high"].includes(candidateTrace.pressureForecast.overloadRisk));
});

test("core timeSource keeps evidence freshness deterministic", () => {
  const recentCore = new ApertureCore({
    timeSource: () => Date.parse("2026-03-15T12:00:10.000Z"),
  });
  const staleCore = new ApertureCore({
    timeSource: () => Date.parse("2026-03-15T12:03:10.000Z"),
  });
  const recentTraces: InternalApertureTrace[] = [];
  const staleTraces: InternalApertureTrace[] = [];

  subscribeInternalTrace(recentCore, (trace) => {
    recentTraces.push(trace);
  });
  subscribeInternalTrace(staleCore, (trace) => {
    staleTraces.push(trace);
  });

  for (let index = 0; index < 5; index += 1) {
    const signal = {
      kind: "presented" as const,
      taskId: `task:seed:${index}`,
      interactionId: `interaction:seed:${index}`,
      frameId: `frame:seed:${index}`,
      timestamp: "2026-03-15T12:00:00.000Z",
    };
    recentCore.recordSignal(signal);
    staleCore.recordSignal(signal);
  }

  recentCore.publish({
    id: "evt:recent",
    taskId: "task:recent",
    timestamp: "2026-03-15T12:00:12.000Z",
    type: "human.input.requested",
    interactionId: "interaction:recent",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    request: { kind: "approval" },
  });

  staleCore.publish({
    id: "evt:stale",
    taskId: "task:stale",
    timestamp: "2026-03-15T12:03:12.000Z",
    type: "human.input.requested",
    interactionId: "interaction:stale",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "medium",
    request: { kind: "approval" },
  });

  const recentTrace = recentTraces.findLast((trace) => trace.evaluation.kind === "candidate");
  const staleTrace = staleTraces.findLast((trace) => trace.evaluation.kind === "candidate");

  assert.ok(recentTrace);
  assert.ok(staleTrace);
  if (!recentTrace || recentTrace.evaluation.kind !== "candidate" || !staleTrace || staleTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(recentTrace.pressureForecast.metrics.recentDemand, 5);
  assert.equal(staleTrace.pressureForecast.metrics.recentDemand, 0);
  assert.equal(staleTrace.attentionBurden.metrics.recentDecisions, 0);
});

test("related episode updates merge into an existing queued frame instead of adding fragments", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:next:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fix",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const firstQueued = core.getAttentionView().next[0];
  assert.ok(firstQueued);
  if (!firstQueued) {
    return;
  }

  core.publish({
    id: "evt:next:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:b",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fallback",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "fallback", label: "Fallback" }],
    },
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.next.length, 1);
  assert.equal(core.getTaskView("task:episode:a").next.length, 0);
  assert.equal(core.getTaskView("task:episode:b").next.length, 1);
  assert.equal(core.getTaskView("task:episode:b").next[0]?.id, firstQueued.id);
  assert.equal(core.getTaskView("task:episode:b").next[0]?.interactionId, "interaction:episode:b");
});

test("responded episodes reopen with a fresh episode identity", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval:first",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:first",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve config change",
    summary: "config.ts",
    request: { kind: "approval" },
  });

  const firstFrame = core.getAttentionView().now;
  assert.ok(firstFrame);
  if (!firstFrame) {
    return;
  }

  core.submit({
    taskId: "task:episode",
    interactionId: "interaction:episode:first",
    response: { kind: "approved" },
  });

  core.publish({
    id: "evt:approval:second",
    taskId: "task:episode",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:second",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve config fallback",
    summary: "config.ts",
    request: { kind: "approval" },
  });

  const reopenedFrame = core.getAttentionView().now;
  assert.ok(reopenedFrame);
  if (!reopenedFrame) {
    return;
  }

  assert.notEqual(readFrameEpisodeId(reopenedFrame), readFrameEpisodeId(firstFrame));
  assert.equal(reopenedFrame.metadata?.episode?.size, 1);
});

test("superseding blocking episode steps retire the stale active step", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve deployment step",
    summary: "prod deploy",
    semantic: {
      intentFrame: "approval_request",
      relationHints: [{ kind: "same_issue", target: "issue:deploy:prod" }],
      confidence: "high",
      factors: [],
      reasons: [],
    },
    request: { kind: "approval" },
  });

  const firstActive = core.getAttentionView().now;
  assert.ok(firstActive);
  if (!firstActive) {
    return;
  }

  core.publish({
    id: "evt:approval:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:b",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve rollback instead",
    summary: "prod deploy",
    semantic: {
      intentFrame: "approval_request",
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:prod" },
        { kind: "supersedes" },
      ],
      confidence: "high",
      factors: [],
      reasons: [],
    },
    request: { kind: "approval" },
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.now?.interactionId, "interaction:episode:b");
  assert.equal(core.getTaskView("task:episode:a").now, null);
  assert.equal(core.getTaskView("task:episode:a").next.length, 0);
  assert.equal(core.getTaskView("task:episode:b").now?.interactionId, "interaction:episode:b");
  assert.equal(readFrameEpisodeId(attentionView.now), readFrameEpisodeId(firstActive));
});

test("superseding blocking episode steps retire stale queued episode residue", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:approval:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve deployment step",
    summary: "prod deploy",
    semantic: {
      intentFrame: "approval_request",
      relationHints: [{ kind: "same_issue", target: "issue:deploy:prod" }],
      confidence: "high",
      factors: [],
      reasons: [],
    },
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:approval:queued",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "human.input.requested",
    source: { id: "session:1", kind: "claude-code" },
    interactionId: "interaction:episode:b",
    title: "Approve canary deploy instead",
    summary: "prod deploy",
    semantic: {
      intentFrame: "approval_request",
      relationHints: [{ kind: "same_issue", target: "issue:deploy:prod" }],
      confidence: "high",
      factors: [],
      reasons: [],
    },
    request: { kind: "approval" },
  });

  const before = core.getAttentionView();
  assert.equal(before.now?.interactionId, "interaction:episode:a");
  assert.ok(before.next.some((frame) => frame.taskId === "task:episode:b"));

  core.publish({
    id: "evt:approval:second",
    taskId: "task:episode:c",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:c",
    source: { id: "session:1", kind: "claude-code" },
    title: "Approve rollback instead",
    summary: "prod deploy",
    semantic: {
      intentFrame: "approval_request",
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:prod" },
        { kind: "supersedes" },
      ],
      confidence: "high",
      factors: [],
      reasons: [],
    },
    request: { kind: "approval" },
  });

  const after = core.getAttentionView();
  assert.equal(after.now?.interactionId, "interaction:episode:c");
  assert.equal(after.next.length, 0);
  assert.equal(after.ambient.length, 0);
  assert.equal(core.getTaskView("task:episode:a").now, null);
  assert.equal(core.getTaskView("task:episode:b").now, null);
  assert.equal(core.getTaskView("task:episode:b").next.length, 0);
  assert.equal(core.getTaskView("task:episode:c").now?.interactionId, "interaction:episode:c");
});

test("weak inferred superseding episode wording stays queued behind the current step", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];
  const context = {
    items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
  };

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:approval:episode-plan",
    type: "human.input.requested",
    taskId: "task:deploy",
    interactionId: "interaction:deploy:plan",
    timestamp: "2026-03-08T12:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Approve deploy plan",
    summary: "Approve the production deploy plan.",
    context,
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:approval:episode-rollback",
    type: "human.input.requested",
    taskId: "task:deploy",
    interactionId: "interaction:deploy:rollback",
    timestamp: "2026-03-08T12:00:20.000Z",
    source: { id: "custom-agent" },
    title: "Approve rollback instead",
    summary: "Use this rollback plan instead for the same production deploy.",
    context,
    request: { kind: "approval" },
  });

  const candidateTrace = traces.findLast((trace) => trace.event.id === "src:approval:episode-rollback");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(core.getAttentionView().now?.interactionId, "interaction:deploy:plan");
  assert.equal(core.getTaskView("task:deploy").next[0]?.interactionId, "interaction:deploy:rollback");
  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "next");
  assert.equal(
    candidateTrace.coordination.continuityEvaluations?.find((evaluation) => evaluation.rule === "same_episode")?.kind,
    "override",
  );
  assert.ok(
    candidateTrace.coordination.reasons.includes(
      "related work stays bundled with the current episode already in now",
    ),
  );
  assert.deepEqual(candidateTrace.semantic?.relationHints.map((hint) => hint.kind), ["same_issue", "supersedes"]);
  assert.equal(candidateTrace.semantic?.confidence, "low");
});

test("status updates with shared issue context stay bundled into one episode", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];
  const context = {
    items: [{ id: "issue", label: "Issue", value: "issue:deploy:prod" }],
  };

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:blocker",
    taskId: "task:blocker",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:blocker",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:status:issue:recovery",
    type: "task.updated",
    taskId: "task:issue:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    source: { id: "custom-agent" },
    title: "Deploy recovery status",
    summary: "Recovery work for the production deploy issue is underway.",
    status: "running",
    context,
  });

  const initialFrame = core.getTaskView("task:issue:a").ambient[0];
  const initialEpisodeId = readFrameEpisodeId(initialFrame);
  assert.ok(initialEpisodeId);
  if (!initialEpisodeId) {
    return;
  }

  core.publishSourceEvent({
    id: "src:status:issue:regressed",
    type: "task.updated",
    taskId: "task:issue:b",
    timestamp: "2026-03-08T12:00:20.000Z",
    source: { id: "custom-agent" },
    title: "Deploy issue regressed again",
    summary: "The production deploy issue came back and regressed while recovery is still in progress.",
    status: "waiting",
    context,
  });

  const candidateTrace = traces.findLast((trace) => trace.event.id === "src:status:issue:regressed");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.now?.interactionId, "interaction:blocker");
  assert.deepEqual(attentionView.next, []);
  assert.deepEqual(attentionView.ambient.map((frame) => frame.interactionId), ["interaction:task:issue:b:status"]);
  assert.equal(readFrameEpisodeId(attentionView.ambient[0] ?? null), initialEpisodeId);
  assert.equal(attentionView.ambient[0]?.metadata?.episode?.key, "custom-agent:status:issue:deploy:prod");
  assert.deepEqual(
    candidateTrace.semantic?.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats", "escalates"],
  );
  assert.equal(candidateTrace.coordination.kind, "ambient");
  assert.equal(candidateTrace.coordination.resultLane, "ambient");
  assert.equal(candidateTrace.semantic?.impact.continuity?.includes("relations (continuity)"), true);
});

test("repeated same-episode returns can promote queued episode work back into focus", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:blocker",
    taskId: "task:blocker",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:blocker",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:episode:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync running",
    summary: "config.ts",
    status: "running",
    progress: 25,
  });

  core.publish({
    id: "evt:blocker:clear",
    taskId: "task:blocker",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.completed",
  });

  const firstEpisodeFrame = core.getAttentionView().ambient[0];
  assert.ok(firstEpisodeFrame);
  if (!firstEpisodeFrame) {
    return;
  }

  core.publish({
    id: "evt:current",
    taskId: "task:current",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    title: "Other task blocked",
    summary: "other.ts",
    status: "blocked",
  });

  const episodeId = readFrameEpisodeId(firstEpisodeFrame);
  assert.ok(episodeId);
  if (!episodeId) {
    return;
  }

  core.recordSignal({
    kind: "returned",
    taskId: "task:episode:history",
    interactionId: "interaction:episode:history",
    timestamp: "2026-03-08T12:00:35.000Z",
    from: "ambient",
    metadata: {
      episode: {
        id: episodeId,
      },
    },
  });

  core.recordSignal({
    kind: "returned",
    taskId: "task:episode:history-2",
    interactionId: "interaction:episode:history-2",
    timestamp: "2026-03-08T12:00:36.000Z",
    from: "next",
    metadata: {
      episode: {
        id: episodeId,
      },
    },
  });

  core.publish({
    id: "evt:episode:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:40.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync blocked",
    summary: "config.ts",
    status: "blocked",
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.now?.taskId, "task:episode:b");
  assert.equal(core.getTaskView("task:episode:a").ambient.length, 0);
  assert.equal(core.getTaskView("task:episode:b").now?.taskId, "task:episode:b");
});

test("queue-worthy episode updates can promote an ambient episode frame into the queue", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:ambient",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync running",
    summary: "config.ts",
    status: "running",
    progress: 25,
  });

  core.publish({
    id: "evt:queue",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync failed",
    summary: "config.ts",
    status: "failed",
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.next.length, 1);
  assert.equal(attentionView.ambient.length, 0);
  assert.equal(attentionView.next[0]?.interactionId, "interaction:task:episode:b:status");
});

test("repeated same-episode returns stay queued while blocking work is active", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:blocker",
    taskId: "task:blocker",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:blocker",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:episode:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync running",
    summary: "config.ts",
    status: "running",
    progress: 25,
  });

  const firstEpisodeFrame = core.getAttentionView().ambient[0];
  assert.ok(firstEpisodeFrame);
  if (!firstEpisodeFrame) {
    return;
  }

  const episodeId = readFrameEpisodeId(firstEpisodeFrame);
  assert.ok(episodeId);
  if (!episodeId) {
    return;
  }

  core.recordSignal({
    kind: "returned",
    taskId: "task:episode:history",
    interactionId: "interaction:episode:history",
    timestamp: "2026-03-08T12:00:20.000Z",
    from: "ambient",
    metadata: {
      episode: {
        id: episodeId,
      },
    },
  });

  core.recordSignal({
    kind: "returned",
    taskId: "task:episode:history-2",
    interactionId: "interaction:episode:history-2",
    timestamp: "2026-03-08T12:00:21.000Z",
    from: "next",
    metadata: {
      episode: {
        id: episodeId,
      },
    },
  });

  core.publish({
    id: "evt:episode:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:00:30.000Z",
    type: "task.updated",
    source: { id: "session:1", kind: "claude-code" },
    title: "Config sync blocked",
    summary: "config.ts",
    status: "blocked",
  });

  const attentionView = core.getAttentionView();
  assert.equal(attentionView.now?.taskId, "task:blocker");
  assert.equal(attentionView.next.length, 1);
  assert.equal(attentionView.next[0]?.taskId, "task:episode:b");
  assert.equal(attentionView.ambient.length, 0);
});

test("completed episode tasks retire their episode identity before related work returns", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:active",
    taskId: "task:active",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:active",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publish({
    id: "evt:next:first",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:20.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:a",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fix",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
  });

  const firstQueued = core.getAttentionView().next[0];
  assert.ok(firstQueued);
  if (!firstQueued) {
    return;
  }

  core.publish({
    id: "evt:complete",
    taskId: "task:episode:a",
    timestamp: "2026-03-08T12:00:40.000Z",
    type: "task.completed",
    summary: "Handled.",
  });

  core.publish({
    id: "evt:next:second",
    taskId: "task:episode:b",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:episode:b",
    source: { id: "session:1", kind: "claude-code" },
    title: "Choose config fallback",
    summary: "config.ts",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "fallback", label: "Fallback" }],
    },
  });

  const reopenedQueued = core.getAttentionView().next[0];
  assert.ok(reopenedQueued);
  if (!reopenedQueued) {
    return;
  }

  assert.notEqual(readFrameEpisodeId(reopenedQueued), readFrameEpisodeId(firstQueued));
  assert.equal(reopenedQueued.metadata?.episode?.size, 1);
});

test("completed tasks clear ambient-only task state", () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:ambient",
    taskId: "task:ambient",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    source: { id: "custom-agent:vps", kind: "custom-agent" },
    title: "Remote approval needed",
    summary: "A remote agent needs a human decision.",
    status: "blocked",
  });

  assert.ok(core.getAttentionView().now);

  core.publish({
    id: "evt:complete",
    taskId: "task:ambient",
    timestamp: "2026-03-08T12:00:10.000Z",
    type: "task.completed",
    summary: "Handled.",
  });

  assert.equal(core.getAttentionView().now, null);
  assert.equal(core.getTaskView("task:ambient").ambient.length, 0);
});

test("same-interaction status updates can demote a now frame into ambient", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:blocked",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    title: "Claude is waiting for follow-up",
    summary: "A follow-up question needs input.",
    status: "blocked",
  });

  assert.equal(core.getAttentionView().now?.title, "Claude is waiting for follow-up");

  core.publish({
    id: "evt:running",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:01.000Z",
    type: "task.updated",
    title: "Read completed",
    summary: "Read completed successfully.",
    status: "running",
  });

  assert.equal(core.getAttentionView().now, null);
  assert.equal(core.getAttentionView().ambient[0]?.title, "Read completed");

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "ambient");
  assert.equal(candidateTrace.coordination.resultLane, "ambient");
});

test("committed bucket matches queued routing under operator absence", () => {
  const core = new ApertureCore({ operatorPresence: "absent" });
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:approval",
    taskId: "task:approval",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:approval",
    title: "Approve deploy",
    summary: "A deploy needs approval.",
    request: { kind: "approval" },
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "next");
  assert.equal(core.getAttentionView().next[0]?.interactionId, "interaction:approval");
});

test("committed bucket matches ambient routing for passive status", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:status",
    taskId: "task:status",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "task.updated",
    title: "Read completed",
    summary: "Read completed successfully.",
    toolFamily: "read",
    activityClass: "tool_completion",
    status: "running",
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "ambient");
  assert.equal(candidateTrace.coordination.resultLane, "ambient");
  assert.equal(core.getAttentionView().now, null);
  assert.equal(core.getAttentionView().ambient[0]?.interactionId, "interaction:task:status:status");
});

test("blocked-like waiting statuses become queue-worthy without changing status routing", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:blocking-next",
    type: "task.updated",
    taskId: "task:status:blocking-next",
    timestamp: "2026-03-28T10:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
  });

  const candidateTrace = traces.findLast((trace) => trace.evaluation.kind === "candidate");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "now");
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:task:status:blocking-next:status");
  assert.equal(core.getTaskView("task:status:blocking-next").next[0]?.interactionId, "interaction:task:status:blocking-next:status");
  assert.equal(core.getAttentionView().ambient.length, 0);
});

test("low-confidence blocked-like waiting stays queued behind active now work", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:anchor:low-confidence-blocked-like",
    type: "human.input.requested",
    taskId: "task:anchor:low-confidence-blocked-like",
    interactionId: "interaction:anchor:low-confidence-blocked-like",
    timestamp: "2026-03-28T10:00:00.000Z",
    title: "Approve deploy",
    summary: "A deploy is waiting for approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:status:low-confidence-blocked-like",
    type: "task.updated",
    taskId: "task:status:low-confidence-blocked-like",
    timestamp: "2026-03-28T10:00:10.000Z",
    source: { id: "custom-agent" },
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
    semanticHints: {
      confidence: "low",
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.event.id === "src:status:low-confidence-blocked-like");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "next");
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:anchor:low-confidence-blocked-like");
  assert.equal(
    core.getTaskView("task:status:low-confidence-blocked-like").next[0]?.interactionId,
    "interaction:task:status:low-confidence-blocked-like:status",
  );
  assert.deepEqual(candidateTrace.semantic?.impact.decisionBearing, [
    "activity (canonical)",
    "blocking (peripheral routing)",
    "confidence (ambiguity)",
  ]);
  assert.equal(core.getAttentionView().ambient.length, 0);
});

test("abstained blocked-like waiting stays queued behind active now work", () => {
  const core = new ApertureCore();
  const traces: PublicApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publish({
    id: "evt:anchor:abstained-blocked-like",
    type: "human.input.requested",
    taskId: "task:anchor:abstained-blocked-like",
    interactionId: "interaction:anchor:abstained-blocked-like",
    timestamp: "2026-03-28T10:00:00.000Z",
    title: "Approve deploy",
    summary: "A deploy is waiting for approval.",
    consequence: "high",
    request: { kind: "approval" },
  });

  core.publishSourceEvent({
    id: "src:status:abstained-blocked-like",
    type: "task.updated",
    taskId: "task:status:abstained-blocked-like",
    timestamp: "2026-03-28T10:00:10.000Z",
    source: { id: "custom-agent" },
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
    semanticHints: {
      abstained: true,
    },
  });

  const candidateTrace = traces.findLast((trace) => trace.event.id === "src:status:abstained-blocked-like");
  assert.ok(candidateTrace);
  if (!candidateTrace || candidateTrace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(candidateTrace.coordination.kind, "queue");
  assert.equal(candidateTrace.coordination.resultLane, "next");
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:anchor:abstained-blocked-like");
  assert.equal(
    core.getTaskView("task:status:abstained-blocked-like").next[0]?.interactionId,
    "interaction:task:status:abstained-blocked-like:status",
  );
  assert.deepEqual(candidateTrace.semantic?.impact.decisionBearing, [
    "activity (canonical)",
    "blocking (peripheral routing)",
    "abstention (ambiguity)",
  ]);
  assert.equal(core.getAttentionView().ambient.length, 0);
});
