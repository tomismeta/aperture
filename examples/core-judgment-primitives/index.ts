import assert from "node:assert/strict";

import {
  AttentionPlanner,
  AttentionPolicy,
  AttentionValue,
  JudgmentCoordinator,
  forecastAttentionPressure,
} from "@tomismeta/aperture-core";

const coordinator = new JudgmentCoordinator(
  new AttentionPolicy(),
  new AttentionValue({
    memoryProfile: {
      version: 1,
      operatorId: "sdk-example",
      updatedAt: "2026-03-13T18:00:00.000Z",
      sessionCount: 2,
      toolFamilies: {
        read: {
          presentations: 6,
          responses: 6,
          dismissals: 0,
          avgResponseLatencyMs: 1200,
        },
      },
    },
  }),
  new AttentionPlanner(),
);

const explanation = coordinator.explain(null, {
  taskId: "task:review",
  interactionId: "interaction:read:manifest",
  source: {
    id: "claude-session",
    kind: "claude-code",
  },
  toolFamily: "read",
  mode: "approval",
  tone: "focused",
  consequence: "low",
  title: "Read package.json",
  summary: "The agent wants to inspect package.json before proposing a dependency change.",
  responseSpec: {
    kind: "approval",
    actions: [
      { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
      { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
    ],
  },
  priority: "normal",
  blocking: true,
  timestamp: "2026-03-13T18:00:00.000Z",
}, {
  pressureForecast: forecastAttentionPressure(undefined, undefined),
});

assert.equal(explanation.policy.minimumPresentation, "active");
assert.equal(explanation.decision.kind, "activate");
assert.ok(explanation.utility.components.responseAffinity > 0);
assert.match(
  explanation.utility.rationale.join(" "),
  /usually resolves quickly/,
);

console.log("judgment primitive example passed");
