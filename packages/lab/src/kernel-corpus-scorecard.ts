import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import { isCandidateTrace } from "@tomismeta/aperture-core/internal";
import type { KernelCorpusConformanceReport } from "./kernel-corpus-conformance.js";
import {
  collectKernelCorpusScenarioCheckpoints,
  parseKernelCorpusScorecardValue,
} from "./kernel-corpus-scorecard-support.js";
import { runReplayScenario } from "./runner.js";
import type { ReplayScenario, ReplayScenarioExpectations } from "./scenario.js";

export const KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION = 6 as const;
export const KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION = 3 as const;
export const KERNEL_CORPUS_SCORECARD_PROOF = {
  retiredRegressionOracle: true,
  releaseEligible: false,
  independentPostFreezeHoldoutRequired: true,
} as const;

export const KERNEL_CORPUS_SCORECARD_THRESHOLDS = {
  minimumScenarios: 49,
  minimumCoverageDimensions: 16,
  minimumTotalAssertions: 2014,
  minimumAssertionsPerScenario: 25,
  minimumAttentionOntologyCheckpoints: 58,
  minimumDecisionProjectionCheckpoints: 69,
  minimumRelationCheckpoints: 13,
  minimumNormalizedObservationCheckpoints: 36,
  minimumNormalizedObservationScenarios: 33,
} as const;

export type KernelCorpusScorecard = {
  schemaVersion: typeof KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION;
  profile: {
    id: string;
    version: number;
    suiteDigest: string;
  };
  passed: boolean;
  failures: string[];
  thresholds: typeof KERNEL_CORPUS_SCORECARD_THRESHOLDS;
  proof: typeof KERNEL_CORPUS_SCORECARD_PROOF;
  summary: {
    scenarios: {
      total: number;
      withFinalLaneExpectations: number;
    };
    dimensions: {
      total: number;
      covered: number;
      missing: number;
    };
    assertions: {
      total: number;
      passed: number;
      failed: number;
      minimumPerScenario: number;
      maximumPerScenario: number;
      averagePerScenario: number;
    };
    semanticCheckpoints: {
      total: number;
      ontology: number;
      relation: number;
    };
    decisionCheckpoints: {
      total: number;
      projection: number;
    };
    normalizedObservationCheckpoints: {
      total: number;
      scenarios: number;
      unique: number;
    };
    fingerprints: {
      total: number;
      unique: number;
    };
    determinism: {
      repeatedRuns: number;
      stable: boolean;
    };
  };
  dimensions: Array<{
    id: string;
    scenarioCount: number;
  }>;
  outcomeCoverage: KernelCorpusScorecardOutcomeCoverage;
  weakestScenarios: Array<{
    id: string;
    assertionCount: number;
  }>;
  scenarioCheckpoints: KernelCorpusScorecardScenarioCheckpoints[];
};

export type KernelCorpusScorecardScenarioCheckpoints = {
  id: string;
  attentionOntology: string[];
  relation: string[];
  decisionProjection: string[];
  normalizedObservation: string[];
};

export type KernelCorpusScorecardOutcomeCoverage = {
  semantic: {
    intentFrames: KernelCorpusScorecardOutcomeDistribution;
    activityClasses: KernelCorpusScorecardOutcomeDistribution;
    toolFamilies: KernelCorpusScorecardOutcomeDistribution;
    consequences: KernelCorpusScorecardOutcomeDistribution;
    confidences: KernelCorpusScorecardOutcomeDistribution;
    ontologyActivities: KernelCorpusScorecardOutcomeDistribution;
    ontologyConsequences: KernelCorpusScorecardOutcomeDistribution;
    ontologySources: KernelCorpusScorecardOutcomeDistribution;
  };
  judgment: {
    evaluationKinds: KernelCorpusScorecardOutcomeDistribution;
    decisionKinds: KernelCorpusScorecardOutcomeDistribution;
    decisionRecordRoutes: KernelCorpusScorecardOutcomeDistribution;
    plannedLanes: KernelCorpusScorecardOutcomeDistribution;
    resultLanes: KernelCorpusScorecardOutcomeDistribution;
    candidateConsequences: KernelCorpusScorecardOutcomeDistribution;
    semanticConfidences: KernelCorpusScorecardOutcomeDistribution;
    failureDetails: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationPresence: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationKinds: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationPolarities: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationEvidenceLosses: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationDiagnosticClasses: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationRecoveryHints: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationSubjects: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationOwners: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationEvidenceStrengths: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationSemanticAgreements: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationProvenanceOrigins: KernelCorpusScorecardOutcomeDistribution;
    normalizedObservationProvenanceAuthorities: KernelCorpusScorecardOutcomeDistribution;
  };
};

export type KernelCorpusScorecardOutcomeDistribution = Array<{
  id: string;
  count: number;
  scenarioCount: number;
  scenarioIds: string[];
}>;

export type KernelCorpusScorecardComparison = {
  schemaVersion: typeof KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION;
  passed: boolean;
  failures: string[];
  baseline: KernelCorpusScorecardComparisonEndpoint;
  candidate: KernelCorpusScorecardComparisonEndpoint;
  deltas: {
    scenarios: number;
    coverageDimensions: number;
    missingDimensions: number;
    totalAssertions: number;
    minimumAssertionsPerScenario: number;
    attentionOntologyCheckpoints: number;
    relationCheckpoints: number;
    decisionProjectionCheckpoints: number;
    normalizedObservationCheckpoints: number;
    normalizedObservationScenarios: number;
  };
  dimensionDeltas: Array<{
    id: string;
    baselineScenarioCount: number;
    candidateScenarioCount: number;
    delta: number;
  }>;
  scenarioCheckpointDeltas: Array<{
    id: string;
    missingAttentionOntology: string[];
    missingRelation: string[];
    missingDecisionProjection: string[];
    missingNormalizedObservation: string[];
  }>;
  outcomeCoverageDeltas: Array<{
    path: string;
    id: string;
    baselineCount: number;
    candidateCount: number;
    delta: number;
    baselineScenarioCount: number;
    candidateScenarioCount: number;
    scenarioDelta: number;
    missingScenarioIds: string[];
  }>;
};

type KernelCorpusScorecardComparisonEndpoint = {
  profile: KernelCorpusScorecard["profile"];
  passed: boolean;
};

type ScorecardMetrics = KernelCorpusScorecard["summary"];
type ScorecardMetricsResult = {
  metrics: ScorecardMetrics;
  integrityFailures: string[];
  scenarioCheckpoints: KernelCorpusScorecardScenarioCheckpoints[];
};

export function parseKernelCorpusScorecard(source: string): KernelCorpusScorecard {
  return parseKernelCorpusScorecardValue(
    source,
    KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
    KERNEL_CORPUS_SCORECARD_THRESHOLDS,
  );
}

