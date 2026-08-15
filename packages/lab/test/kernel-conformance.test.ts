import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertKernelConformanceReportPassed,
  buildKernelConformanceReport,
  KERNEL_PROFILE_SCENARIO_IDS,
  serializeKernelCanonicalJson,
} from "../src/index.js";

test("kernel conformance report matches the committed v3 artifact", async () => {
  const report = await buildKernelConformanceReport();
  const committed = await readFile("packages/lab/conformance/kernel-v3.json", "utf8");

  assert.equal(report.passed, true);
  assert.deepEqual(report.coverage.missingScenarioIds, []);
  assert.deepEqual(report.coverage.unexpectedScenarioIds, []);
  assert.deepEqual(report.coverage.duplicateScenarioIds, []);
  assert.deepEqual(report.scenarioIds, [...KERNEL_PROFILE_SCENARIO_IDS]);
  assert.ok(
    report.scenarios.every((scenario) => scenario.projectionValidationFailures.length === 0),
  );
  assert.equal(committed, `${serializeKernelCanonicalJson(report)}\n`);
});

test("kernel conformance assertion fails closed on missing profile scenarios", async () => {
  const report = await buildKernelConformanceReport([]);

  assert.equal(report.passed, false);
  assert.match(report.failures[0] ?? "", /^missing_scenario:/);
  assert.throws(() => assertKernelConformanceReportPassed(report), /Kernel conformance failed/);
});
