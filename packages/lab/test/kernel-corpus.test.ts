import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertKernelConformanceReportPassed,
  assertKernelCorpusScorecardComparisonPassed,
  assertKernelCorpusScorecardPassed,
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecardComparison,
  buildKernelCorpusScorecard,
  compareKernelCanonicalKey,
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_PROFILE,
  KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION,
  KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
  KERNEL_CORPUS_SCORECARD_THRESHOLDS,
  KERNEL_CORPUS_SCENARIO_IDS,
  loadGoldenScenarios,
  parseHistoricalKernelCorpusScorecard,
  parseKernelCorpusScorecard,
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
    "packages/lab/conformance/kernel-corpus-scorecard-v5.json",
    "utf8",
  );
  const parsedCommittedScorecard = parseKernelCorpusScorecard(committedScorecard);

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
  assert.equal(scorecard.scenarioCheckpoints.length, KERNEL_CORPUS_SCENARIO_IDS.length);
  assert.equal(
    scorecard.summary.semanticCheckpoints.ontology,
    sum(scorecard.scenarioCheckpoints.map((scenario) => scenario.semanticOntology.length)),
  );
  assert.equal(
    scorecard.summary.semanticCheckpoints.relation,
    sum(scorecard.scenarioCheckpoints.map((scenario) => scenario.relation.length)),
  );
  assert.equal(
    scorecard.summary.decisionCheckpoints.projection,
    sum(scorecard.scenarioCheckpoints.map((scenario) => scenario.decisionProjection.length)),
  );
  assert.equal(
    scorecard.summary.normalizedObservationCheckpoints.total,
    sum(scorecard.scenarioCheckpoints.map((scenario) => scenario.normalizedObservation.length)),
  );
  assert.ok(
    scorecard.summary.normalizedObservationCheckpoints.total >=
      KERNEL_CORPUS_SCORECARD_THRESHOLDS.minimumNormalizedObservationCheckpoints,
  );
  assert.ok(
    scorecard.summary.normalizedObservationCheckpoints.scenarios >=
      KERNEL_CORPUS_SCORECARD_THRESHOLDS.minimumNormalizedObservationScenarios,
  );
  assert.ok(
    scorecard.outcomeCoverage.semantic.intentFrames.some((entry) => entry.id === "failure"),
  );
  assert.ok(
    scorecard.outcomeCoverage.semantic.activityClasses.some((entry) => entry.id === "tool_failure"),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.failureDetails.some(
      (entry) => entry.id === "source_window_limit",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationKinds.some(
      (entry) => entry.id === "diagnostic",
    ),
  );
  assert.equal(
    sumDistribution(scorecard.outcomeCoverage.judgment.normalizedObservationPresence),
    sumDistribution(scorecard.outcomeCoverage.judgment.candidateConsequences),
  );
  assertRequiredObservationTotalsMatchPresence(scorecard);
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationPolarities.some(
      (entry) => entry.id === "failure",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationEvidenceLosses.some(
      (entry) => entry.id === "partial",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationDiagnosticClasses.some(
      (entry) => entry.id === "source_limit",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationSubjects.some(
      (entry) => entry.id === "source",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationSemanticAgreements.some(
      (entry) => entry.id === "stable",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationProvenanceOrigins.some(
      (entry) => entry.id === "semantic_evidence",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.normalizedObservationProvenanceAuthorities.some(
      (entry) => entry.id === "explicit",
    ),
  );
  assert.ok(
    scorecard.outcomeCoverage.judgment.decisionRecordRoutes.some((entry) => entry.id === "queue"),
  );
  assert.deepEqual(parsedCommittedScorecard, scorecard);
  assertKernelCorpusScorecardPassed(scorecard);
  assert.equal(committed, `${serializeKernelCanonicalJson(report)}\n`);
  assert.equal(committedScorecard, `${serializeKernelCanonicalJson(scorecard)}\n`);
});

test("kernel corpus scorecard comparison protects the committed quality baseline", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const scorecard = buildKernelCorpusScorecard(report, scenarios);
  const committedScorecard = parseKernelCorpusScorecard(
    await readFile("packages/lab/conformance/kernel-corpus-scorecard-v5.json", "utf8"),
  );
  const comparison = buildKernelCorpusScorecardComparison(committedScorecard, scorecard);

  assert.equal(comparison.passed, true);
  assert.equal(comparison.schemaVersion, KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION);
  assert.deepEqual(comparison.failures, []);
  assert.deepEqual(comparison.deltas, {
    scenarios: 0,
    coverageDimensions: 0,
    missingDimensions: 0,
    totalAssertions: 0,
    minimumAssertionsPerScenario: 0,
    semanticOntologyCheckpoints: 0,
    relationCheckpoints: 0,
    decisionProjectionCheckpoints: 0,
    normalizedObservationCheckpoints: 0,
    normalizedObservationScenarios: 0,
  });
  assert.ok(comparison.dimensionDeltas.every((dimension) => dimension.delta === 0));
  assert.deepEqual(comparison.scenarioCheckpointDeltas, []);
  assert.deepEqual(comparison.outcomeCoverageDeltas, []);
  assertKernelCorpusScorecardComparisonPassed(comparison);
});

test("kernel corpus scorecard v4 migration is additive over historical v3", async () => {
  const historical = JSON.parse(
    await readFile("packages/lab/conformance/kernel-corpus-scorecard-v3.json", "utf8"),
  ) as Record<string, unknown>;
  const current = JSON.parse(
    await readFile("packages/lab/conformance/kernel-corpus-scorecard-v4.json", "utf8"),
  ) as Record<string, unknown>;
  const projected = structuredClone(current);

  projected.schemaVersion = 3;
  const judgment = (projected.outcomeCoverage as { judgment: Record<string, unknown> }).judgment;
  delete judgment.observationPresence;
  delete judgment.observationKinds;
  delete judgment.observationPolarities;
  delete judgment.observationEvidenceLosses;
  delete judgment.observationDiagnosticClasses;
  delete judgment.observationRecoveryHints;
  delete judgment.observationSubjects;
  delete judgment.observationOwners;
  delete judgment.observationStrengths;
  delete judgment.observationAgreements;
  delete judgment.observationProvenanceOrigins;
  delete judgment.observationProvenanceAuthorities;

  assert.deepEqual(projected, historical);
});

test("kernel corpus scorecard v5 migration preserves v4 coverage and adds normalized-observation checkpoints", async () => {
  const historical = JSON.parse(
    await readFile("packages/lab/conformance/kernel-corpus-scorecard-v4.json", "utf8"),
  ) as Record<string, unknown>;
  const current = JSON.parse(
    await readFile("packages/lab/conformance/kernel-corpus-scorecard-v5.json", "utf8"),
  ) as Record<string, unknown>;
  const comparableHistorical = structuredClone(historical);
  const projected = structuredClone(current);

  projected.schemaVersion = 4;
  const thresholds = projected.thresholds as Record<string, unknown>;
  delete thresholds.minimumNormalizedObservationCheckpoints;
  delete thresholds.minimumNormalizedObservationScenarios;
  const summary = projected.summary as Record<string, unknown>;
  delete summary.normalizedObservationCheckpoints;
  const judgment = (projected.outcomeCoverage as { judgment: Record<string, unknown> }).judgment;
  moveRecordField(judgment, "normalizedObservationPresence", "observationPresence");
  moveRecordField(judgment, "normalizedObservationKinds", "observationKinds");
  moveRecordField(judgment, "normalizedObservationPolarities", "observationPolarities");
  moveRecordField(judgment, "normalizedObservationEvidenceLosses", "observationEvidenceLosses");
  moveRecordField(
    judgment,
    "normalizedObservationDiagnosticClasses",
    "observationDiagnosticClasses",
  );
  moveRecordField(judgment, "normalizedObservationRecoveryHints", "observationRecoveryHints");
  moveRecordField(judgment, "normalizedObservationSubjects", "observationSubjects");
  moveRecordField(judgment, "normalizedObservationOwners", "observationOwners");
  moveRecordField(judgment, "normalizedObservationEvidenceStrengths", "observationStrengths");
  moveRecordField(judgment, "normalizedObservationSemanticAgreements", "observationAgreements");
  moveRecordField(
    judgment,
    "normalizedObservationProvenanceOrigins",
    "observationProvenanceOrigins",
  );
  moveRecordField(
    judgment,
    "normalizedObservationProvenanceAuthorities",
    "observationProvenanceAuthorities",
  );
  stripObservationDetailBuckets(judgment);
  stripObservationDetailBuckets(
    (comparableHistorical.outcomeCoverage as { judgment: Record<string, unknown> }).judgment,
  );
  for (const scenario of projected.scenarioCheckpoints as Array<Record<string, unknown>>) {
    delete scenario.normalizedObservation;
  }

  const migratedHistorical = parseHistoricalKernelCorpusScorecard(JSON.stringify(historical));

  assert.deepEqual(projected, comparableHistorical);
  assert.equal(migratedHistorical.schemaVersion, KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION);
  assert.equal(migratedHistorical.summary.normalizedObservationCheckpoints.total, 0);
});

test("kernel corpus scorecard comparison fails closed on outcome coverage regressions", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const target = baseline.outcomeCoverage.judgment.failureDetails.find(
    (entry) => entry.id === "source_window_limit",
  );

  assert.ok(target);

  const candidate = {
    ...baseline,
    outcomeCoverage: {
      ...baseline.outcomeCoverage,
      judgment: {
        ...baseline.outcomeCoverage.judgment,
        failureDetails: baseline.outcomeCoverage.judgment.failureDetails.map((entry) =>
          entry.id === target.id
            ? {
                ...entry,
                count: entry.count - 1,
                scenarioCount: entry.scenarioCount - 1,
              }
            : entry,
        ),
      },
    },
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:outcome_coverage:judgment\.failureDetails:source_window_limit:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:outcome_coverage:judgment\.failureDetails:source_window_limit:scenario_regressed/,
  );

  const swappedScenarioCandidate = {
    ...baseline,
    outcomeCoverage: {
      ...baseline.outcomeCoverage,
      judgment: {
        ...baseline.outcomeCoverage.judgment,
        failureDetails: baseline.outcomeCoverage.judgment.failureDetails.map((entry) =>
          entry.id === target.id
            ? {
                ...entry,
                scenarioIds: ["golden:kernel-corpus:alarmist-read-approval-stays-low-risk"],
              }
            : entry,
        ),
      },
    },
  };
  const swappedScenarioComparison = buildKernelCorpusScorecardComparison(
    baseline,
    swappedScenarioCandidate,
  );

  assert.equal(swappedScenarioComparison.passed, false);
  assert.match(
    swappedScenarioComparison.failures.join("\n"),
    /scorecard_comparison:outcome_coverage:judgment\.failureDetails:source_window_limit:missing_scenario:golden:kernel-corpus:read-source-window-limit-stays-visible/,
  );
});

test("kernel corpus scorecard comparison fails closed on NormalizedObservation presence regressions", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const target = baseline.outcomeCoverage.judgment.normalizedObservationPresence.find(
    (entry) => entry.id === "present",
  );

  assert.ok(target);

  const candidate = {
    ...baseline,
    outcomeCoverage: {
      ...baseline.outcomeCoverage,
      judgment: {
        ...baseline.outcomeCoverage.judgment,
        normalizedObservationPresence:
          baseline.outcomeCoverage.judgment.normalizedObservationPresence.map((entry) =>
            entry.id === target.id
              ? {
                  ...entry,
                  count: entry.count - 1,
                  scenarioCount: entry.scenarioCount - 1,
                }
              : entry,
          ),
      },
    },
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:outcome_coverage:judgment\.normalizedObservationPresence:present:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:outcome_coverage:judgment\.normalizedObservationPresence:present:scenario_regressed/,
  );
});

test("kernel corpus scorecard comparison treats observation detail buckets as informational", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const target = baseline.outcomeCoverage.judgment.normalizedObservationKinds.find(
    (entry) => entry.id === "unknown",
  );

  assert.ok(target);

  const candidate = {
    ...baseline,
    outcomeCoverage: {
      ...baseline.outcomeCoverage,
      judgment: {
        ...baseline.outcomeCoverage.judgment,
        normalizedObservationKinds:
          baseline.outcomeCoverage.judgment.normalizedObservationKinds.map((entry) =>
            entry.id === target.id
              ? {
                  ...entry,
                  count: entry.count - 1,
                  scenarioCount: entry.scenarioCount - 1,
                }
              : entry,
          ),
      },
    },
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, true);
  assert.deepEqual(comparison.outcomeCoverageDeltas, []);
});

