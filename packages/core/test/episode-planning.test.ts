import test from "node:test";
import assert from "node:assert/strict";

import type { AttentionView } from "../src/frame.js";
import type { Frame } from "../src/frame.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { JudgmentCoordinator } from "../src/judgment-coordinator.js";

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
    episodeEvidenceScore: 0,
    episodeEvidenceReasons: [],
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
        evidenceScore: 4,
        evidenceReasons: ["operator-facing work makes this episode immediately actionable"],
        lastInteractionId: "interaction:current",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    },
    ...overrides,
  };
}

test("same-episode status stays bundled with the active blocking episode", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(createFrame(), createCandidate());

  assert.equal(explanation.decision.kind, "ambient");
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "same_episode")?.kind,
    "override",
  );
});

test("same episode can promote a new blocking step over a status frame", () => {
  const coordinator = new JudgmentCoordinator();
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

test("same episode can promote a superseding blocking step over active blocking work", () => {
  const coordinator = new JudgmentCoordinator();
  const decision = coordinator.coordinate(
    createFrame({
      interactionId: "interaction:current-step",
      title: "Approve deployment step",
      metadata: {
        episode: {
          id: "episode:shared",
          key: "claude-code:interruptive:issue:deploy:prod",
          state: "actionable",
          size: 2,
          evidenceScore: 5,
          evidenceReasons: ["operator-facing work makes this episode immediately actionable"],
          lastInteractionId: "interaction:current-step",
          updatedAt: "2026-03-08T12:00:00.000Z",
        },
      },
    }),
    createCandidate({
      interactionId: "interaction:superseding-step",
      title: "Approve rollback instead",
      mode: "approval",
      blocking: true,
      priority: "high",
      relationHints: [{ kind: "same_issue", target: "issue:deploy:prod" }, { kind: "supersedes" }],
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
      episodeState: "actionable",
      episodeKey: "claude-code:interruptive:issue:deploy:prod",
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("visible queued episode work batches new related interactions with no active task frame", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(null, createCandidate({
    episodeState: "batched",
  }), {
    attentionView: {
      now: null,
      next: [
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
              evidenceScore: 1,
              evidenceReasons: ["multiple related interactions have accumulated in this episode"],
              lastInteractionId: "interaction:queued",
              updatedAt: "2026-03-08T12:00:30.000Z",
            },
          },
        }),
      ],
      ambient: [],
    } satisfies AttentionView,
  });

  assert.equal(explanation.decision.kind, "queue");
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "visible_episode")?.kind,
    "override",
  );
});

test("repeated same-episode resurfacing can break visible bundling and compete for focus", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(
    createFrame({
      id: "frame:unrelated",
      taskId: "task:other-current",
      interactionId: "interaction:other-current",
      mode: "status",
      responseSpec: { kind: "none" },
      metadata: {
        episode: {
          id: "episode:other",
          key: "claude-code:interruptive:/workspace/other.ts",
          state: "waiting",
          size: 1,
          evidenceScore: 0,
          evidenceReasons: [],
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
        now: createFrame({
          id: "frame:other-active",
          taskId: "task:other-current",
          interactionId: "interaction:other-current",
          mode: "status",
          responseSpec: { kind: "none" },
          metadata: {
            episode: {
              id: "episode:other",
              key: "claude-code:interruptive:/workspace/other.ts",
              state: "waiting",
              size: 1,
              evidenceScore: 0,
              evidenceReasons: [],
              lastInteractionId: "interaction:other-current",
              updatedAt: "2026-03-08T12:00:00.000Z",
            },
          },
        }),
        next: [
          createFrame({
            taskId: "task:episode:queued",
            interactionId: "interaction:queued",
            mode: "status",
            responseSpec: { kind: "none" },
            metadata: {
              episode: {
                id: "episode:shared",
                key: "claude-code:interruptive:/workspace/config.ts",
                state: "batched",
                size: 2,
                evidenceScore: 1,
                evidenceReasons: ["multiple related interactions have accumulated in this episode"],
                lastInteractionId: "interaction:queued",
                updatedAt: "2026-03-08T12:00:30.000Z",
              },
            },
          }),
        ],
        ambient: [],
      } satisfies AttentionView,
      continuitySignalSummary: {
        recentSignals: 4,
        lifetimeSignals: 4,
        counts: {
          presented: 1,
          viewed: 0,
          responded: 0,
          dismissed: 0,
          deferred: 0,
          contextExpanded: 0,
          contextSkipped: 0,
          timedOut: 0,
          returned: 2,
          attentionShifted: 0,
        },
        deferred: {
          next: 0,
          suppressed: 0,
          manual: 0,
        },
        responseRate: 0,
        dismissalRate: 0,
        averageResponseLatencyMs: null,
        averageDismissalLatencyMs: null,
        lastSignalAt: "2026-03-08T12:00:35.000Z",
      },
    },
  );

  assert.equal(explanation.decision.kind, "activate");
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "visible_episode")?.kind,
    "noop",
  );
  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "deferral_escalation")?.kind,
    "override",
  );
});

