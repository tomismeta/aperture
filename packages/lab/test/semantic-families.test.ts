import assert from "node:assert/strict";
import test from "node:test";

import { loadGoldenScenarios, type ReplaySemanticCalibrationFamily } from "../src/index.js";

const EXPECTED_FAMILIES: ReplaySemanticCalibrationFamily[] = [
  "ask_missed",
  "ask_overread",
  "consequence_overread",
  "consequence_underread",
  "blocking_missed",
  "episode_missed",
  "confidence_too_high",
  "confidence_too_low",
];

test("semantic golden scenarios declare calibration families", async () => {
  const scenarios = await loadGoldenScenarios();
  const semanticScenarios = scenarios.filter((scenario) => scenario.id.startsWith("golden:semantics:"));

  assert.ok(semanticScenarios.length > 0);

  for (const scenario of semanticScenarios) {
    assert.ok(
      Array.isArray(scenario.semanticFamilies) && scenario.semanticFamilies.length > 0,
      `${scenario.id} should declare semanticFamilies`,
    );
  }

  const coveredFamilies = new Set<ReplaySemanticCalibrationFamily>(
    semanticScenarios.flatMap((scenario) => scenario.semanticFamilies ?? []),
  );

  assert.deepEqual(
    [...coveredFamilies].sort(),
    [...EXPECTED_FAMILIES].sort(),
  );
});