test("kernel corpus scorecard comparison fails closed on semantic and judgment regressions", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const [targetDimension] = baseline.dimensions;

  assert.ok(targetDimension);

  const candidate = {
    ...baseline,
    summary: {
      ...baseline.summary,
      assertions: {
        ...baseline.summary.assertions,
        total: baseline.summary.assertions.total - 1,
        minimumPerScenario: baseline.summary.assertions.minimumPerScenario - 1,
      },
      semanticCheckpoints: {
        ...baseline.summary.semanticCheckpoints,
        ontology: baseline.summary.semanticCheckpoints.ontology - 1,
        relation: baseline.summary.semanticCheckpoints.relation - 1,
      },
      decisionCheckpoints: {
        ...baseline.summary.decisionCheckpoints,
        projection: baseline.summary.decisionCheckpoints.projection - 1,
      },
      normalizedObservationCheckpoints: {
        ...baseline.summary.normalizedObservationCheckpoints,
        total: baseline.summary.normalizedObservationCheckpoints.total - 1,
        scenarios: baseline.summary.normalizedObservationCheckpoints.scenarios - 1,
      },
    },
    dimensions: baseline.dimensions.map((dimension) =>
      dimension.id === targetDimension.id
        ? { ...dimension, scenarioCount: dimension.scenarioCount - 1 }
        : dimension,
    ),
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(comparison.failures.join("\n"), /scorecard_comparison:total_assertions:regressed/);
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:minimum_assertions_per_scenario:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:semantic_ontology_checkpoints:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:relation_checkpoints:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:decision_projection_checkpoints:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:normalized_observation_checkpoints:regressed/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:normalized_observation_scenarios:regressed/,
  );
  assert.match(comparison.failures.join("\n"), /scorecard_comparison:dimension:.*:regressed/);
  assert.throws(
    () => assertKernelCorpusScorecardComparisonPassed(comparison),
    /scorecard comparison failed/,
  );
});

