import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import type { KernelCorpusConformanceReport } from "./kernel-corpus-conformance.js";
import type { ReplayDecisionExpectation, ReplayScenario } from "./scenario.js";

export const KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION = 1 as const;

export const KERNEL_CORPUS_SCORECARD_THRESHOLDS = {
  minimumScenarios: 34,
  minimumCoverageDimensions: 13,
  minimumTotalAssertions: 1421,
  minimumAssertionsPerScenario: 25,
  minimumSemanticOntologyCheckpoints: 38,
  minimumDecisionProjectionCheckpoints: 47,
  minimumRelationCheckpoints: 13,
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
  weakestScenarios: Array<{
    id: string;
    assertionCount: number;
  }>;
};

type ScorecardMetrics = KernelCorpusScorecard["summary"];
type ScorecardMetricsResult = {
  metrics: ScorecardMetrics;
  integrityFailures: string[];
};

export function buildKernelCorpusScorecard(
  report: KernelCorpusConformanceReport,
  scenarios: ReplayScenario[],
): KernelCorpusScorecard {
  const { metrics, integrityFailures } = collectScorecardMetrics(report, scenarios);
  const failures = collectScorecardFailures(report, metrics, integrityFailures);

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
    summary: metrics,
    dimensions: report.dimensionCoverage.dimensions
      .map((dimension) => ({
        id: dimension.id,
        scenarioCount: dimension.presentScenarioIds.length,
      }))
      .sort((left, right) => compareKernelCanonicalKey(left.id, right.id)),
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
  };
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
  const expectations = report.scenarioIds.flatMap((id) =>
    readDigestBoundExpectations(id, scenarioById, resultById, integrityFailures),
  );
  const semanticReadings = expectations.flatMap(
    (expectation) => expectation.semanticReadings ?? [],
  );
  const decisionReadings = expectations.flatMap(
    (expectation) => expectation.decisionReadings ?? [],
  );

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
        total: semanticReadings.length,
        ontology: semanticReadings.filter((reading) => reading.ontology !== undefined).length,
        relation: semanticReadings.filter(
          (reading) =>
            reading.relationKindsInclude !== undefined ||
            reading.relationKindsExact !== undefined ||
            reading.relationHintsExact !== undefined,
        ).length,
      },
      decisionCheckpoints: {
        total: decisionReadings.length,
        projection: decisionReadings.filter(isDecisionProjectionCheckpoint).length,
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
  };
}

function collectScorecardFailures(
  report: KernelCorpusConformanceReport,
  metrics: ScorecardMetrics,
  integrityFailures: string[],
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
    "semantic_ontology_checkpoints",
    metrics.semanticCheckpoints.ontology,
    "minimumSemanticOntologyCheckpoints",
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
  return failures;
}

function readDigestBoundExpectations(
  id: string,
  scenarioById: ReadonlyMap<string, ReplayScenario>,
  resultById: ReadonlyMap<string, { inputDigest: string }>,
  integrityFailures: string[],
): NonNullable<ReplayScenario["expectations"]>[] {
  const scenario = scenarioById.get(id);
  const result = resultById.get(id);
  if (!scenario || !result) {
    integrityFailures.push(`scorecard:missing_digest_bound_scenario:${id}`);
    return [];
  }
  if (digestKernelCanonicalJson(buildScenarioInput(scenario)) !== result.inputDigest) {
    integrityFailures.push(`scorecard:input_digest_mismatch:${id}`);
    return [];
  }
  return scenario.expectations ? [scenario.expectations] : [];
}

function buildScenarioInput(scenario: ReplayScenario): unknown {
  return {
    id: scenario.id,
    core: scenario.core ?? null,
    expectations: scenario.expectations ?? null,
    steps: scenario.steps,
  };
}

function isDecisionProjectionCheckpoint(reading: ReplayDecisionExpectation): boolean {
  return (
    reading.decisionRecordProjectionVersion !== undefined &&
    reading.decisionRecordRoute !== undefined &&
    reading.resultLane !== undefined &&
    (reading.decisionRecordReasonCodesInclude?.length ?? 0) > 0
  );
}

function pushMinimumFailure(
  failures: string[],
  id: string,
  actual: number,
  threshold: keyof typeof KERNEL_CORPUS_SCORECARD_THRESHOLDS,
): void {
  const expected = KERNEL_CORPUS_SCORECARD_THRESHOLDS[threshold];
  if (actual < expected) {
    failures.push(`scorecard:${id}:minimum:${actual}<${expected}`);
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
