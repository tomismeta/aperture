import test from "node:test";
import assert from "node:assert/strict";

import * as sdk from "../src/index.js";

test("@tomismeta/aperture-core exposes the intended public SDK surface", () => {
  assert.ok("ApertureCore" in sdk);
  assert.ok("AttentionPolicy" in sdk);
  assert.ok("AttentionValue" in sdk);
  assert.ok("AttentionPlanner" in sdk);
  assert.ok("JudgmentCoordinator" in sdk);
  assert.ok("forecastAttentionPressure" in sdk);
  assert.ok("idleAttentionPressure" in sdk);
  assert.ok("distillMemoryProfile" in sdk);
  assert.ok("ProfileStore" in sdk);
  assert.ok("evaluateTraceSession" in sdk);
  assert.ok("scoreAttentionFrame" in sdk);
  assert.ok("baseAttentionSurfaceCapabilities" in sdk);
  assert.ok("APERTURE_STATE_SCHEMA_VERSION" in sdk);
  assert.ok("MARKDOWN_SCHEMA_VERSION" in sdk);

  assert.equal("AttentionAdjustments" in sdk, false);
  assert.equal("AttentionSignalStore" in sdk, false);
  assert.equal("EpisodeTracker" in sdk, false);
  assert.equal("EventEvaluator" in sdk, false);
  assert.equal("buildMemoryProfile" in sdk, false);
  assert.equal("scoreFrame" in sdk, false);
  assert.equal("serializeJudgmentConfig" in sdk, false);
  assert.equal("AdapterEvent" in sdk, false);
  assert.equal("MinimumPresentation" in sdk, false);
  assert.equal("JudgmentDecision" in sdk, false);
  assert.equal("DEFAULT_ATTENTION_SURFACE_CAPABILITIES" in sdk, false);
  assert.equal("createAttentionEvidenceContext" in sdk, false);
  assert.equal("resolveAttentionEvidenceContext" in sdk, false);
  assert.equal("isAttentionEvidenceContext" in sdk, false);
  assert.equal("selectPeripheralBucket" in sdk, false);
  assert.equal("evaluateConfiguredPolicyGateRule" in sdk, false);
  assert.equal("evaluateBlockingPolicyGateRule" in sdk, false);
  assert.equal("evaluateInterruptEligibilityCriterionRule" in sdk, false);
  assert.equal("evaluateSourceTrustCriterionRule" in sdk, false);
  assert.equal("evaluateAttentionBudgetCriterionRule" in sdk, false);
  assert.equal("noopContinuityRule" in sdk, false);
  assert.equal("overrideContinuityRule" in sdk, false);
});

test("public SDK supports the simple event in -> frame out -> response in loop", () => {
  const core = new sdk.ApertureCore();
  const seenResponses: sdk.AttentionResponse[] = [];

  core.onResponse((response) => {
    seenResponses.push(response);
  });

  const frame = core.publish({
    id: "evt:simple-loop",
    taskId: "task:simple-loop",
    timestamp: "2026-03-15T18:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:simple-loop",
    title: "Approve production deploy",
    summary: "A deployment is waiting for approval.",
    request: { kind: "approval" },
  });

  assert.ok(frame);
  assert.equal(frame?.title, "Approve production deploy");
  assert.equal(frame?.responseSpec?.kind, "approval");
  assert.equal(core.getAttentionView().active?.interactionId, "interaction:simple-loop");

  core.submit({
    taskId: "task:simple-loop",
    interactionId: "interaction:simple-loop",
    response: { kind: "approved" },
  });

  assert.equal(seenResponses.length, 1);
  assert.deepEqual(seenResponses[0], {
    taskId: "task:simple-loop",
    interactionId: "interaction:simple-loop",
    response: { kind: "approved" },
  });
  assert.equal(core.getSignals("task:simple-loop").at(-1)?.kind, "responded");
});
