import { OBSERVATION_KERNEL_EXPECTATIONS } from "./observation-kernel-expectations.js";
import {
  OBSERVATION_KERNEL_FIXTURES,
  type ObservationKernelFixtureSplit,
} from "./observation-kernel-fixtures.js";
import {
  buildObservationFieldAccuracy,
  buildObservationQualityBreakdown,
  combineObservationAccuracy,
  type ObservationKernelQualityAssertion,
  type ObservationKernelQualityLayer,
} from "./observation-kernel-quality-metrics.js";
import type { ObservationKernelObservation } from "./observation-kernel-scorecard.js";

export const OBSERVATION_KERNEL_QUALITY_THRESHOLDS = {
  minimumCalibrationFixtures: 16,
  minimumHoldoutFixtures: 20,
  minimumSemanticAccuracy: 1,
  minimumJudgmentAccuracy: 1,
  minimumDecisionAccuracy: 1,
  minimumExactOutcomeAccuracy: 1,
} as const;

export type ObservationKernelAccuracy = {
  passed: number;
  total: number;
  score: number;
};

export type ObservationKernelFieldAccuracy = ObservationKernelAccuracy & {
  field: string;
};

export type ObservationKernelQualityBreakdown = {
  semantics: ObservationKernelAccuracy;
  judgment: ObservationKernelAccuracy;
  decision: ObservationKernelAccuracy;
  exactOutcomes: ObservationKernelAccuracy;
};

export type ObservationKernelQuality = {
  thresholds: typeof OBSERVATION_KERNEL_QUALITY_THRESHOLDS;
  passed: boolean;
  failures: string[];
  fixtures: Record<ObservationKernelFixtureSplit, number>;
  summary: ObservationKernelQualityBreakdown;
  bySplit: Record<ObservationKernelFixtureSplit, ObservationKernelQualityBreakdown>;
  semanticFields: ObservationKernelFieldAccuracy[];
  judgmentFields: ObservationKernelFieldAccuracy[];
  decisionFields: ObservationKernelFieldAccuracy[];
};

export function evaluateObservationKernelQuality(
  observations: readonly ObservationKernelObservation[],
): ObservationKernelQuality {
  const failures: string[] = [];
  const assertions: ObservationKernelQualityAssertion[] = [];
  const exact = createSplitCounts();
  const fixtures = countFixturesBySplit();
  const observationsByFixture = groupObservationsByFixture(observations);
  const fixtureIds = new Set(OBSERVATION_KERNEL_FIXTURES.map((fixture) => fixture.id));

  for (const expectationId of Object.keys(OBSERVATION_KERNEL_EXPECTATIONS)) {
    if (!fixtureIds.has(expectationId)) {
      failures.push(`observation_quality:orphan_expectation:${expectationId}`);
    }
  }

  for (const fixture of OBSERVATION_KERNEL_FIXTURES) {
    const expected = OBSERVATION_KERNEL_EXPECTATIONS[fixture.id];
    const actual = observationsByFixture.get(fixture.id) ?? [];
    if (expected === undefined) {
      failures.push(`observation_quality:missing_expectation:${fixture.id}`);
      continue;
    }
    if (actual.length !== expected.length) {
      failures.push(
        `observation_quality:outcome_count:${fixture.id}:${actual.length}!=${expected.length}`,
      );
    }

    const count = Math.max(actual.length, expected.length);
    for (let sequence = 0; sequence < count; sequence += 1) {
      const actualOutcome = actual[sequence];
      const expectedOutcome = expected[sequence];
      exact[fixture.split].total += 1;
      if (actualOutcome === undefined || expectedOutcome === undefined) continue;

      const before = failures.length;
      compareRecord(
        fixture.id,
        sequence,
        fixture.split,
        "semantics",
        expectedOutcome.fields,
        actualOutcome.fields,
        assertions,
        failures,
      );
      compareRecord(
        fixture.id,
        sequence,
        fixture.split,
        "judgment",
        expectedOutcome.judgment,
        actualOutcome.judgment,
        assertions,
        failures,
      );
      compareRecord(
        fixture.id,
        sequence,
        fixture.split,
        "decision",
        expectedOutcome.decision,
        actualOutcome.decision,
        assertions,
        failures,
      );
      if (failures.length === before) exact[fixture.split].passed += 1;
    }
  }

  const bySplit = {
    calibration: buildObservationQualityBreakdown(assertions, exact.calibration, "calibration"),
    holdout: buildObservationQualityBreakdown(assertions, exact.holdout, "holdout"),
  };
  const summary = buildObservationQualityBreakdown(
    assertions,
    combineObservationAccuracy(exact),
    null,
  );
  collectThresholdFailures({ fixtures, summary, failures });

  return {
    thresholds: OBSERVATION_KERNEL_QUALITY_THRESHOLDS,
    passed: failures.length === 0,
    failures,
    fixtures,
    summary,
    bySplit,
    semanticFields: buildObservationFieldAccuracy(assertions, "semantics"),
    judgmentFields: buildObservationFieldAccuracy(assertions, "judgment"),
    decisionFields: buildObservationFieldAccuracy(assertions, "decision"),
  };
}

