import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertKernelConformanceReportPassed,
  assertKernelCorpusScorecardPassed,
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecard,
  compareKernelCanonicalKey,
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_PROFILE,
  KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
  KERNEL_CORPUS_SCORECARD_THRESHOLDS,
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
  assert.equal(KERNEL_CORPUS_PROFILE.id, "aperture.kernel.messy_event_corpus.v2");
  assert.equal(KERNEL_CORPUS_PROFILE.version, 2);
  assert.equal(KERNEL_CORPUS_PROFILE.coverageDimensions, KERNEL_CORPUS_COVERAGE_DIMENSIONS);
});

test("kernel corpus conformance report matches the committed v2 artifact", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const scorecard = buildKernelCorpusScorecard(report, scenarios);
  const committed = await readFile("packages/lab/conformance/kernel-corpus-v2.json", "utf8");
  const committedScorecard = await readFile(
    "packages/lab/conformance/kernel-corpus-scorecard-v1.json",
    "utf8",
  );

  assert.equal(report.passed, true);
  assert.equal(scorecard.passed, true);
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
  assert.equal(scorecard.schemaVersion, KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION);
  assert.equal(scorecard.thresholds, KERNEL_CORPUS_SCORECARD_THRESHOLDS);
  assert.equal(scorecard.summary.scenarios.total, KERNEL_CORPUS_SCENARIO_IDS.length);
  assert.equal(scorecard.summary.dimensions.missing, 0);
  assert.equal(scorecard.summary.assertions.failed, 0);
  assert.equal(scorecard.summary.determinism.stable, true);
  assert.ok(scorecard.summary.semanticCheckpoints.ontology >= KERNEL_CORPUS_SCENARIO_IDS.length);
  assert.ok(scorecard.summary.decisionCheckpoints.projection >= KERNEL_CORPUS_SCENARIO_IDS.length);
  assertKernelCorpusScorecardPassed(scorecard);
  assert.equal(committed, `${serializeKernelCanonicalJson(report)}\n`);
  assert.equal(committedScorecard, `${serializeKernelCanonicalJson(scorecard)}\n`);
});

test("kernel corpus conformance fails closed on weak scenarios", async () => {
  const scenarios = await loadGoldenScenarios();
  const target = scenarios.find(
    (scenario) => scenario.id === "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
  );

  assert.ok(target);

  const { expectations: _expectations, ...weakScenario } = target;
  const report = await buildKernelCorpusConformanceReport([weakScenario]);
  const scorecard = buildKernelCorpusScorecard(report, [weakScenario]);

  assert.equal(report.passed, false);
  assert.equal(scorecard.passed, false);
  assert.match(report.failures.join("\n"), /weak_scenario:.*:missing_expectations/);
  assert.match(scorecard.failures.join("\n"), /scorecard:conformance_failed/);
  assert.throws(() => assertKernelConformanceReportPassed(report), /Kernel conformance failed/);
  assert.throws(() => assertKernelCorpusScorecardPassed(scorecard), /scorecard failed/);
});

test("kernel corpus scorecard binds expectation metrics to report input digests", async () => {
  const scenarios = await loadGoldenScenarios();
  const report = await buildKernelCorpusConformanceReport(scenarios);
  const tamperedScenarios = scenarios.map((scenario) => {
    if (scenario.id !== "golden:kernel-corpus:alarmist-read-approval-stays-low-risk") {
      return scenario;
    }

    const { expectations: _expectations, ...tamperedScenario } = scenario;
    return tamperedScenario;
  });
  const scorecard = buildKernelCorpusScorecard(report, tamperedScenarios);

  assert.equal(report.passed, true);
  assert.equal(scorecard.passed, false);
  assert.match(scorecard.failures.join("\n"), /scorecard:input_digest_mismatch/);
  assert.throws(() => assertKernelCorpusScorecardPassed(scorecard), /scorecard failed/);
});