export function parseHistoricalKernelCorpusScorecard(source: string): KernelCorpusScorecard {
  try {
    return parseKernelCorpusScorecardValue(source, KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION, null);
  } catch (error) {
    const value = JSON.parse(source) as unknown;
    if (isHistoricalV6Scorecard(value)) {
      return parseKernelCorpusScorecardValue(
        JSON.stringify(migrateHistoricalV6Scorecard(value)),
        KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
        null,
      );
    }
    if (isHistoricalV4Scorecard(value)) {
      return parseKernelCorpusScorecardValue(
        JSON.stringify(migrateHistoricalV5Scorecard(migrateHistoricalV4Scorecard(value))),
        KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
        null,
      );
    }
    if (isHistoricalV5Scorecard(value)) {
      return parseKernelCorpusScorecardValue(
        JSON.stringify(migrateHistoricalV5Scorecard(value)),
        KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
        null,
      );
    }
    throw error;
  }
}

export function buildKernelCorpusScorecard(
  report: KernelCorpusConformanceReport,
  scenarios: ReplayScenario[],
): KernelCorpusScorecard {
  const { metrics, integrityFailures, scenarioCheckpoints } = collectScorecardMetrics(
    report,
    scenarios,
  );
  const outcomeCoverage = buildKernelCorpusOutcomeCoverage(report, scenarios);
  const failures = collectScorecardFailures(report, metrics, integrityFailures, outcomeCoverage);

  return {
    schemaVersion: KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION,
    profile: {
      id: report.profile.id,
      version: report.profile.version,
      suiteDigest: report.suiteDigest,
    },
    passed: failures.length === 0,
    failures,
    thresholds: KERNEL_CORPUS_SCORECARD_THRESHOLDS,
    proof: KERNEL_CORPUS_SCORECARD_PROOF,
    summary: metrics,
    dimensions: report.dimensionCoverage.dimensions
      .map((dimension) => ({
        id: dimension.id,
        scenarioCount: dimension.presentScenarioIds.length,
      }))
      .sort((left, right) => compareKernelCanonicalKey(left.id, right.id)),
    outcomeCoverage,
    weakestScenarios: report.scenarios
      .map((scenario) => ({
        id: scenario.id,
        assertionCount: scenario.assertions.total,
      }))
      .sort(
        (left, right) =>
          left.assertionCount - right.assertionCount ||
          compareKernelCanonicalKey(left.id, right.id),
      )
      .slice(0, 5),
    scenarioCheckpoints,
  };
}

export function buildKernelCorpusScorecardComparison(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison {
  const deltas = {
    scenarios: candidate.summary.scenarios.total - baseline.summary.scenarios.total,
    coverageDimensions: candidate.summary.dimensions.covered - baseline.summary.dimensions.covered,
    missingDimensions: candidate.summary.dimensions.missing - baseline.summary.dimensions.missing,
    totalAssertions: candidate.summary.assertions.total - baseline.summary.assertions.total,
    minimumAssertionsPerScenario:
      candidate.summary.assertions.minimumPerScenario -
      baseline.summary.assertions.minimumPerScenario,
    attentionOntologyCheckpoints:
      candidate.summary.semanticCheckpoints.ontology -
      baseline.summary.semanticCheckpoints.ontology,
    relationCheckpoints:
      candidate.summary.semanticCheckpoints.relation -
      baseline.summary.semanticCheckpoints.relation,
    decisionProjectionCheckpoints:
      candidate.summary.decisionCheckpoints.projection -
      baseline.summary.decisionCheckpoints.projection,
    normalizedObservationCheckpoints:
      candidate.summary.normalizedObservationCheckpoints.total -
      baseline.summary.normalizedObservationCheckpoints.total,
    normalizedObservationScenarios:
      candidate.summary.normalizedObservationCheckpoints.scenarios -
      baseline.summary.normalizedObservationCheckpoints.scenarios,
  };
  const dimensionDeltas = compareScorecardDimensions(baseline, candidate);
  const scenarioCheckpointDeltas = compareScenarioCheckpoints(baseline, candidate);
  const outcomeCoverageDeltas = compareOutcomeCoverage(baseline, candidate);
  const failures = collectScorecardComparisonFailures(
    baseline,
    candidate,
    deltas,
    dimensionDeltas,
    scenarioCheckpointDeltas,
    outcomeCoverageDeltas,
  );

  return {
    schemaVersion: KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION,
    passed: failures.length === 0,
    failures,
    baseline: {
      profile: baseline.profile,
      passed: baseline.passed,
    },
    candidate: {
      profile: candidate.profile,
      passed: candidate.passed,
    },
    deltas,
    dimensionDeltas,
    scenarioCheckpointDeltas,
    outcomeCoverageDeltas,
  };
}

export function assertKernelCorpusScorecardComparisonPassed(
  comparison: KernelCorpusScorecardComparison,
): void {
  if (comparison.passed) {
    return;
  }

  throw new Error(
    `Kernel corpus scorecard comparison failed: ${
      comparison.failures.join(", ") || "unknown failure"
    }`,
  );
}

export function assertKernelCorpusScorecardPassed(scorecard: KernelCorpusScorecard): void {
  if (scorecard.passed) {
    return;
  }

  throw new Error(
    `Kernel corpus scorecard failed: ${scorecard.failures.join(", ") || "unknown failure"}`,
  );
}

function collectScorecardMetrics(
  report: KernelCorpusConformanceReport,
  scenarios: ReplayScenario[],
): ScorecardMetricsResult {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const resultById = new Map(report.scenarios.map((scenario) => [scenario.id, scenario]));
  const scenarioCount = report.scenarios.length;
  const assertionCounts = report.scenarios.map((scenario) => scenario.assertions.total);
  const totalAssertions = sum(assertionCounts);
  const decisionFingerprints = report.scenarios.flatMap(
    (scenario) => scenario.decisionFingerprints,
  );
  const integrityFailures: string[] = [];
  const expectationsByScenario = report.scenarioIds.map((id) => ({
    id,
    expectations: readDigestBoundExpectation(id, scenarioById, resultById, integrityFailures),
  }));
  const expectations = expectationsByScenario.flatMap(({ expectations: scenarioExpectations }) =>
    scenarioExpectations ? [scenarioExpectations] : [],
  );
  const checkpointResults = expectationsByScenario.map(
    ({ id, expectations: scenarioExpectations }) =>
      collectKernelCorpusScenarioCheckpoints(id, scenarioExpectations),
  );
  const scenarioCheckpoints = checkpointResults.map((result) => ({
    ...result.checkpoints,
    normalizedObservation: collectNormalizedObservationCheckpoints(
      result.checkpoints.id,
      scenarioById,
      resultById,
    ),
  }));
  integrityFailures.push(...checkpointResults.flatMap((result) => result.failures));
  const attentionOntologyCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.attentionOntology.length),
  );
  const relationCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.relation.length),
  );
  const decisionProjectionCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.decisionProjection.length),
  );
  const normalizedObservationCheckpointDigests = scenarioCheckpoints.flatMap(
    (scenario) => scenario.normalizedObservation,
  );
  const normalizedObservationCheckpointCount = normalizedObservationCheckpointDigests.length;

  return {
    metrics: {
      scenarios: {
        total: scenarioCount,
        withFinalLaneExpectations: expectations.filter(
          (expectation) =>
            Object.prototype.hasOwnProperty.call(expectation, "finalNowInteractionId") &&
            expectation.nextInteractionIds !== undefined &&
            expectation.ambientInteractionIds !== undefined,
        ).length,
      },
      dimensions: {
        total: report.dimensionCoverage.dimensions.length,
        covered: report.dimensionCoverage.dimensions.filter(
          (dimension) => dimension.presentScenarioIds.length > 0,
        ).length,
        missing: report.dimensionCoverage.missingDimensionIds.length,
      },
      assertions: {
        total: totalAssertions,
        passed: sum(report.scenarios.map((scenario) => scenario.assertions.passed)),
        failed: sum(report.scenarios.map((scenario) => scenario.assertions.failed)),
        minimumPerScenario: assertionCounts.length === 0 ? 0 : Math.min(...assertionCounts),
        maximumPerScenario: assertionCounts.length === 0 ? 0 : Math.max(...assertionCounts),
        averagePerScenario: scenarioCount === 0 ? 0 : round(totalAssertions / scenarioCount),
      },
      semanticCheckpoints: {
        total: attentionOntologyCheckpointCount + relationCheckpointCount,
        ontology: attentionOntologyCheckpointCount,
        relation: relationCheckpointCount,
      },
      decisionCheckpoints: {
        total: decisionProjectionCheckpointCount,
        projection: decisionProjectionCheckpointCount,
      },
      normalizedObservationCheckpoints: {
        total: normalizedObservationCheckpointCount,
        scenarios: scenarioCheckpoints.filter(
          (scenario) => scenario.normalizedObservation.length > 0,
        ).length,
        unique: new Set(normalizedObservationCheckpointDigests).size,
      },
      fingerprints: {
        total: decisionFingerprints.length,
        unique: new Set(decisionFingerprints).size,
      },
      determinism: {
        repeatedRuns: report.determinism.repeatedRuns,
        stable: report.determinism.stable,
      },
    },
    integrityFailures,
    scenarioCheckpoints,
  };
}