test("resolved episode metadata does not keep same-episode continuity alive", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(
    createFrame({
      metadata: {
        episode: {
          id: "episode:shared",
          key: "claude-code:interruptive:/workspace/config.ts",
          state: "resolved",
          size: 2,
          evidenceScore: 4,
          evidenceReasons: ["operator-facing work makes this episode immediately actionable"],
          lastInteractionId: "interaction:current",
          updatedAt: "2026-03-08T12:00:00.000Z",
        },
      },
    }),
    createCandidate(),
  );

  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "same_episode")?.kind,
    "noop",
  );
});

test("stale episode metadata does not keep same-episode continuity alive", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(
    createFrame({
      metadata: {
        episode: {
          id: "episode:shared",
          key: "claude-code:interruptive:/workspace/config.ts",
          state: "stale",
          size: 2,
          evidenceScore: 4,
          evidenceReasons: ["multiple related interactions accumulated before this episode went quiet"],
          lastInteractionId: "interaction:current",
          updatedAt: "2026-03-08T12:00:00.000Z",
        },
      },
    }),
    createCandidate(),
  );

  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "same_episode")?.kind,
    "noop",
  );
});

test("stale visible episode metadata does not keep visible bundling alive", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(null, createCandidate({
    episodeState: "batched",
  }), {
    attentionView: {
      now: null,
      next: [
        createFrame({
          taskId: "task:other",
          interactionId: "interaction:queued",
          mode: "status",
          responseSpec: { kind: "none" },
          metadata: {
            episode: {
              id: "episode:shared",
              key: "claude-code:interruptive:/workspace/config.ts",
              state: "stale",
              size: 2,
              evidenceScore: 1,
              evidenceReasons: ["multiple related interactions accumulated before this episode went quiet"],
              lastInteractionId: "interaction:queued",
              updatedAt: "2026-03-08T11:00:00.000Z",
            },
          },
        }),
      ],
      ambient: [],
    } satisfies AttentionView,
  });

  assert.equal(
    explanation.continuityEvaluations?.find((evaluation) => evaluation.rule === "visible_episode"),
    undefined,
  );
  assert.equal(explanation.decision.kind, "ambient");
});

test("visible queued episode work stays bundled even when unrelated current work is active", () => {
  const coordinator = new JudgmentCoordinator();
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
                evidenceScore: 4,
                evidenceReasons: ["operator-facing work makes this episode immediately actionable"],
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
        now: createFrame({
          id: "frame:other-active",
          taskId: "task:other-current",
          interactionId: "interaction:other-current",
          metadata: {
            episode: {
              id: "episode:other",
              key: "claude-code:interruptive:/workspace/other.ts",
                state: "actionable",
                size: 1,
                evidenceScore: 4,
                evidenceReasons: ["operator-facing work makes this episode immediately actionable"],
                lastInteractionId: "interaction:other-current",
                updatedAt: "2026-03-08T12:00:00.000Z",
              },
          },
        }),
        next: [
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
                evidenceScore: 1,
                evidenceReasons: ["multiple related interactions have accumulated in this episode"],
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

test("actionable episode evidence can activate non-blocking work when nothing is active", () => {
  const coordinator = new JudgmentCoordinator();
  const decision = coordinator.coordinate(null, createCandidate({
    mode: "choice",
    consequence: "high",
    responseSpec: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
    episodeState: "actionable",
    episodeEvidenceScore: 5,
    episodeEvidenceReasons: ["high-signal evidence is stacking up across the episode"],
  }));

  assert.equal(decision.kind, "activate");
});

test("actionable episode evidence stays queued under high pressure", () => {
  const coordinator = new JudgmentCoordinator();
  const decision = coordinator.coordinate(null, createCandidate({
    mode: "choice",
    consequence: "high",
    responseSpec: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "retry", label: "Retry" }],
    },
    episodeState: "actionable",
    episodeEvidenceScore: 5,
    episodeEvidenceReasons: ["high-signal evidence is stacking up across the episode"],
  }), {
    pressureForecast: {
      level: "high",
      overloadRisk: "high",
      score: 7,
      metrics: {
        recentDemand: 8,
        interruptiveVisible: 2,
        averageResponseLatencyMs: 15_000,
        deferredCount: 4,
        suppressedCount: 2,
      },
      reasons: ["incoming demand is arriving quickly"],
    },
  });

  assert.equal(decision.kind, "queue");
});
