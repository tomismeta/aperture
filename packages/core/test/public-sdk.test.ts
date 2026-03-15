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
});