function collectScorecardFailures(
  report: KernelCorpusConformanceReport,
  metrics: ScorecardMetrics,
  integrityFailures: string[],
  outcomeCoverage: KernelCorpusScorecardOutcomeCoverage,
): string[] {
  const failures: string[] = [...integrityFailures];
  if (!report.passed) {
    failures.push("scorecard:conformance_failed");
  }
  if (!metrics.determinism.stable) {
    failures.push("scorecard:determinism_unstable");
  }
  pushMinimumFailure(failures, "scenarios", metrics.scenarios.total, "minimumScenarios");
  pushMinimumFailure(
    failures,
    "coverage_dimensions",
    metrics.dimensions.covered,
    "minimumCoverageDimensions",
  );
  pushMinimumFailure(
    failures,
    "total_assertions",
    metrics.assertions.total,
    "minimumTotalAssertions",
  );
  pushMinimumFailure(
    failures,
    "assertions_per_scenario",
    metrics.assertions.minimumPerScenario,
    "minimumAssertionsPerScenario",
  );
  pushMinimumFailure(
    failures,
    "attention_ontology_checkpoints",
    metrics.semanticCheckpoints.ontology,
    "minimumAttentionOntologyCheckpoints",
  );
  pushMinimumFailure(
    failures,
    "decision_projection_checkpoints",
    metrics.decisionCheckpoints.projection,
    "minimumDecisionProjectionCheckpoints",
  );
  pushMinimumFailure(
    failures,
    "relation_checkpoints",
    metrics.semanticCheckpoints.relation,
    "minimumRelationCheckpoints",
  );
  pushMinimumFailure(
    failures,
    "normalized_observation_checkpoints",
    metrics.normalizedObservationCheckpoints.total,
    "minimumNormalizedObservationCheckpoints",
  );
  pushMinimumFailure(
    failures,
    "normalized_observation_scenarios",
    metrics.normalizedObservationCheckpoints.scenarios,
    "minimumNormalizedObservationScenarios",
  );
  failures.push(...collectOutcomeCoverageFailures(outcomeCoverage));
  return failures;
}

function collectOutcomeCoverageFailures(coverage: KernelCorpusScorecardOutcomeCoverage): string[] {
  const failures = listOutcomeCoverageDistributions(coverage)
    .filter(({ distribution, required }) => required && distribution.length === 0)
    .map(({ path }) => `scorecard:empty_outcome_coverage:${path}`);
  failures.push(...collectNormalizedObservationCoverageIntegrityFailures(coverage));
  return failures;
}

function collectNormalizedObservationCoverageIntegrityFailures(
  coverage: KernelCorpusScorecardOutcomeCoverage,
): string[] {
  const failures: string[] = [];
  const candidateTotal = sumOutcomeDistribution(coverage.judgment.candidateConsequences);
  const presenceTotal = sumOutcomeDistribution(coverage.judgment.normalizedObservationPresence);
  const presentCount = readOutcomeDistributionCount(
    coverage.judgment.normalizedObservationPresence,
    "present",
  );

  if (presenceTotal !== candidateTotal) {
    failures.push(
      `scorecard:normalized_observation_presence_total:${presenceTotal}!=candidate_traces:${candidateTotal}`,
    );
  }

  const requiredObservationDimensions = [
    {
      path: "judgment.normalizedObservationKinds",
      distribution: coverage.judgment.normalizedObservationKinds,
    },
    {
      path: "judgment.normalizedObservationPolarities",
      distribution: coverage.judgment.normalizedObservationPolarities,
    },
    {
      path: "judgment.normalizedObservationEvidenceLosses",
      distribution: coverage.judgment.normalizedObservationEvidenceLosses,
    },
    {
      path: "judgment.normalizedObservationSubjects",
      distribution: coverage.judgment.normalizedObservationSubjects,
    },
    {
      path: "judgment.normalizedObservationOwners",
      distribution: coverage.judgment.normalizedObservationOwners,
    },
    {
      path: "judgment.normalizedObservationEvidenceStrengths",
      distribution: coverage.judgment.normalizedObservationEvidenceStrengths,
    },
    {
      path: "judgment.normalizedObservationSemanticAgreements",
      distribution: coverage.judgment.normalizedObservationSemanticAgreements,
    },
    {
      path: "judgment.normalizedObservationProvenanceOrigins",
      distribution: coverage.judgment.normalizedObservationProvenanceOrigins,
    },
    {
      path: "judgment.normalizedObservationProvenanceAuthorities",
      distribution: coverage.judgment.normalizedObservationProvenanceAuthorities,
    },
  ];
  const optionalObservationDimensions = [
    {
      path: "judgment.normalizedObservationDiagnosticClasses",
      distribution: coverage.judgment.normalizedObservationDiagnosticClasses,
    },
    {
      path: "judgment.normalizedObservationRecoveryHints",
      distribution: coverage.judgment.normalizedObservationRecoveryHints,
    },
  ];

  for (const { path, distribution } of requiredObservationDimensions) {
    const total = sumOutcomeDistribution(distribution);
    if (total !== presentCount) {
      failures.push(
        `scorecard:normalized_observation_dimension_total:${path}:${total}!=${presentCount}`,
      );
    }
  }

  for (const { path, distribution } of optionalObservationDimensions) {
    const total = sumOutcomeDistribution(distribution);
    if (total > presentCount) {
      failures.push(
        `scorecard:normalized_observation_optional_dimension_total:${path}:${total}>${presentCount}`,
      );
    }
  }

  return failures;
}