test("kernel corpus scorecard comparison fails closed on per-scenario checkpoint loss", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const target = baseline.scenarioCheckpoints.find(
    (scenario) =>
      scenario.semanticOntology.length > 0 &&
      scenario.relation.length > 0 &&
      scenario.decisionProjection.length > 0 &&
      scenario.normalizedObservation.length > 0,
  );

  assert.ok(target);

  const candidate = {
    ...baseline,
    scenarioCheckpoints: baseline.scenarioCheckpoints.map((scenario) =>
      scenario.id === target.id
        ? {
            ...scenario,
            semanticOntology: scenario.semanticOntology.slice(1),
            relation: scenario.relation.slice(1),
            decisionProjection: scenario.decisionProjection.slice(1),
            normalizedObservation: scenario.normalizedObservation.slice(1),
          }
        : scenario,
    ),
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:scenario:.*:missing_semantic_ontology/,
  );
  assert.match(comparison.failures.join("\n"), /scorecard_comparison:scenario:.*:missing_relation/);
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:scenario:.*:missing_decision_projection/,
  );
  assert.match(
    comparison.failures.join("\n"),
    /scorecard_comparison:scenario:.*:missing_normalized_observation/,
  );
});

test("kernel corpus scorecard comparison allows normalized observation digest migrations", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const target = baseline.scenarioCheckpoints.find(
    (scenario) => scenario.normalizedObservation.length > 0,
  );

  assert.ok(target);

  const candidate = {
    ...baseline,
    scenarioCheckpoints: baseline.scenarioCheckpoints.map((scenario) =>
      scenario.id === target.id
        ? {
            ...scenario,
            normalizedObservation: scenario.normalizedObservation.map(
              (_digest, index) => `sha256:normalized-observation-migration-${index}`,
            ),
          }
        : scenario,
    ),
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, true);
  assert.doesNotMatch(comparison.failures.join("\n"), /missing_normalized_observation/);
});

