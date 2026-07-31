import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import { isCandidateTrace } from "@tomismeta/aperture-core/internal";
import type { KernelCorpusConformanceReport } from "./kernel-corpus-conformance.js";
import {
  collectKernelCorpusScenarioCheckpoints,
  parseKernelCorpusScorecardValue,
} from "./kernel-corpus-scorecard-support.js";
import { runReplayScenario } from "./runner.js";
import type { ReplayScenario, ReplayScenarioExpectations } from "./scenario.js";

export const KERNEL_CORPUS_SCORECARD_SCHEMA_VERSION = 3 as const;
export const KERNEL_CORPUS_SCORECARD_COMPARISON_SCHEMA_VERSION = 2 as const;

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
  outcomeCoverage: KernelCorpusScorecardOutcomeCoverage;
  weakestScenarios: Array<{
    id: string;
    assertionCount: number;
  }>;
  scenarioCheckpoints: KernelCorpusScorecardScenarioCheckpoints[];
};

export type KernelCorpusScorecardScenarioCheckpoints = {
  id: string;
  semanticOntology: string[];
  relation: string[];
  decisionProjection: string[];
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
    semanticOntologyCheckpoints: number;
    relationCheckpoints: number;
    decisionProjectionCheckpoints: number;
  };
  dimensionDeltas: Array<{
    id: string;
    baselineScenarioCount: number;
    candidateScenarioCount: number;
    delta: number;
  }>;
  scenarioCheckpointDeltas: Array<{
    id: string;
    missingSemanticOntology: string[];
    missingRelation: string[];
    missingDecisionProjection: string[];
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
    semanticOntologyCheckpoints:
      candidate.summary.semanticCheckpoints.ontology -
      baseline.summary.semanticCheckpoints.ontology,
    relationCheckpoints:
      candidate.summary.semanticCheckpoints.relation -
      baseline.summary.semanticCheckpoints.relation,
    decisionProjectionCheckpoints:
      candidate.summary.decisionCheckpoints.projection -
      baseline.summary.decisionCheckpoints.projection,
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
  const scenarioCheckpoints = checkpointResults.map((result) => result.checkpoints);
  integrityFailures.push(...checkpointResults.flatMap((result) => result.failures));
  const semanticOntologyCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.semanticOntology.length),
  );
  const relationCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.relation.length),
  );
  const decisionProjectionCheckpointCount = sum(
    scenarioCheckpoints.map((scenario) => scenario.decisionProjection.length),
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
        total: semanticOntologyCheckpointCount + relationCheckpointCount,
        ontology: semanticOntologyCheckpointCount,
        relation: relationCheckpointCount,
      },
      decisionCheckpoints: {
        total: decisionProjectionCheckpointCount,
        projection: decisionProjectionCheckpointCount,
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
  failures.push(...collectOutcomeCoverageFailures(outcomeCoverage));
  return failures;
}

function collectOutcomeCoverageFailures(coverage: KernelCorpusScorecardOutcomeCoverage): string[] {
  return listOutcomeCoverageDistributions(coverage)
    .filter(({ distribution }) => distribution.length === 0)
    .map(({ path }) => `scorecard:empty_outcome_coverage:${path}`);
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
        missingSemanticOntology: missingDigests(
          scenario.semanticOntology,
          candidateScenario?.semanticOntology ?? [],
        ),
        missingRelation: missingDigests(scenario.relation, candidateScenario?.relation ?? []),
        missingDecisionProjection: missingDigests(
          scenario.decisionProjection,
          candidateScenario?.decisionProjection ?? [],
        ),
      };
    })
    .filter(
      (scenario) =>
        scenario.missingSemanticOntology.length > 0 ||
        scenario.missingRelation.length > 0 ||
        scenario.missingDecisionProjection.length > 0,
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
    "semantic_ontology_checkpoints",
    deltas.semanticOntologyCheckpoints,
  );
  pushNonNegativeDeltaFailure(failures, "relation_checkpoints", deltas.relationCheckpoints);
  pushNonNegativeDeltaFailure(
    failures,
    "decision_projection_checkpoints",
    deltas.decisionProjectionCheckpoints,
  );

  for (const dimension of dimensionDeltas) {
    if (dimension.delta < 0) {
      failures.push(`scorecard_comparison:dimension:${dimension.id}:regressed:${dimension.delta}`);
    }
  }

  for (const scenario of scenarioCheckpointDeltas) {
    for (const digest of scenario.missingSemanticOntology) {
      failures.push(
        `scorecard_comparison:scenario:${scenario.id}:missing_semantic_ontology:${digest}`,
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
        trace.evaluation.adjusted.judgmentInput.failureEvidence?.failureDetail,
        id,
      );
    }
  }

  return finalizeOutcomeCoverage(accumulators);
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

function compareOutcomeCoverage(
  baseline: KernelCorpusScorecard,
  candidate: KernelCorpusScorecard,
): KernelCorpusScorecardComparison["outcomeCoverageDeltas"] {
  const deltas: KernelCorpusScorecardComparison["outcomeCoverageDeltas"] = [];
  const baselineDistributions = flattenOutcomeCoverage(baseline.outcomeCoverage);
  const candidateDistributions = new Map(
    flattenOutcomeCoverage(candidate.outcomeCoverage).map((entry) => [
      `${entry.path}\0${entry.id}`,
      entry,
    ]),
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

  return deltas.sort(
    (left, right) =>
      compareKernelCanonicalKey(left.path, right.path) ||
      compareKernelCanonicalKey(left.id, right.id),
  );
}

function flattenOutcomeCoverage(coverage: KernelCorpusScorecardOutcomeCoverage): Array<{
  path: string;
  id: string;
  count: number;
  scenarioCount: number;
  scenarioIds: string[];
}> {
  return listOutcomeCoverageDistributions(coverage).flatMap(({ path, distribution }) =>
    flattenOutcomeDistribution(path, distribution),
  );
}

function listOutcomeCoverageDistributions(coverage: KernelCorpusScorecardOutcomeCoverage): Array<{
  path: string;
  distribution: KernelCorpusScorecardOutcomeDistribution;
}> {
  return [
    { path: "semantic.intentFrames", distribution: coverage.semantic.intentFrames },
    { path: "semantic.activityClasses", distribution: coverage.semantic.activityClasses },
    { path: "semantic.toolFamilies", distribution: coverage.semantic.toolFamilies },
    { path: "semantic.consequences", distribution: coverage.semantic.consequences },
    { path: "semantic.confidences", distribution: coverage.semantic.confidences },
    { path: "semantic.ontologyActivities", distribution: coverage.semantic.ontologyActivities },
    { path: "semantic.ontologyConsequences", distribution: coverage.semantic.ontologyConsequences },
    { path: "semantic.ontologySources", distribution: coverage.semantic.ontologySources },
    { path: "judgment.evaluationKinds", distribution: coverage.judgment.evaluationKinds },
    { path: "judgment.decisionKinds", distribution: coverage.judgment.decisionKinds },
    {
      path: "judgment.decisionRecordRoutes",
      distribution: coverage.judgment.decisionRecordRoutes,
    },
    { path: "judgment.plannedLanes", distribution: coverage.judgment.plannedLanes },
    { path: "judgment.resultLanes", distribution: coverage.judgment.resultLanes },
    {
      path: "judgment.candidateConsequences",
      distribution: coverage.judgment.candidateConsequences,
    },
    { path: "judgment.semanticConfidences", distribution: coverage.judgment.semanticConfidences },
    { path: "judgment.failureDetails", distribution: coverage.judgment.failureDetails },
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