function compareScorecardDimensions(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison["dimensionDeltas"] {
  const candidateDimensions = new Map(
    candidate.dimensions.map((dimension) => [dimension.id, dimension.scenarioCount]),
  );

  return baseline.dimensions
    .map((dimension) => {
      const candidateScenarioCount = candidateDimensions.get(dimension.id) ?? 0;
      return {
        id: dimension.id,
        baselineScenarioCount: dimension.scenarioCount,
        candidateScenarioCount,
        delta: candidateScenarioCount - dimension.scenarioCount,
      };
    })
    .sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

function compareScenarioCheckpoints(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison["scenarioCheckpointDeltas"] {
  const candidateById = new Map(
    candidate.scenarioCheckpoints.map((scenario) => [scenario.id, scenario]),
  );

  return baseline.scenarioCheckpoints
    .map((scenario) => {
      const candidateScenario = candidateById.get(scenario.id);
      return {
        id: scenario.id,
        missingAttentionOntology: missingDigests(
          scenario.attentionOntology,
          candidateScenario?.attentionOntology ?? [],
        ),
        missingRelation: missingDigests(scenario.relation, candidateScenario?.relation ?? []),
        missingDecisionProjection: missingDigests(
          scenario.decisionProjection,
          candidateScenario?.decisionProjection ?? [],
        ),
        missingNormalizedObservation:
          (candidateScenario?.normalizedObservation.length ?? 0) <
          scenario.normalizedObservation.length
            ? scenario.normalizedObservation.slice(
                candidateScenario?.normalizedObservation.length ?? 0,
              )
            : [],
      };
    })
    .filter(
      (scenario) =>
        scenario.missingAttentionOntology.length > 0 ||
        scenario.missingRelation.length > 0 ||
        scenario.missingDecisionProjection.length > 0 ||
        scenario.missingNormalizedObservation.length > 0,
    )
    .sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

function collectScorecardComparisonFailures(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
  deltas: KernelCorpusScorecardComparison["deltas"],
  dimensionDeltas: KernelCorpusScorecardComparison["dimensionDeltas"],
  scenarioCheckpointDeltas: KernelCorpusScorecardComparison["scenarioCheckpointDeltas"],
  outcomeCoverageDeltas: KernelCorpusScorecardComparison["outcomeCoverageDeltas"],
): string[] {
  const failures: string[] = [];
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    failures.push(
      `scorecard_comparison:schema_version_mismatch:${baseline.schemaVersion}:${candidate.schemaVersion}`,
    );
  }
  if (baseline.profile.id !== candidate.profile.id) {
    failures.push(
      `scorecard_comparison:profile_id_mismatch:${baseline.profile.id}:${candidate.profile.id}`,
    );
  }
  if (baseline.profile.version !== candidate.profile.version) {
    failures.push(
      `scorecard_comparison:profile_version_mismatch:${baseline.profile.version}:${candidate.profile.version}`,
    );
  }
  if (!baseline.passed) {
    failures.push("scorecard_comparison:baseline_failed");
  }
  if (!candidate.passed) {
    failures.push("scorecard_comparison:candidate_failed");
  }
  pushNonNegativeDeltaFailure(failures, "scenarios", deltas.scenarios);
  pushNonNegativeDeltaFailure(failures, "coverage_dimensions", deltas.coverageDimensions);
  pushNonPositiveDeltaFailure(failures, "missing_dimensions", deltas.missingDimensions);
  pushNonNegativeDeltaFailure(failures, "total_assertions", deltas.totalAssertions);
  pushNonNegativeDeltaFailure(
    failures,
    "minimum_assertions_per_scenario",
    deltas.minimumAssertionsPerScenario,
  );
  pushNonNegativeDeltaFailure(
    failures,
    "attention_ontology_checkpoints",
    deltas.attentionOntologyCheckpoints,
  );
  pushNonNegativeDeltaFailure(failures, "relation_checkpoints", deltas.relationCheckpoints);
  pushNonNegativeDeltaFailure(
    failures,
    "decision_projection_checkpoints",
    deltas.decisionProjectionCheckpoints,
  );
  pushNonNegativeDeltaFailure(
    failures,
    "normalized_observation_checkpoints",
    deltas.normalizedObservationCheckpoints,
  );
  pushNonNegativeDeltaFailure(
    failures,
    "normalized_observation_scenarios",
    deltas.normalizedObservationScenarios,
  );
  pushThresholdRegressionFailures(failures, baseline.thresholds, candidate.thresholds);

  for (const dimension of dimensionDeltas) {
    if (dimension.delta < 0) {
      failures.push(`scorecard_comparison:dimension:${dimension.id}:regressed:${dimension.delta}`);
    }
  }

  for (const scenario of scenarioCheckpointDeltas) {
    for (const digest of scenario.missingAttentionOntology) {
      failures.push(
        `scorecard_comparison:scenario:${scenario.id}:missing_attention_ontology:${digest}`,
      );
    }
    for (const digest of scenario.missingRelation) {
      failures.push(`scorecard_comparison:scenario:${scenario.id}:missing_relation:${digest}`);
    }
    for (const digest of scenario.missingDecisionProjection) {
      failures.push(
        `scorecard_comparison:scenario:${scenario.id}:missing_decision_projection:${digest}`,
      );
    }
    for (const digest of scenario.missingNormalizedObservation) {
      failures.push(
        `scorecard_comparison:scenario:${scenario.id}:missing_normalized_observation:${digest}`,
      );
    }
  }

  for (const outcome of outcomeCoverageDeltas) {
    if (outcome.delta < 0) {
      failures.push(
        `scorecard_comparison:outcome_coverage:${outcome.path}:${outcome.id}:regressed:${outcome.delta}`,
      );
    }
    if (outcome.scenarioDelta < 0) {
      failures.push(
        `scorecard_comparison:outcome_coverage:${outcome.path}:${outcome.id}:scenario_regressed:${outcome.scenarioDelta}`,
      );
    }
    for (const id of outcome.missingScenarioIds) {
      failures.push(
        `scorecard_comparison:outcome_coverage:${outcome.path}:${outcome.id}:missing_scenario:${id}`,
      );
    }
  }

  return failures;
}

function pushThresholdRegressionFailures(
  failures: string[],
  baseline: KernelCorpusScorecard["thresholds"],
  candidate: KernelCorpusScorecard["thresholds"],
): void {
  for (const key of Object.keys(baseline) as Array<keyof KernelCorpusScorecard["thresholds"]>) {
    pushNonNegativeDeltaFailure(failures, `threshold:${key}`, candidate[key] - baseline[key]);
  }
}

function buildKernelCorpusOutcomeCoverage(
  report: KernelCorpusConformanceReport,
  scenarios: ReplayScenario[],
): KernelCorpusScorecardOutcomeCoverage {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const accumulators = createOutcomeCoverageAccumulators();

  for (const id of report.scenarioIds) {
    const scenario = scenarioById.get(id);
    if (!scenario) {
      continue;
    }

    const run = runReplayScenario(scenario);
    for (const semantic of run.semantics) {
      addOutcome(accumulators.semantic.intentFrames, semantic.interpretation.intentFrame, id);
      addOutcome(accumulators.semantic.activityClasses, semantic.interpretation.activityClass, id);
      addOutcome(accumulators.semantic.toolFamilies, semantic.interpretation.toolFamily, id);
      addOutcome(accumulators.semantic.consequences, semantic.interpretation.consequence, id);
      addOutcome(accumulators.semantic.confidences, semantic.interpretation.confidence, id);
      addOutcome(accumulators.semantic.ontologyActivities, semantic.ontology?.activity, id);
      addOutcome(accumulators.semantic.ontologyConsequences, semantic.ontology?.consequence, id);
      addOutcome(accumulators.semantic.ontologySources, semantic.ontology?.source, id);
    }

    for (const decision of run.decisions) {
      addOutcome(accumulators.judgment.evaluationKinds, decision.evaluationKind, id);
      addOutcome(accumulators.judgment.decisionKinds, decision.decisionKind, id);
      addOutcome(accumulators.judgment.decisionRecordRoutes, decision.decisionRecordRoute, id);
      addOutcome(accumulators.judgment.plannedLanes, decision.plannedLane, id);
      addOutcome(accumulators.judgment.resultLanes, decision.resultLane, id);
      addOutcome(accumulators.judgment.semanticConfidences, decision.semanticConfidence, id);
    }

    for (const trace of run.traces) {
      if (!isCandidateTrace(trace)) {
        continue;
      }
      addOutcome(
        accumulators.judgment.candidateConsequences,
        trace.evaluation.adjusted.consequence,
        id,
      );
      addOutcome(
        accumulators.judgment.failureDetails,
        readNormalizedFailureDetail(trace.evaluation.adjusted.judgmentInput.observation),
        id,
      );
      const observation = trace.evaluation.adjusted.judgmentInput.observation;
      addOutcome(
        accumulators.judgment.normalizedObservationPresence,
        observation === undefined ? "absent" : "present",
        id,
      );
      addOutcome(accumulators.judgment.normalizedObservationKinds, observation?.kind, id);
      addOutcome(accumulators.judgment.normalizedObservationPolarities, observation?.polarity, id);
      addOutcome(
        accumulators.judgment.normalizedObservationEvidenceLosses,
        observation?.evidenceLoss,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationDiagnosticClasses,
        observation?.diagnosticClass,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationRecoveryHints,
        observation?.recoveryHint,
        id,
      );
      addOutcome(accumulators.judgment.normalizedObservationSubjects, observation?.subject, id);
      addOutcome(
        accumulators.judgment.normalizedObservationOwners,
        observation?.ownership.owner,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationEvidenceStrengths,
        observation?.evidenceStrength,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationSemanticAgreements,
        observation?.semanticAgreement,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationProvenanceOrigins,
        observation?.provenance.origin,
        id,
      );
      addOutcome(
        accumulators.judgment.normalizedObservationProvenanceAuthorities,
        observation?.provenance.authority,
        id,
      );
    }
  }

  return finalizeOutcomeCoverage(accumulators);
}

function readNormalizedFailureDetail(
  observation:
    | {
        kind?: string;
        polarity?: string;
        evidenceLoss?: string;
        diagnosticClass?: string;
      }
    | undefined,
): string | undefined {
  if (observation === undefined) {
    return undefined;
  }

  if (observation.kind === "diagnostic") {
    switch (observation.diagnosticClass) {
      case "runtime":
        return "diagnostic";
      case "source_limit":
        return "source_window_limit";
      default:
        return undefined;
    }
  }

  if (observation.kind === "outcome") {
    switch (observation.evidenceLoss) {
      case "absent":
        return "absent_evidence";
      case "unknown":
        return "indeterminate";
      case "none":
        return observation.polarity === "failure" ? "outcome_only" : undefined;
      default:
        return undefined;
    }
  }

  return observation.kind === "unknown" && observation.evidenceLoss === "unknown"
    ? "indeterminate"
    : undefined;
}

type OutcomeCoverageAccumulators = {
  semantic: {
    intentFrames: OutcomeDistributionAccumulator;
    activityClasses: OutcomeDistributionAccumulator;
    toolFamilies: OutcomeDistributionAccumulator;
    consequences: OutcomeDistributionAccumulator;
    confidences: OutcomeDistributionAccumulator;
    ontologyActivities: OutcomeDistributionAccumulator;
    ontologyConsequences: OutcomeDistributionAccumulator;
    ontologySources: OutcomeDistributionAccumulator;
  };
  judgment: {
    evaluationKinds: OutcomeDistributionAccumulator;
    decisionKinds: OutcomeDistributionAccumulator;
    decisionRecordRoutes: OutcomeDistributionAccumulator;
    plannedLanes: OutcomeDistributionAccumulator;
    resultLanes: OutcomeDistributionAccumulator;
    candidateConsequences: OutcomeDistributionAccumulator;
    semanticConfidences: OutcomeDistributionAccumulator;
    failureDetails: OutcomeDistributionAccumulator;
    normalizedObservationPresence: OutcomeDistributionAccumulator;
    normalizedObservationKinds: OutcomeDistributionAccumulator;
    normalizedObservationPolarities: OutcomeDistributionAccumulator;
    normalizedObservationEvidenceLosses: OutcomeDistributionAccumulator;
    normalizedObservationDiagnosticClasses: OutcomeDistributionAccumulator;
    normalizedObservationRecoveryHints: OutcomeDistributionAccumulator;
    normalizedObservationSubjects: OutcomeDistributionAccumulator;
    normalizedObservationOwners: OutcomeDistributionAccumulator;
    normalizedObservationEvidenceStrengths: OutcomeDistributionAccumulator;
    normalizedObservationSemanticAgreements: OutcomeDistributionAccumulator;
    normalizedObservationProvenanceOrigins: OutcomeDistributionAccumulator;
    normalizedObservationProvenanceAuthorities: OutcomeDistributionAccumulator;
  };
};

type OutcomeDistributionAccumulator = Map<string, { count: number; scenarioIds: Set<string> }>;

function createOutcomeCoverageAccumulators(): OutcomeCoverageAccumulators {
  return {
    semantic: {
      intentFrames: new Map(),
      activityClasses: new Map(),
      toolFamilies: new Map(),
      consequences: new Map(),
      confidences: new Map(),
      ontologyActivities: new Map(),
      ontologyConsequences: new Map(),
      ontologySources: new Map(),
    },
    judgment: {
      evaluationKinds: new Map(),
      decisionKinds: new Map(),
      decisionRecordRoutes: new Map(),
      plannedLanes: new Map(),
      resultLanes: new Map(),
      candidateConsequences: new Map(),
      semanticConfidences: new Map(),
      failureDetails: new Map(),
      normalizedObservationPresence: new Map(),
      normalizedObservationKinds: new Map(),
      normalizedObservationPolarities: new Map(),
      normalizedObservationEvidenceLosses: new Map(),
      normalizedObservationDiagnosticClasses: new Map(),
      normalizedObservationRecoveryHints: new Map(),
      normalizedObservationSubjects: new Map(),
      normalizedObservationOwners: new Map(),
      normalizedObservationEvidenceStrengths: new Map(),
      normalizedObservationSemanticAgreements: new Map(),
      normalizedObservationProvenanceOrigins: new Map(),
      normalizedObservationProvenanceAuthorities: new Map(),
    },
  };
}

function addOutcome(
  accumulator: OutcomeDistributionAccumulator,
  value: string | undefined | null,
  scenarioId: string,
): void {
  if (value === undefined || value === null || value.length === 0) {
    return;
  }

  const current = accumulator.get(value) ?? { count: 0, scenarioIds: new Set<string>() };
  current.count += 1;
  current.scenarioIds.add(scenarioId);
  accumulator.set(value, current);
}

function finalizeOutcomeCoverage(
  accumulators: OutcomeCoverageAccumulators,
): KernelCorpusScorecardOutcomeCoverage {
  return {
    semantic: {
      intentFrames: finalizeOutcomeDistribution(accumulators.semantic.intentFrames),
      activityClasses: finalizeOutcomeDistribution(accumulators.semantic.activityClasses),
      toolFamilies: finalizeOutcomeDistribution(accumulators.semantic.toolFamilies),
      consequences: finalizeOutcomeDistribution(accumulators.semantic.consequences),
      confidences: finalizeOutcomeDistribution(accumulators.semantic.confidences),
      ontologyActivities: finalizeOutcomeDistribution(accumulators.semantic.ontologyActivities),
      ontologyConsequences: finalizeOutcomeDistribution(accumulators.semantic.ontologyConsequences),
      ontologySources: finalizeOutcomeDistribution(accumulators.semantic.ontologySources),
    },
    judgment: {
      evaluationKinds: finalizeOutcomeDistribution(accumulators.judgment.evaluationKinds),
      decisionKinds: finalizeOutcomeDistribution(accumulators.judgment.decisionKinds),
      decisionRecordRoutes: finalizeOutcomeDistribution(accumulators.judgment.decisionRecordRoutes),
      plannedLanes: finalizeOutcomeDistribution(accumulators.judgment.plannedLanes),
      resultLanes: finalizeOutcomeDistribution(accumulators.judgment.resultLanes),
      candidateConsequences: finalizeOutcomeDistribution(
        accumulators.judgment.candidateConsequences,
      ),
      semanticConfidences: finalizeOutcomeDistribution(accumulators.judgment.semanticConfidences),
      failureDetails: finalizeOutcomeDistribution(accumulators.judgment.failureDetails),
      normalizedObservationPresence: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationPresence,
      ),
      normalizedObservationKinds: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationKinds,
      ),
      normalizedObservationPolarities: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationPolarities,
      ),
      normalizedObservationEvidenceLosses: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationEvidenceLosses,
      ),
      normalizedObservationDiagnosticClasses: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationDiagnosticClasses,
      ),
      normalizedObservationRecoveryHints: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationRecoveryHints,
      ),
      normalizedObservationSubjects: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationSubjects,
      ),
      normalizedObservationOwners: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationOwners,
      ),
      normalizedObservationEvidenceStrengths: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationEvidenceStrengths,
      ),
      normalizedObservationSemanticAgreements: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationSemanticAgreements,
      ),
      normalizedObservationProvenanceOrigins: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationProvenanceOrigins,
      ),
      normalizedObservationProvenanceAuthorities: finalizeOutcomeDistribution(
        accumulators.judgment.normalizedObservationProvenanceAuthorities,
      ),
    },
  };
}

