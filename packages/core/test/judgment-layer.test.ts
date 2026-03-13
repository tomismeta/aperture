import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "../src/aperture-core.js";
import { serializeFrontmatter } from "../src/markdown-frontmatter.js";
import type { Frame } from "../src/frame.js";
import type { InteractionCandidate } from "../src/interaction-candidate.js";
import { InteractionCoordinator } from "../src/interaction-coordinator.js";
import { PolicyGates } from "../src/policy-gates.js";
import { UtilityScore } from "../src/utility-score.js";

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

test("policy gates keep background work ambient by default", () => {
  const gates = new PolicyGates();
  const verdict = gates.evaluate(createCandidate());

  assert.deepEqual(verdict, {
    mayInterrupt: false,
    requiresOperatorResponse: false,
    minimumPresentation: "ambient",
    rationale: ["background work should remain peripheral by default"],
  });
});

test("utility score exposes componentized candidate scoring", () => {
  const utility = new UtilityScore().scoreCandidate(
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
    learnedAdjustment: 5,
  });
  assert.deepEqual(utility.rationale, ["history suggests this resolves quickly"]);
});

test("utility score applies durable source trust from memory", () => {
  const utility = new UtilityScore({
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
  assert.equal(utility.components.learnedAdjustment, -7);
  assert.ok(utility.rationale.includes("durable source trust adjusts this interaction's utility"));
});

test("coordinator explanations surface policy and utility alongside planning", () => {
  const coordinator = new InteractionCoordinator();
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

test("policy gates apply user overrides for tool families", () => {
  const gates = new PolicyGates({
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

  const verdict = gates.evaluate(
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

  assert.equal(verdict.minimumPresentation, "ambient");
  assert.ok(verdict.rationale.includes("user override applies for read interactions"));
});

test("markdown-backed core can keep configured low-risk reads ambient with no active frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-core-markdown-"));
  await writeFile(
    join(root, "USER.md"),
    serializeFrontmatter(
      {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
      },
      "Explicit operator preferences.",
    ),
    "utf8",
  );
  await writeFile(
    join(root, "MEMORY.md"),
    serializeFrontmatter(
      {
        version: 1,
        operatorId: "default",
        updatedAt: "2026-03-12T10:15:00.000Z",
        sessionCount: 1,
      },
      "Durable learned summaries.",
    ),
    "utf8",
  );
  await writeFile(
    join(root, "JUDGMENT.md"),
    serializeFrontmatter(
      {
        version: 1,
        updatedAt: "2026-03-12T10:15:00.000Z",
        policy: {
          lowRiskRead: {
            mayInterrupt: false,
            minimumPresentation: "ambient",
          },
        },
      },
      "Explicit attention policy.",
    ),
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
  assert.equal(taskView.ambient[0]?.interactionId, "interaction:read");
});