test("kernel corpus scorecard comparison fails closed on profile mismatches", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const baseline = buildKernelCorpusScorecard(report, scenarios);
  const candidate = {
    ...baseline,
    profile: {
      ...baseline.profile,
      id: "aperture.kernel.other_corpus.v1",
      version: baseline.profile.version + 1,
    },
  };
  const comparison = buildKernelCorpusScorecardComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(comparison.failures.join("\n"), /scorecard_comparison:profile_id_mismatch/);
  assert.match(comparison.failures.join("\n"), /scorecard_comparison:profile_version_mismatch/);
});

test("kernel corpus scorecard parsing fails closed on malformed baselines", () => {
  assert.throws(
    () =>
      parseKernelCorpusScorecard(
        JSON.stringify({
          schemaVersion: KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
          passed: true,
          profile: {
            id: KERNEL_CORPUS_PROFILE.id,
            version: KERNEL_CORPUS_PROFILE.version,
            suiteDigest: "sha256:test",
          },
        }),
      ),
    /Invalid kernel corpus scorecard/,
  );
});

test("kernel corpus scorecard parsing rejects malformed outcome coverage", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scenarios = await loadGoldenScenarios();
  const scorecard = buildKernelCorpusScorecard(report, scenarios);
  const missingObservationAgreement = structuredClone(scorecard);
  delete (missingObservationAgreement.outcomeCoverage.judgment as Record<string, unknown>)
    .normalizedObservationSemanticAgreements;

  assert.throws(
    () => parseKernelCorpusScorecard(JSON.stringify(missingObservationAgreement)),
    /Invalid kernel corpus scorecard/,
  );

  const missingObservationCheckpoint = structuredClone(scorecard);
  delete (missingObservationCheckpoint.scenarioCheckpoints[0] as Record<string, unknown>)
    .normalizedObservation;

  assert.throws(
    () => parseKernelCorpusScorecard(JSON.stringify(missingObservationCheckpoint)),
    /Invalid kernel corpus scorecard/,
  );

  const invalidDistributions = [
    [],
    [{ id: "failure", count: 1, scenarioCount: 1, scenarioIds: [] }],
    [
      { id: "failure", count: 1, scenarioCount: 1, scenarioIds: ["scenario:a"] },
      { id: "failure", count: 1, scenarioCount: 1, scenarioIds: ["scenario:b"] },
    ],
    [{ id: "failure", count: 0.5, scenarioCount: 1, scenarioIds: ["scenario:a"] }],
    [{ id: "failure", count: 1, scenarioCount: 2, scenarioIds: ["scenario:a", "scenario:b"] }],
    [
      {
        id: "failure",
        count: 2,
        scenarioCount: 2,
        scenarioIds: ["scenario:b", "scenario:a"],
      },
    ],
  ];

  for (const distribution of invalidDistributions) {
    const candidate = structuredClone(scorecard);
    candidate.outcomeCoverage.semantic.intentFrames = distribution;

    assert.throws(
      () => parseKernelCorpusScorecard(JSON.stringify(candidate)),
      /Invalid kernel corpus scorecard/,
    );
  }
});

