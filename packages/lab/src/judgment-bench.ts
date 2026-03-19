import type { ReplayScenario, ReplayScenarioExpectations } from "./scenario.js";
import { runReplayScenario, type ReplayRunResult } from "./runner.js";
import { scoreReplayRun, type ReplayScorecard } from "./scorecard.js";
import { loadGoldenScenarios } from "./golden.js";

export type JudgmentBenchScenarioResult = {
  scenario: ReplayScenario;
  run: ReplayRunResult;
  scorecard: ReplayScorecard;
  assertions: JudgmentBenchAssertionResult[];
  passed: boolean;
};

export type JudgmentBenchAssertionResult = {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type JudgmentBenchDoctrineHealth = {
  doctrine: string;
  scenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  healthScore: number;
};

export type JudgmentBenchRun = {
  benchmark: "JudgmentBench";
  generatedAt: string;
  scenarios: JudgmentBenchScenarioResult[];
  summary: {
      totalScenarios: number;
      passedScenarios: number;
      failedScenarios: number;
      totalAssertions: number;
      passedAssertions: number;
      failedAssertions: number;
      benchmarkScore: number;
      totalCandidates: number;
      totalActiveBuckets: number;
      totalQueuedBuckets: number;
      totalAmbientBuckets: number;
      totalResponses: number;
      totalPresentedSignals: number;
  };
  doctrineHealth: JudgmentBenchDoctrineHealth[];
};

export async function runJudgmentBench(
  scenarios?: ReplayScenario[],
): Promise<JudgmentBenchRun> {
  const loadedScenarios = scenarios ?? await loadGoldenScenarios();
  const results = loadedScenarios.map((scenario) => {
    const run = runReplayScenario(scenario);
    const scorecard = scoreReplayRun(run);
    const assertions = evaluateScenarioExpectations(scenario.expectations, scorecard);

    return {
      scenario,
      run,
      scorecard,
      assertions,
      passed: assertions.every((assertion) => assertion.passed),
    };
  });

  const totalAssertions = sum(results.map((result) => result.assertions.length));
  const passedAssertions = sum(
    results.map((result) => result.assertions.filter((assertion) => assertion.passed).length),
  );
  const passedScenarios = results.filter((result) => result.passed).length;
  const failedScenarios = results.length - passedScenarios;

  return {
    benchmark: "JudgmentBench",
    generatedAt: new Date().toISOString(),
    scenarios: results,
    summary: {
      totalScenarios: results.length,
      passedScenarios,
      failedScenarios,
      totalAssertions,
      passedAssertions,
      failedAssertions: totalAssertions - passedAssertions,
      benchmarkScore: totalAssertions === 0 ? 1 : passedAssertions / totalAssertions,
      totalCandidates: sum(results.map((result) => result.scorecard.trace.totalCandidates)),
      totalActiveBuckets: sum(results.map((result) => result.scorecard.buckets.active)),
      totalQueuedBuckets: sum(results.map((result) => result.scorecard.buckets.queued)),
      totalAmbientBuckets: sum(results.map((result) => result.scorecard.buckets.ambient)),
      totalResponses: sum(results.map((result) => result.run.responses.length)),
      totalPresentedSignals: sum(results.map((result) => result.scorecard.signals.presented)),
    },
    doctrineHealth: buildDoctrineHealth(results),
  };
}

function evaluateScenarioExpectations(
  expectations: ReplayScenarioExpectations | undefined,
  scorecard: ReplayScorecard,
): JudgmentBenchAssertionResult[] {
  if (!expectations) {
    return [];
  }

  const assertions: JudgmentBenchAssertionResult[] = [];

  if ("finalActiveInteractionId" in expectations) {
    assertions.push({
      name: "final active interaction",
      passed: scorecard.outcomes.finalActiveInteractionId === expectations.finalActiveInteractionId,
      expected: expectations.finalActiveInteractionId,
      actual: scorecard.outcomes.finalActiveInteractionId,
    });
  }

  if (expectations.queuedInteractionIds) {
    assertions.push({
      name: "queued interactions",
      passed: sameStringSet(scorecard.outcomes.finalQueuedInteractionIds, expectations.queuedInteractionIds),
      expected: expectations.queuedInteractionIds,
      actual: scorecard.outcomes.finalQueuedInteractionIds,
    });
  }

  if (expectations.ambientInteractionIds) {
    assertions.push({
      name: "ambient interactions",
      passed: sameStringSet(scorecard.outcomes.finalAmbientInteractionIds, expectations.ambientInteractionIds),
      expected: expectations.ambientInteractionIds,
      actual: scorecard.outcomes.finalAmbientInteractionIds,
    });
  }

  if (expectations.resultBucketCounts?.active !== undefined) {
    assertions.push({
      name: "active result buckets",
      passed: scorecard.buckets.active === expectations.resultBucketCounts.active,
      expected: expectations.resultBucketCounts.active,
      actual: scorecard.buckets.active,
    });
  }

  if (expectations.resultBucketCounts?.queued !== undefined) {
    assertions.push({
      name: "queued result buckets",
      passed: scorecard.buckets.queued === expectations.resultBucketCounts.queued,
      expected: expectations.resultBucketCounts.queued,
      actual: scorecard.buckets.queued,
    });
  }

  if (expectations.resultBucketCounts?.ambient !== undefined) {
    assertions.push({
      name: "ambient result buckets",
      passed: scorecard.buckets.ambient === expectations.resultBucketCounts.ambient,
      expected: expectations.resultBucketCounts.ambient,
      actual: scorecard.buckets.ambient,
    });
  }

  return assertions;
}

function buildDoctrineHealth(
  results: JudgmentBenchScenarioResult[],
): JudgmentBenchDoctrineHealth[] {
  const byDoctrine = new Map<string, { scenarios: number; passedScenarios: number }>();

  for (const result of results) {
    for (const doctrine of result.scenario.doctrineTags ?? []) {
      const current = byDoctrine.get(doctrine) ?? { scenarios: 0, passedScenarios: 0 };
      current.scenarios += 1;
      if (result.passed) {
        current.passedScenarios += 1;
      }
      byDoctrine.set(doctrine, current);
    }
  }

  return [...byDoctrine.entries()]
    .map(([doctrine, entry]) => ({
      doctrine,
      scenarios: entry.scenarios,
      passedScenarios: entry.passedScenarios,
      failedScenarios: entry.scenarios - entry.passedScenarios,
      healthScore: entry.scenarios === 0 ? 1 : entry.passedScenarios / entry.scenarios,
    }))
    .sort((left, right) => left.doctrine.localeCompare(right.doctrine));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