function finalizeOutcomeDistribution(
  accumulator: OutcomeDistributionAccumulator,
): KernelCorpusScorecardOutcomeDistribution {
  return [...accumulator.entries()]
    .map(([id, value]) => ({
      id,
      count: value.count,
      scenarioCount: value.scenarioIds.size,
      scenarioIds: [...value.scenarioIds].sort(compareKernelCanonicalKey),
    }))
    .sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

function sumOutcomeDistribution(distribution: KernelCorpusScorecardOutcomeDistribution): number {
  return sum(distribution.map((entry) => entry.count));
}

function readOutcomeDistributionCount(
  distribution: KernelCorpusScorecardOutcomeDistribution,
  id: string,
): number {
  return distribution.find((entry) => entry.id === id)?.count ?? 0;
}

function compareOutcomeCoverage(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison["outcomeCoverageDeltas"] {
  const deltas: KernelCorpusScorecardComparison["outcomeCoverageDeltas"] = [];
  const baselineDistributions = flattenOutcomeCoverage(baseline.outcomeCoverage, {
    comparisonPolicy: "protected",
  });
  const candidateDistributions = new Map(
    flattenOutcomeCoverage(candidate.outcomeCoverage, { comparisonPolicy: "protected" }).map(
      (entry) => [`${entry.path}\0${entry.id}`, entry],
    ),
  );

  for (const baselineEntry of baselineDistributions) {
    const candidateEntry = candidateDistributions.get(`${baselineEntry.path}\0${baselineEntry.id}`);
    const candidateCount = candidateEntry?.count ?? 0;
    const candidateScenarioCount = candidateEntry?.scenarioCount ?? 0;
    const delta = candidateCount - baselineEntry.count;
    const scenarioDelta = candidateScenarioCount - baselineEntry.scenarioCount;
    const candidateScenarioIds = new Set(candidateEntry?.scenarioIds ?? []);
    const missingScenarioIds = baselineEntry.scenarioIds.filter(
      (id) => !candidateScenarioIds.has(id),
    );
    if (delta < 0 || scenarioDelta < 0 || missingScenarioIds.length > 0) {
      deltas.push({
        path: baselineEntry.path,
        id: baselineEntry.id,
        baselineCount: baselineEntry.count,
        candidateCount,
        delta,
        baselineScenarioCount: baselineEntry.scenarioCount,
        candidateScenarioCount,
        scenarioDelta,
        missingScenarioIds,
      });
    }
  }
  deltas.push(...compareNormalizedObservationPresenceCoverage(baseline, candidate));

  return deltas.sort(
    (left, right) =>
      compareKernelCanonicalKey(left.path, right.path) ||
      compareKernelCanonicalKey(left.id, right.id),
  );
}

function compareNormalizedObservationPresenceCoverage(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison["outcomeCoverageDeltas"] {
  const baselineEntry = readOutcomeDistributionEntry(
    baseline.outcomeCoverage.judgment.normalizedObservationPresence,
    "present",
  );
  if (baselineEntry === null) {
    return [];
  }

  const candidateEntry = readOutcomeDistributionEntry(
    candidate.outcomeCoverage.judgment.normalizedObservationPresence,
    "present",
  );
  const candidateCount = candidateEntry?.count ?? 0;
  const candidateScenarioCount = candidateEntry?.scenarioCount ?? 0;
  const candidateScenarioIds = new Set(candidateEntry?.scenarioIds ?? []);
  const missingScenarioIds = baselineEntry.scenarioIds.filter(
    (id) => !candidateScenarioIds.has(id),
  );
  const delta = candidateCount - baselineEntry.count;
  const scenarioDelta = candidateScenarioCount - baselineEntry.scenarioCount;

  return delta < 0 || scenarioDelta < 0 || missingScenarioIds.length > 0
    ? [
        {
          path: "judgment.normalizedObservationPresence",
          id: "present",
          baselineCount: baselineEntry.count,
          candidateCount,
          delta,
          baselineScenarioCount: baselineEntry.scenarioCount,
          candidateScenarioCount,
          scenarioDelta,
          missingScenarioIds,
        },
      ]
    : [];
}

function readOutcomeDistributionEntry(
  distribution: KernelCorpusScorecardOutcomeDistribution,
  id: string,
): KernelCorpusScorecardOutcomeDistribution[number] | null {
  return distribution.find((entry) => entry.id === id) ?? null;
}

function flattenOutcomeCoverage(
  coverage: KernelCorpusScorecardOutcomeCoverage,
  options: { comparisonPolicy?: OutcomeCoverageComparisonPolicy } = {},
): Array<{
  path: string;
  id: string;
  count: number;
  scenarioCount: number;
  scenarioIds: string[];
}> {
  return listOutcomeCoverageDistributions(coverage)
    .filter(
      ({ comparisonPolicy }) =>
        options.comparisonPolicy === undefined || comparisonPolicy === options.comparisonPolicy,
    )
    .flatMap(({ path, distribution }) => flattenOutcomeDistribution(path, distribution));
}

type OutcomeCoverageComparisonPolicy = "protected" | "informational";
type OutcomeCoverageDistributionListing = {
  path: string;
  distribution: KernelCorpusScorecardOutcomeDistribution;
  required: boolean;
  comparisonPolicy: OutcomeCoverageComparisonPolicy;
};

function protectedDistribution(
  path: string,
  distribution: KernelCorpusScorecardOutcomeDistribution,
): OutcomeCoverageDistributionListing {
  return { path, distribution, required: true, comparisonPolicy: "protected" };
}

function informationalDistribution(
  path: string,
  distribution: KernelCorpusScorecardOutcomeDistribution,
  options: { required?: boolean } = {},
): OutcomeCoverageDistributionListing {
  return {
    path,
    distribution,
    required: options.required ?? true,
    comparisonPolicy: "informational",
  };
}

function listOutcomeCoverageDistributions(
  coverage: KernelCorpusScorecardOutcomeCoverage,
): OutcomeCoverageDistributionListing[] {
  return [
    protectedDistribution("semantic.intentFrames", coverage.semantic.intentFrames),
    protectedDistribution("semantic.activityClasses", coverage.semantic.activityClasses),
    protectedDistribution("semantic.toolFamilies", coverage.semantic.toolFamilies),
    protectedDistribution("semantic.consequences", coverage.semantic.consequences),
    protectedDistribution("semantic.confidences", coverage.semantic.confidences),
    protectedDistribution("semantic.ontologyActivities", coverage.semantic.ontologyActivities),
    protectedDistribution("semantic.ontologyConsequences", coverage.semantic.ontologyConsequences),
    protectedDistribution("semantic.ontologySources", coverage.semantic.ontologySources),
    protectedDistribution("judgment.evaluationKinds", coverage.judgment.evaluationKinds),
    protectedDistribution("judgment.decisionKinds", coverage.judgment.decisionKinds),
    protectedDistribution("judgment.decisionRecordRoutes", coverage.judgment.decisionRecordRoutes),
    protectedDistribution("judgment.plannedLanes", coverage.judgment.plannedLanes),
    protectedDistribution("judgment.resultLanes", coverage.judgment.resultLanes),
    protectedDistribution(
      "judgment.candidateConsequences",
      coverage.judgment.candidateConsequences,
    ),
    protectedDistribution("judgment.semanticConfidences", coverage.judgment.semanticConfidences),
    protectedDistribution("judgment.failureDetails", coverage.judgment.failureDetails),
    informationalDistribution(
      "judgment.normalizedObservationPresence",
      coverage.judgment.normalizedObservationPresence,
    ),
    informationalDistribution(
      "judgment.normalizedObservationKinds",
      coverage.judgment.normalizedObservationKinds,
    ),
    informationalDistribution(
      "judgment.normalizedObservationPolarities",
      coverage.judgment.normalizedObservationPolarities,
    ),
    informationalDistribution(
      "judgment.normalizedObservationEvidenceLosses",
      coverage.judgment.normalizedObservationEvidenceLosses,
    ),
    informationalDistribution(
      "judgment.normalizedObservationDiagnosticClasses",
      coverage.judgment.normalizedObservationDiagnosticClasses,
      { required: false },
    ),
    informationalDistribution(
      "judgment.normalizedObservationRecoveryHints",
      coverage.judgment.normalizedObservationRecoveryHints,
      { required: false },
    ),
    informationalDistribution(
      "judgment.normalizedObservationSubjects",
      coverage.judgment.normalizedObservationSubjects,
    ),
    informationalDistribution(
      "judgment.normalizedObservationOwners",
      coverage.judgment.normalizedObservationOwners,
    ),
    informationalDistribution(
      "judgment.normalizedObservationEvidenceStrengths",
      coverage.judgment.normalizedObservationEvidenceStrengths,
    ),
    informationalDistribution(
      "judgment.normalizedObservationSemanticAgreements",
      coverage.judgment.normalizedObservationSemanticAgreements,
    ),
    informationalDistribution(
      "judgment.normalizedObservationProvenanceOrigins",
      coverage.judgment.normalizedObservationProvenanceOrigins,
    ),
    informationalDistribution(
      "judgment.normalizedObservationProvenanceAuthorities",
      coverage.judgment.normalizedObservationProvenanceAuthorities,
    ),
  ];
}

function flattenOutcomeDistribution(
  path: string,
  distribution: KernelCorpusScorecardOutcomeDistribution,
): Array<{
  path: string;
  id: string;
  count: number;
  scenarioCount: number;
  scenarioIds: string[];
}> {
  return distribution.map((entry) => ({ path, ...entry }));
}

function collectNormalizedObservationCheckpoints(
  id: string,
  scenarioById: ReadonlyMap<string, ReplayScenario>,
  resultById: ReadonlyMap<string, { inputDigest: string }>,
): string[] {
  const scenario = scenarioById.get(id);
  const result = resultById.get(id);
  if (
    !scenario ||
    !result ||
    digestKernelCanonicalJson(buildScenarioInput(scenario)) !== result.inputDigest
  ) {
    return [];
  }

  const digests: string[] = [];
  const seen = new Set<string>();
  const run = runReplayScenario(scenario);
  for (const trace of run.traces) {
    if (!isCandidateTrace(trace)) {
      continue;
    }

    const candidate = trace.evaluation.adjusted;
    const observation = candidate.judgmentInput.observation;
    if (observation === undefined) {
      continue;
    }

    const digest = digestKernelCanonicalJson({
      kind: "normalized_observation",
      candidate: {
        interactionId: candidate.interactionId,
        mode: candidate.mode,
        tone: candidate.tone,
        consequence: candidate.consequence,
        ...(candidate.toolFamily !== undefined ? { toolFamily: candidate.toolFamily } : {}),
        ...(candidate.activityClass !== undefined
          ? { activityClass: candidate.activityClass }
          : {}),
      },
      observation,
    });
    if (!seen.has(digest)) {
      seen.add(digest);
      digests.push(digest);
    }
  }

  return digests.sort(compareKernelCanonicalKey);
}

function readDigestBoundExpectation(
  id: string,
  scenarioById: ReadonlyMap<string, ReplayScenario>,
  resultById: ReadonlyMap<string, { inputDigest: string }>,
  integrityFailures: string[],
): ReplayScenarioExpectations | null {
  const scenario = scenarioById.get(id);
  const result = resultById.get(id);
  if (!scenario || !result) {
    integrityFailures.push(`scorecard:missing_digest_bound_scenario:${id}`);
    return null;
  }
  if (digestKernelCanonicalJson(buildScenarioInput(scenario)) !== result.inputDigest) {
    integrityFailures.push(`scorecard:input_digest_mismatch:${id}`);
    return null;
  }
  return scenario.expectations ?? null;
}

function buildScenarioInput(scenario: ReplayScenario): unknown {
  return {
    id: scenario.id,
    core: scenario.core ?? null,
    expectations: scenario.expectations ?? null,
    steps: scenario.steps,
  };
}

function isHistoricalV4Scorecard(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === 4 && isRecord(value.outcomeCoverage);
}

function migrateHistoricalV4Scorecard(value: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(value) as Record<string, unknown>;
  migrated.schemaVersion = 5;

  const thresholds = ensureRecord(migrated.thresholds);
  thresholds.minimumNormalizedObservationCheckpoints = 0;
  thresholds.minimumNormalizedObservationScenarios = 0;

  const summary = ensureRecord(migrated.summary);
  summary.normalizedObservationCheckpoints = {
    total: 0,
    scenarios: 0,
    unique: 0,
  };

  const outcomeCoverage = ensureRecord(migrated.outcomeCoverage);
  const judgment = ensureRecord(outcomeCoverage.judgment);
  moveRecordField(judgment, "observationPresence", "normalizedObservationPresence");
  moveRecordField(judgment, "observationKinds", "normalizedObservationKinds");
  moveRecordField(judgment, "observationPolarities", "normalizedObservationPolarities");
  moveRecordField(judgment, "observationEvidenceLosses", "normalizedObservationEvidenceLosses");
  moveRecordField(
    judgment,
    "observationDiagnosticClasses",
    "normalizedObservationDiagnosticClasses",
  );
  moveRecordField(judgment, "observationRecoveryHints", "normalizedObservationRecoveryHints");
  moveRecordField(judgment, "observationSubjects", "normalizedObservationSubjects");
  moveRecordField(judgment, "observationOwners", "normalizedObservationOwners");
  moveRecordField(judgment, "observationStrengths", "normalizedObservationEvidenceStrengths");
  moveRecordField(judgment, "observationAgreements", "normalizedObservationSemanticAgreements");
  moveRecordField(
    judgment,
    "observationProvenanceOrigins",
    "normalizedObservationProvenanceOrigins",
  );
  moveRecordField(
    judgment,
    "observationProvenanceAuthorities",
    "normalizedObservationProvenanceAuthorities",
  );

  const scenarioCheckpoints = migrated.scenarioCheckpoints;
  if (Array.isArray(scenarioCheckpoints)) {
    for (const scenario of scenarioCheckpoints) {
      if (isRecord(scenario)) {
        scenario.normalizedObservation = [];
      }
    }
  }

  return migrated;
}

function isHistoricalV5Scorecard(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === 5 && isRecord(value.outcomeCoverage);
}

function isHistoricalV6Scorecard(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === 6 && isRecord(value.outcomeCoverage);
}

function migrateHistoricalV6Scorecard(value: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(value) as Record<string, unknown>;
  migrated.proof = KERNEL_CORPUS_SCORECARD_PROOF;
  return migrated;
}

function migrateHistoricalV5Scorecard(value: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(value) as Record<string, unknown>;
  migrated.schemaVersion = KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION;
  migrated.proof = KERNEL_CORPUS_SCORECARD_PROOF;

  const thresholds = ensureRecord(migrated.thresholds);
  moveRecordField(
    thresholds,
    "minimumSemanticOntologyCheckpoints",
    "minimumAttentionOntologyCheckpoints",
  );

  const scenarioCheckpoints = migrated.scenarioCheckpoints;
  if (Array.isArray(scenarioCheckpoints)) {
    for (const scenario of scenarioCheckpoints) {
      if (isRecord(scenario)) {
        moveRecordField(scenario, "semanticOntology", "attentionOntology");
      }
    }
  }

  return migrated;
}

function ensureRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return value;
}

function moveRecordField(record: Record<string, unknown>, from: string, to: string): void {
  if (from in record) {
    record[to] = record[from];
    delete record[from];
  }
}

function pushMinimumFailure(
  failures: string[],
  id: string,
  actual: number,
  threshold: keyof typeof KERNEL_CORPUS_SCORECARD_THRESHOLDS,
): void {
  const expected = KERNEL_CORPUS_SCORECARD_THRESHOLDS[threshold];
  if (!Number.isFinite(actual)) {
    failures.push(`scorecard:${id}:invalid_number`);
    return;
  }
  if (actual < expected) {
    failures.push(`scorecard:${id}:minimum:${actual}<${expected}`);
  }
}

function pushNonNegativeDeltaFailure(failures: string[], id: string, delta: number): void {
  if (!Number.isFinite(delta)) {
    failures.push(`scorecard_comparison:${id}:invalid_delta`);
    return;
  }
  if (delta < 0) {
    failures.push(`scorecard_comparison:${id}:regressed:${delta}`);
  }
}

function pushNonPositiveDeltaFailure(failures: string[], id: string, delta: number): void {
  if (!Number.isFinite(delta)) {
    failures.push(`scorecard_comparison:${id}:invalid_delta`);
    return;
  }
  if (delta > 0) {
    failures.push(`scorecard_comparison:${id}:regressed:+${delta}`);
  }
}

function missingDigests(baseline: readonly string[], candidate: readonly string[]): string[] {
  const candidateDigests = new Set(candidate);
  return baseline.filter((digest) => !candidateDigests.has(digest)).sort(compareKernelCanonicalKey);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
