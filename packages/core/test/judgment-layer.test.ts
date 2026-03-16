import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "../src/aperture-core.js";
import { serializeJudgmentConfig } from "../src/judgment-config.js";
import type { Frame } from "../src/frame.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import { AttentionPolicy } from "../src/attention-policy.js";
import { AttentionPlanner } from "../src/attention-planner.js";
import { AttentionValue } from "../src/attention-value.js";

function createCandidate(overrides: Partial<InteractionCandidate> = {}): InteractionCandidate {
  return {
    taskId: "task:test",
    interactionId: "interaction:test",
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Background update",
    responseSpec: { kind: "none" },
    priority: "background",
    blocking: false,
    timestamp: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame:test",
    taskId: "task:test",
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
    ...overrides,
  };
}

test("attention policy keeps background work ambient by default", () => {
  const gates = new AttentionPolicy();
  const verdict = gates.evaluateGates(createCandidate());

  assert.deepEqual(verdict, {
    autoApprove: false,
    mayInterrupt: false,
    requiresOperatorResponse: false,
    minimumPresentation: "ambient",
    rationale: ["background work should remain peripheral by default"],
  });
});

test("attention value exposes componentized candidate scoring", () => {
  const utility = new AttentionValue().scoreCandidate(
    createCandidate({
      priority: "normal",
      tone: "focused",
      consequence: "medium",
      attentionScoreOffset: 5,
      attentionRationale: ["history suggests this resolves quickly"],
    }),
  );

  assert.equal(utility.total, 116);
  assert.deepEqual(utility.components, {
    priority: 100,
    consequence: 10,
    tone: 1,
    blocking: 0,
    heuristics: 5,
    sourceTrust: 0,
    consequenceCalibration: 0,
    responseAffinity: 0,
    contextCost: 0,
    deferralAffinity: 0,
  });
  assert.deepEqual(utility.rationale, ["history suggests this resolves quickly"]);
});

test("attention value applies durable source trust from memory", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      sourceTrust: {
        "claude-code": {
          low: {
            confirmations: 3,
            disagreements: 2,
            trustAdjustment: -7,
          },
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      source: { id: "session:1", kind: "claude-code" },
      priority: "normal",
    }),
  );

  assert.equal(utility.total, 93);
  assert.equal(utility.components.sourceTrust, -7);
  assert.ok(utility.rationale.includes("durable source trust adjusts this interaction's utility"));
});

test("attention value boosts low consequence work when that band is often rejected", () => {
  const utility = new AttentionValue({
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
  }).scoreCandidate(
    createCandidate({
      priority: "normal",
      consequence: "low",
      mode: "status",
      blocking: false,
    }),
  );

  assert.equal(utility.components.consequenceCalibration, 8);
  assert.ok(utility.rationale.includes("memory suggests this consequence band is often understated and deserves more attention"));
});

