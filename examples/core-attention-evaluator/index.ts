import assert from "node:assert/strict";

import {
  ATTENTION_DECISION_RECORD_SCHEMA_VERSION,
  evaluateAttention,
  type AttentionClaim,
} from "@tomismeta/aperture-core/evaluator";

const claim: AttentionClaim = {
  taskId: "task:review",
  interactionId: "interaction:read:manifest",
  source: {
    id: "codex-session",
    kind: "codex",
  },
  toolFamily: "read",
  activityClass: "permission_request",
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
};

const record = evaluateAttention({
  claim,
  now: "2026-03-13T18:00:00.000Z",
  config: {
    policyConfig: {
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    },
  },
});

assert.equal(record.schemaVersion, ATTENTION_DECISION_RECORD_SCHEMA_VERSION);
assert.equal(record.claim.timestamp, "2026-03-13T18:00:00.000Z");
assert.equal(record.evaluatedAt, "2026-03-13T18:00:00.000Z");
assert.equal(record.planning.route, "auto_approve");
assert.equal(record.planning.plannedLane, "none");
assert.equal(record.decision.kind, "auto_approve");
assert.equal("realizedLane" in record.planning, false);

console.log("attention evaluator example passed");
