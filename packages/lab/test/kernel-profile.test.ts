import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "../src/artifact-versions.js";
import {
  compareKernelCanonicalKey,
  KERNEL_PROFILE,
  KERNEL_PROFILE_SCENARIO_IDS,
  KERNEL_REQUIRED_SINGLETON_REASON_CODE_FAMILIES,
  loadGoldenScenarios,
} from "../src/index.js";

test("kernel profile declares a stable exact scenario set", async () => {
  const scenarios = await loadGoldenScenarios();
  const actualKernelIds = scenarios
    .map((scenario) => scenario.id)
    .filter((id) => id.startsWith("golden:kernel:"))
    .sort(compareKernelCanonicalKey);

  assert.equal(new Set(KERNEL_PROFILE_SCENARIO_IDS).size, KERNEL_PROFILE_SCENARIO_IDS.length);
  assert.deepEqual(actualKernelIds, [...KERNEL_PROFILE_SCENARIO_IDS]);
});

test("kernel profile versions agree with the projection contract", () => {
  assert.equal(
    KERNEL_PROFILE.decisionRecordProjectionVersion,
    KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  );
  assert.equal(KERNEL_PROFILE.reasonCodeGrammarVersion, 1);
  assert.equal(KERNEL_PROFILE.canonicalizationVersion, 1);
  assert.deepEqual(KERNEL_PROFILE.requiredSingletonReasonCodeFamilies, [
    ...KERNEL_REQUIRED_SINGLETON_REASON_CODE_FAMILIES,
  ]);
});