test("attention value tempers high consequence work when that band is often rejected", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      consequenceProfiles: {
        high: {
          rejectionRate: 0.5,
          reviewedCount: 8,
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      priority: "high",
      consequence: "high",
      mode: "approval",
      blocking: false,
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(utility.components.consequenceCalibration, -4);
  assert.ok(utility.rationale.includes("memory suggests this consequence band is often overstated and should be tempered"));
});

test("attention value ignores low-sample tool family memory", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      toolFamilies: {
        read: {
          presentations: 1,
          responses: 1,
          dismissals: 0,
          avgResponseLatencyMs: 900,
        },
      },
      consequenceProfiles: {
        low: {
          rejectionRate: 1,
          reviewedCount: 1,
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      priority: "normal",
      mode: "approval",
      blocking: true,
      title: "Claude Code wants to read config.ts",
      summary: "config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(utility.components.responseAffinity, 0);
  assert.equal(utility.components.consequenceCalibration, 0);
});

test("attention value boosts quick-response tool families from memory", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      toolFamilies: {
        read: {
          presentations: 10,
          responses: 10,
          dismissals: 0,
          avgResponseLatencyMs: 1500,
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      mode: "approval",
      blocking: true,
      priority: "normal",
      title: "Claude Code wants to read config.ts",
      summary: "config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(utility.components.responseAffinity, 8);
  assert.ok(utility.rationale.includes("memory suggests this kind of interaction usually resolves quickly"));
});

test("attention value penalizes high context-cost tool families from memory", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      toolFamilies: {
        bash: {
          presentations: 8,
          responses: 5,
          dismissals: 0,
          contextExpansionRate: 0.75,
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      mode: "approval",
      blocking: true,
      priority: "high",
      title: "Claude Code wants to run a shell command",
      summary: "rm -rf build",
      consequence: "high",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(utility.components.contextCost, -6);
  assert.ok(utility.rationale.includes("memory suggests this interaction usually needs extra context before action"));
});

test("attention value boosts tool families that commonly return after deferral", () => {
  const utility = new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 1,
      toolFamilies: {
        read: {
          presentations: 10,
          responses: 6,
          dismissals: 0,
          returnAfterDeferralRate: 0.7,
        },
      },
    },
  }).scoreCandidate(
    createCandidate({
      mode: "approval",
      blocking: true,
      priority: "normal",
      title: "Claude Code wants to read settings.ts",
      summary: "settings.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(utility.components.deferralAffinity, 6);
  assert.ok(utility.rationale.includes("memory suggests deferred interactions of this kind are usually resumed"));
});

test("judgment coordinator explanations surface attention policy and attention value alongside planning", () => {
  const coordinator = new JudgmentCoordinator();
  const explanation = coordinator.explain(
    createFrame(),
    createCandidate({
      interactionId: "interaction:new",
      priority: "normal",
      tone: "focused",
      consequence: "medium",
    }),
  );

  assert.equal(explanation.policy.minimumPresentation, "ambient");
  assert.equal(explanation.utility.total, 111);
  assert.equal(explanation.decision.kind, "ambient");
  assert.match(explanation.reasons[0] ?? "", /blocking work keeps non-blocking updates in the periphery/);
});

test("attention policy applies user overrides for tool families", () => {
  const gates = new AttentionPolicy({
    userProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      overrides: {
        tools: {
          read: {
            defaultPresentation: "ambient",
          },
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      source: { id: "session:1", kind: "claude-code" },
      mode: "approval",
      blocking: true,
      title: "Claude Code wants to read config.ts",
      summary: "config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.autoApprove, false);
  assert.equal(verdict.minimumPresentation, "active");
  assert.equal(verdict.mayInterrupt, true);
  assert.ok(verdict.rationale.includes("user override applies for read interactions"));
  assert.ok(verdict.rationale.includes("operator-response work cannot remain passive without auto-resolution"));
});

test("attention policy prefers explicit tool family metadata over title heuristics", () => {
  const gates = new AttentionPolicy({
    userProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      overrides: {
        tools: {
          read: {
            defaultPresentation: "ambient",
          },
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: true,
      toolFamily: "read",
      title: "Need your eyes on this",
      summary: "Review the latest config access",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.autoApprove, false);
  assert.equal(verdict.minimumPresentation, "active");
  assert.equal(verdict.mayInterrupt, true);
  assert.ok(verdict.rationale.includes("user override applies for read interactions"));
  assert.ok(verdict.rationale.includes("operator-response work cannot remain passive without auto-resolution"));
});

test("configured lowRiskRead policy can auto-approve bounded approvals", () => {
  const gates = new AttentionPolicy({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: true,
      consequence: "low",
      title: "Claude Code wants to read config.ts",
      summary: "config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.autoApprove, true);
  assert.equal(verdict.requiresOperatorResponse, false);
  assert.equal(verdict.mayInterrupt, false);
  assert.ok(verdict.rationale.includes("configured judgment policy auto-approves this bounded approval"));
});

test("configured lowRiskWeb policy can auto-approve bounded web approvals", () => {
  const gates = new AttentionPolicy({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskWeb: {
          autoApprove: true,
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: true,
      consequence: "low",
      toolFamily: "web",
      title: "Claude Code wants to search the web",
      summary: "Search for API docs",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.autoApprove, true);
  assert.equal(verdict.requiresOperatorResponse, false);
  assert.equal(verdict.mayInterrupt, false);
});

test("configured lowRiskRead policy does not match incidental reading language", () => {
  const gates = new AttentionPolicy({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: true,
      consequence: "low",
      title: "Already reading prior output",
      summary: "Waiting for the next operator step",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.minimumPresentation, "active");
  assert.ok(verdict.rationale.includes("blocking interactions require explicit operator attention"));
});

test("configured judgment policy can require context expansion", () => {
  const gates = new AttentionPolicy({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        envWrite: {
          mayInterrupt: true,
          minimumPresentation: "active",
          requireContextExpansion: true,
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: false,
      consequence: "medium",
      title: "Claude Code wants to write .env",
      summary: "Update API token",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.minimumPresentation, "active");
  assert.equal(verdict.requiresOperatorResponse, true);
  assert.ok(verdict.rationale.includes("configured judgment policy applies to this interaction"));
});

test("configured fileWrite policy keeps writes interruptive", () => {
  const gates = new AttentionPolicy({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        fileWrite: {
          mayInterrupt: true,
          minimumPresentation: "active",
        },
      },
    },
  });

  const verdict = gates.evaluateGates(
    createCandidate({
      mode: "approval",
      blocking: false,
      consequence: "medium",
      toolFamily: "write",
      title: "Claude Code wants to write config.ts",
      summary: "Update config.ts",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
  );

  assert.equal(verdict.autoApprove, false);
  assert.equal(verdict.minimumPresentation, "active");
  assert.equal(verdict.requiresOperatorResponse, true);
});

test("markdown-backed core can auto-approve low-risk read approvals", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-core-markdown-"));
  await writeFile(
    join(root, "USER.md"),
    [
      "# User",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 1",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "JUDGMENT.md"),
    serializeJudgmentConfig({
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    }),
    "utf8",
  );

  const core = await ApertureCore.fromMarkdown(root);
  core.publish({
    id: "event:1",
    type: "human.input.requested",
    taskId: "task:read",
    interactionId: "interaction:read",
    timestamp: "2026-03-12T10:15:00.000Z",
    source: { id: "session:1", kind: "claude-code" },
    title: "Claude Code wants to read config.ts",
    summary: "config.ts",
    consequence: "low",
    request: { kind: "approval" },
  });

  const taskView = core.getTaskView("task:read");
  assert.equal(taskView.active, null);
  assert.equal(core.getSignals("task:read")[0]?.kind, "responded");
});

test("planner defaults can disable burst batching", () => {
  const coordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        batchStatusBursts: false,
      },
    }),
  );

  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:test",
      interactionId: "interaction:current",
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
      taskId: "task:test",
      interactionId: "interaction:new",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      priority: "normal",
      blocking: false,
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:00:30.000Z",
    }),
  );

  assert.equal(decision.kind, "activate");
});

test("planner defaults can disable pressure-based suppression", () => {
  const coordinator = new JudgmentCoordinator(
    new AttentionPolicy(),
    new AttentionValue(),
    new AttentionPlanner({
      plannerDefaults: {
        deferLowValueDuringPressure: false,
      },
    }),
  );

  const decision = coordinator.coordinate(
    createFrame({
      taskId: "task:current",
      interactionId: "interaction:current",
      mode: "status",
      tone: "ambient",
      consequence: "low",
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
      },
    },
  );

  assert.equal(decision.kind, "activate");
});
