import assert from "node:assert/strict";
import test from "node:test";

import { createAttentionEvidenceContext } from "../src/attention-evidence.js";
import type { AttentionCandidate } from "../src/interaction-candidate.js";
import type { AttentionPolicyVerdict } from "../src/attention-policy.js";
import { evaluateSemanticUncertaintyCriterionRule } from "../src/policy/semantic-uncertainty-criterion-rule.js";

const baseCandidate: AttentionCandidate = {
  taskId: "task:semantic",
  interactionId: "interaction:semantic",
  mode: "status",
  tone: "focused",
  consequence: "medium",
  title: "Potentially ambiguous status",
  responseSpec: { kind: "acknowledge", actions: [{ id: "acknowledge", label: "Acknowledge" }] },
  priority: "normal",
  blocking: false,
  timestamp: "2026-03-21T18:35:00.000Z",
};

const basePolicyVerdict: AttentionPolicyVerdict = {
  autoApprove: false,
  mayInterrupt: true,
  requiresOperatorResponse: false,
  minimumPresentation: "ambient",
  minimumPresentationIsSticky: false,
  rationale: [],
};

test("medium-confidence semantics stay out of the uncertainty ambiguity path", () => {
  const evaluation = evaluateSemanticUncertaintyCriterionRule({
    candidate: {
      ...baseCandidate,
      semanticConfidence: "medium",
    },
    policyVerdict: basePolicyVerdict,
    evidence: createAttentionEvidenceContext(),
    candidateScore: 4,
    currentScore: null,
    criterion: { activationThreshold: 4, promotionMargin: 1 },
    sourceTrustAdjustment: 0,
    peripheralResolution: "queue",
  });

  assert.equal(evaluation.kind, "noop");
  assert.deepEqual(evaluation.rationale, [
    "semantic confidence is strong enough to keep ordinary interrupt rules in play",
  ]);
});
