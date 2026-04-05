import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionJudgmentInput,
  hasBlockedLikeStatusSemantics,
  readSemanticEvidenceStrength,
  resolvePeripheralResolutionFloor,
} from "../src/judgment-input.js";

const timestamp = "2026-04-05T18:30:00.000Z";

test("judgment input compiles blocked-like waiting statuses into one internal seam", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:blocked-like",
    taskId: "task:judgment-input:blocked-like",
    timestamp,
    type: "task.updated",
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
    semantic: {
      intentFrame: "blocked_work",
      activityClass: "status_update",
      consequence: "low",
      whyNow: "Work is blocked and may require operator attention.",
      factors: ["task.updated", "waiting", "semantic blocking signal"],
      relationHints: [],
      confidence: "medium",
      reasons: ["status wording indicates work cannot continue yet"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, true);
  assert.equal(input.ontology?.blocking, "blocking");
  assert.equal(input.semanticEvidence?.strength, "weak");
});

test("judgment input gives explicit human-input semantics a strong evidence read", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:approval",
    taskId: "task:judgment-input:approval",
    interactionId: "interaction:judgment-input:approval",
    timestamp,
    type: "human.input.requested",
    title: "Approve production deploy",
    summary: "Deploy the prepared release to production.",
    request: { kind: "approval" },
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "high",
      whyNow: "High-consequence deploy needs explicit approval.",
      factors: ["human.input.requested", "approval"],
      relationHints: [],
      confidence: "high",
      reasons: ["request kind establishes an explicit operator decision point"],
      provenance: {
        intentFrame: "source",
        activityClass: "source",
        consequence: "source",
        whyNow: "source",
        confidence: "source",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, false);
  assert.equal(input.semanticEvidence?.source, "explicit");
  assert.equal(input.semanticEvidence?.strength, "strong");
});

test("judgment-input helpers preserve the blocked-like status peripheral floor", () => {
  const candidate = {
    taskId: "task:blocked-like",
    interactionId: "interaction:blocked-like",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "Cannot continue until credentials are provided",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: buildAttentionJudgmentInput({
      id: "evt:judgment-input:blocked-like-floor",
      taskId: "task:blocked-like",
      timestamp,
      type: "task.updated",
      title: "Cannot continue until credentials are provided",
      summary: "Work is waiting but cannot proceed until the operator provides credentials.",
      status: "waiting",
      semantic: {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        consequence: "low",
        whyNow: "Work is blocked and may require operator attention.",
        factors: ["task.updated", "waiting", "semantic blocking signal"],
        relationHints: [],
        confidence: "medium",
        reasons: ["status wording indicates work cannot continue yet"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          whyNow: "inferred",
          confidence: "inferred",
        },
      },
    }),
  };

  assert.equal(hasBlockedLikeStatusSemantics(candidate), true);
  assert.equal(readSemanticEvidenceStrength(candidate), "weak");
  assert.equal(resolvePeripheralResolutionFloor(candidate, "ambient"), "queue");
});
