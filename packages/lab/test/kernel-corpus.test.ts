import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertKernelConformanceReportPassed,
  buildKernelCorpusConformanceReport,
  compareKernelCanonicalKey,
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_PROFILE,
  KERNEL_CORPUS_SCENARIO_IDS,
  loadGoldenScenarios,
  serializeKernelCanonicalJson,
} from "../src/index.js";

test("kernel corpus profile declares a stable exact scenario set", async () => {
  const scenarios = await loadGoldenScenarios();
  const actualCorpusIds = scenarios
    .map((scenario) => scenario.id)
    .filter((id) => id.startsWith("golden:kernel-corpus:"))
    .sort(compareKernelCanonicalKey);

  assert.equal(new Set(KERNEL_CORPUS_SCENARIO_IDS).size, KERNEL_CORPUS_SCENARIO_IDS.length);
  assert.deepEqual(actualCorpusIds, [...KERNEL_CORPUS_SCENARIO_IDS]);
  assert.equal(KERNEL_CORPUS_PROFILE.coverageDimensions, KERNEL_CORPUS_COVERAGE_DIMENSIONS);
});

test("kernel corpus conformance report matches the committed v1 artifact", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const committed = await readFile("packages/lab/conformance/kernel-corpus-v1.json", "utf8");

  assert.equal(report.passed, true);
  assert.deepEqual(report.coverage.missingScenarioIds, []);
  assert.deepEqual(report.coverage.unexpectedScenarioIds, []);
  assert.deepEqual(report.coverage.duplicateScenarioIds, []);
  assert.deepEqual(report.dimensionCoverage.missingDimensionIds, []);
  assert.deepEqual(report.dimensionIntegrityFailures, []);
  assert.deepEqual(report.scenarioQualityFailures, []);
  assert.equal(report.determinism.stable, true);
  assert.deepEqual(report.determinism.failures, []);
  assert.ok(
    report.dimensionCoverage.dimensions.every(
      (dimension) => dimension.missingScenarioIds.length === 0,
    ),
  );
  assert.ok(report.scenarios.every((scenario) => scenario.assertions.total >= 3));
  assert.ok(
    report.scenarios.every((scenario) => scenario.projectionValidationFailures.length === 0),
  );
  assert.equal(committed, `${serializeKernelCanonicalJson(report)}\n`);
});

test("kernel corpus conformance fails closed on weak scenarios", async () => {
  const scenarios = await loadGoldenScenarios();
  const target = scenarios.find(
    (scenario) => scenario.id === "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
  );

  assert.ok(target);

  const { expectations: _expectations, ...weakScenario } = target;
  const report = await buildKernelCorpusConformanceReport([weakScenario]);

  assert.equal(report.passed, false);
  assert.match(report.failures.join("\n"), /weak_scenario:.*:missing_expectations/);
  assert.throws(() => assertKernelConformanceReportPassed(report), /Kernel conformance failed/);
});