test("kernel corpus scorecard generation fails closed on empty outcome coverage", async () => {
  const report = await buildKernelCorpusConformanceReport();
  const scorecard = buildKernelCorpusScorecard(report, []);

  assert.equal(scorecard.passed, false);
  assert.ok(scorecard.failures.includes("scorecard:empty_outcome_coverage:semantic.intentFrames"));
  assert.ok(
    scorecard.failures.includes("scorecard:empty_outcome_coverage:judgment.evaluationKinds"),
  );
  assert.throws(() => assertKernelCorpusScorecardPassed(scorecard), /empty_outcome_coverage/);
});

test("kernel corpus scorecard rejects empty or duplicate checkpoint definitions", async () => {
  const scenarios = await loadGoldenScenarios();
  const target = scenarios.find(
    (scenario) => scenario.id === "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
  );

  assert.ok(target?.expectations?.semanticReadings?.[0]);

  const duplicatedSemanticReading = target.expectations.semanticReadings[0];
  const report = await buildKernelCorpusConformanceReport([
    {
      ...target,
      expectations: {
        ...target.expectations,
        semanticReadings: [
          duplicatedSemanticReading,
          duplicatedSemanticReading,
          {
            stepLabel: "empty relation include",
            relationKindsInclude: [],
          },
          {
            stepLabel: "empty ontology",
            ontology: {},
          },
        ],
      },
    },
  ]);
  const scorecard = buildKernelCorpusScorecard(report, [
    {
      ...target,
      expectations: {
        ...target.expectations,
        semanticReadings: [
          duplicatedSemanticReading,
          duplicatedSemanticReading,
          {
            stepLabel: "empty relation include",
            relationKindsInclude: [],
          },
          {
            stepLabel: "empty ontology",
            ontology: {},
          },
        ],
      },
    },
  ]);

  assert.equal(scorecard.passed, false);
  assert.match(scorecard.failures.join("\n"), /scorecard:duplicate_semantic_ontology_checkpoint/);
  assert.match(scorecard.failures.join("\n"), /scorecard:empty_relation_checkpoint/);
  assert.match(scorecard.failures.join("\n"), /scorecard:empty_semantic_ontology_checkpoint/);
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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumDistribution(distribution: Array<{ count: number }>): number {
  return sum(distribution.map((entry) => entry.count));
}

function countDistributionId(
  distribution: Array<{ id: string; count: number }>,
  id: string,
): number {
  return distribution.find((entry) => entry.id === id)?.count ?? 0;
}

function assertRequiredObservationTotalsMatchPresence(
  scorecard: ReturnType<typeof buildKernelCorpusScorecard>,
): void {
  const judgment = scorecard.outcomeCoverage.judgment;
  const present = countDistributionId(judgment.normalizedObservationPresence, "present");
  const requiredDistributions = [
    judgment.normalizedObservationKinds,
    judgment.normalizedObservationPolarities,
    judgment.normalizedObservationEvidenceLosses,
    judgment.normalizedObservationSubjects,
    judgment.normalizedObservationOwners,
    judgment.normalizedObservationEvidenceStrengths,
    judgment.normalizedObservationSemanticAgreements,
    judgment.normalizedObservationProvenanceOrigins,
    judgment.normalizedObservationProvenanceAuthorities,
  ];
  const optionalDistributions = [
    judgment.normalizedObservationDiagnosticClasses,
    judgment.normalizedObservationRecoveryHints,
  ];

  for (const distribution of requiredDistributions) {
    assert.equal(sumDistribution(distribution), present);
  }
  for (const distribution of optionalDistributions) {
    assert.ok(sumDistribution(distribution) <= present);
  }
}

function moveRecordField(record: Record<string, unknown>, from: string, to: string): void {
  record[to] = record[from];
  delete record[from];
}

function stripObservationDetailBuckets(judgment: Record<string, unknown>): void {
  for (const key of [
    "observationKinds",
    "observationPolarities",
    "observationEvidenceLosses",
    "observationDiagnosticClasses",
    "observationRecoveryHints",
    "observationSubjects",
    "observationOwners",
    "observationStrengths",
    "observationAgreements",
    "observationProvenanceOrigins",
    "observationProvenanceAuthorities",
  ]) {
    delete judgment[key];
  }
}