function compareRecord(
  fixtureId: string,
  sequence: number,
  split: ObservationKernelFixtureSplit,
  layer: ObservationKernelQualityLayer,
  expected: object,
  actual: object,
  assertions: ObservationKernelQualityAssertion[],
  failures: string[],
): void {
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = (actual as Record<string, unknown>)[field];
    const passed = actualValue === expectedValue;
    assertions.push({ split, layer, field, passed });
    if (!passed) {
      failures.push(
        `observation_quality:${split}:${fixtureId}:${sequence}:${layer}:${field}:${String(actualValue)}!=${String(expectedValue)}`,
      );
    }
  }
}

function groupObservationsByFixture(
  observations: readonly ObservationKernelObservation[],
): Map<string, ObservationKernelObservation[]> {
  const grouped = new Map<string, ObservationKernelObservation[]>();
  for (const observation of observations) {
    const current = grouped.get(observation.fixtureId) ?? [];
    current.push(observation);
    grouped.set(observation.fixtureId, current);
  }
  for (const current of grouped.values())
    current.sort((left, right) => left.sequence - right.sequence);
  return grouped;
}

function countFixturesBySplit(): Record<ObservationKernelFixtureSplit, number> {
  return OBSERVATION_KERNEL_FIXTURES.reduce(
    (counts, fixture) => {
      counts[fixture.split] += 1;
      return counts;
    },
    { calibration: 0, holdout: 0 },
  );
}

function createSplitCounts(): Record<ObservationKernelFixtureSplit, ObservationKernelAccuracy> {
  return {
    calibration: { passed: 0, total: 0, score: 0 },
    holdout: { passed: 0, total: 0, score: 0 },
  };
}

function collectThresholdFailures(input: {
  fixtures: Record<ObservationKernelFixtureSplit, number>;
  summary: ObservationKernelQualityBreakdown;
  failures: string[];
}): void {
  const thresholds = OBSERVATION_KERNEL_QUALITY_THRESHOLDS;
  if (input.fixtures.calibration < thresholds.minimumCalibrationFixtures)
    input.failures.push("observation_quality:insufficient_calibration_fixtures");
  if (input.fixtures.holdout < thresholds.minimumHoldoutFixtures)
    input.failures.push("observation_quality:insufficient_holdout_fixtures");
  if (input.summary.semantics.score < thresholds.minimumSemanticAccuracy)
    input.failures.push("observation_quality:semantic_accuracy_below_threshold");
  if (input.summary.judgment.score < thresholds.minimumJudgmentAccuracy)
    input.failures.push("observation_quality:judgment_accuracy_below_threshold");
  if (input.summary.decision.score < thresholds.minimumDecisionAccuracy)
    input.failures.push("observation_quality:decision_accuracy_below_threshold");
  if (input.summary.exactOutcomes.score < thresholds.minimumExactOutcomeAccuracy)
    input.failures.push("observation_quality:exact_outcome_accuracy_below_threshold");
}
