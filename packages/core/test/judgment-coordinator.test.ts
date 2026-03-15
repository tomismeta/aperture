import test from "node:test";
import assert from "node:assert/strict";

import type { Frame } from "../src/index.js";

import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import type { AttentionView } from "../src/frame.js";
import { AttentionPolicy } from "../src/attention-policy.js";
import type { AttentionPressure } from "../src/attention-pressure.js";
import { AttentionPlanner } from "../src/attention-planner.js";
import { AttentionValue } from "../src/attention-value.js";

const coordinator = new JudgmentCoordinator();

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

function createAttentionPressure(overrides: Partial<AttentionPressure> = {}): AttentionPressure {
  return {
    level: "elevated",
    overloadRisk: "rising",
    score: 3,
    metrics: {
      recentDemand: 5,
      interruptiveVisible: 1,
      averageResponseLatencyMs: 9_000,
      deferredCount: 2,
      suppressedCount: 1,
      ...(overrides.metrics ?? {}),
    },
    reasons: ["incoming demand is climbing"],
    ...overrides,
  };
}

test("activates a candidate when nothing is active", () => {
  const decision = coordinator.coordinate(null, createCandidate());
  assert.equal(decision.kind, "activate");
});

test("queues ambiguous non-blocking work when the surface is empty", () => {
  const decision = coordinator.coordinate(
    null,
    createCandidate({
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
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

test("falls back to queue when a surface cannot render ambient work", () => {
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
    {
      surfaceCapabilities: {
        topology: {
          supportsAmbient: false,
        },
        responses: {
          supportsSingleChoice: true,
          supportsMultipleChoice: false,
          supportsForm: true,
          supportsTextResponse: false,
        },
      },
    },
  );

  assert.equal(decision.kind, "queue");
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

test("keeps narrow score gains queued instead of stealing focus immediately", () => {
  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "ambient",
      consequence: "medium",
      responseSpec: { kind: "none" },
    }),
    createCandidate({
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("explanation marks ambiguity when low-signal work stays peripheral", () => {
  const explanation = coordinator.explain(
    null,
    createCandidate({
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(explanation.decision.kind, "queue");
  assert.deepEqual(explanation.ambiguity, {
    kind: "interrupt",
    reason: "low_signal",
    resolution: "queue",
  });
  assert.ok(explanation.reasons.includes("uncertain interruptive work stays peripheral until its signal is stronger"));
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

test("keeps low-value status ambient when urgent backlog is already present", () => {
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

  assert.equal(decision.kind, "ambient");
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

test("queues context-heavy work until it clearly outranks current work", () => {
  const contextAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        toolFamilies: {
          bash: {
            presentations: 5,
            responses: 3,
            dismissals: 0,
            contextExpansionRate: 0.7,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = contextAwareCoordinator.coordinate(
    createFrame({
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timing: {
        createdAt: "2026-03-08T12:00:00.000Z",
        updatedAt: "2026-03-08T12:00:00.000Z",
      },
    }),
    createCandidate({
      mode: "approval",
      toolFamily: "bash",
      title: "Run deployment cleanup",
      summary: "Shell command will remove stale build artifacts",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
  );

  assert.equal(decision.kind, "queue");
});

test("keeps deferred-returning work queued during pressure instead of ambient", () => {
  const memoryAwareCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        toolFamilies: {
          bash: {
            presentations: 5,
            responses: 3,
            dismissals: 0,
            returnAfterDeferralRate: 0.8,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = memoryAwareCoordinator.coordinate(
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
      toolFamily: "bash",
      title: "Run deploy command",
      summary: "Operator usually comes back to these after deferring",
      mode: "approval",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
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

test("keeps low consequence work queued during pressure when calibration says the band is understated", () => {
  const calibratedCoordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue({
      memoryProfile: {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
        consequenceProfiles: {
          low: {
            rejectionRate: 0.6,
            reviewedCount: 8,
          },
        },
      },
    }),
    new AttentionPlanner(),
  );

  const decision = calibratedCoordinator.coordinate(
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
      consequence: "low",
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

test("preemptively suppresses low-value status when pressure is rising", () => {
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
      taskId: "task:incoming",
      interactionId: "interaction:incoming",
      mode: "status",
      tone: "ambient",
      consequence: "low",
      priority: "background",
      blocking: false,
      responseSpec: { kind: "none" },
    }),
    {
      pressureForecast: createAttentionPressure(),
    },
  );

  assert.equal(decision.kind, "ambient");
});
