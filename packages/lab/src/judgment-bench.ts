import type {
  ReplayDecisionExpectation,
  ReplayDecisionSnapshot,
  ReplayExplanationExpectation,
  ReplayScenario,
  ReplayScenarioExpectations,
  ReplaySemanticExpectation,
  ReplaySemanticSnapshot,
  ReplayTraceExpectation,
} from "./scenario.js";
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
      totalSemanticReadings: number;
      totalDecisionReadings: number;
      totalAmbiguousDecisions: number;
      totalAmbiguousQueued: number;
      totalAmbiguousAmbient: number;
      totalAmbiguousQueuedThenActivated: number;
      totalAmbiguousAmbientThenActivated: number;
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
    const assertions = evaluateScenarioExpectations(scenario.expectations, scorecard, run);

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
      totalSemanticReadings: sum(results.map((result) => result.run.semantics.length)),
      totalDecisionReadings: sum(results.map((result) => result.run.decisions.length)),
      totalAmbiguousDecisions: sum(
        results.map((result) => result.run.decisions.filter((decision) => decision.ambiguity !== null && decision.ambiguity !== undefined).length),
      ),
      totalAmbiguousQueued: sum(results.map((result) => result.scorecard.trace?.ambiguousNext ?? 0)),
      totalAmbiguousAmbient: sum(results.map((result) => result.scorecard.trace?.ambiguousAmbient ?? 0)),
      totalAmbiguousQueuedThenActivated: sum(results.map((result) => result.scorecard.trace?.ambiguousNextThenActivated ?? 0)),
      totalAmbiguousAmbientThenActivated: sum(results.map((result) => result.scorecard.trace?.ambiguousAmbientThenActivated ?? 0)),
      totalCandidates: sum(results.map((result) => result.scorecard.trace?.totalCandidates ?? 0)),
      totalActiveBuckets: sum(results.map((result) => result.scorecard.buckets.now)),
      totalQueuedBuckets: sum(results.map((result) => result.scorecard.buckets.next)),
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
  run: ReplayRunResult,
): JudgmentBenchAssertionResult[] {
  if (!expectations) {
    return [];
  }

  const assertions: JudgmentBenchAssertionResult[] = [];

  if ("finalNowInteractionId" in expectations) {
    assertions.push({
      name: "final now interaction",
      passed: scorecard.outcomes.finalNowInteractionId === expectations.finalNowInteractionId,
      expected: expectations.finalNowInteractionId,
      actual: scorecard.outcomes.finalNowInteractionId,
    });
  }

  if (expectations.nextInteractionIds) {
    assertions.push({
      name: "next interactions",
      passed: sameStringSet(scorecard.outcomes.finalNextInteractionIds, expectations.nextInteractionIds),
      expected: expectations.nextInteractionIds,
      actual: scorecard.outcomes.finalNextInteractionIds,
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

  if (expectations.resultLaneCounts?.now !== undefined) {
    assertions.push({
      name: "now result lanes",
      passed: scorecard.buckets.now === expectations.resultLaneCounts.now,
      expected: expectations.resultLaneCounts.now,
      actual: scorecard.buckets.now,
    });
  }

  if (expectations.resultLaneCounts?.next !== undefined) {
    assertions.push({
      name: "next result lanes",
      passed: scorecard.buckets.next === expectations.resultLaneCounts.next,
      expected: expectations.resultLaneCounts.next,
      actual: scorecard.buckets.next,
    });
  }

  if (expectations.resultLaneCounts?.ambient !== undefined) {
    assertions.push({
      name: "ambient result buckets",
      passed: scorecard.buckets.ambient === expectations.resultLaneCounts.ambient,
      expected: expectations.resultLaneCounts.ambient,
      actual: scorecard.buckets.ambient,
    });
  }

  for (const semanticExpectation of expectations.semanticReadings ?? []) {
    assertions.push(...evaluateSemanticExpectation(semanticExpectation, run.semantics));
  }

  for (const decisionExpectation of expectations.decisionReadings ?? []) {
    assertions.push(...evaluateDecisionExpectation(decisionExpectation, run.decisions));
  }

  if (expectations.explanationExpectation) {
    assertions.push(...evaluateExplanationExpectation(expectations.explanationExpectation, scorecard));
  }

  if (expectations.traceExpectations) {
    assertions.push(...evaluateTraceExpectation(expectations.traceExpectations, scorecard.trace));
  }

  return assertions;
}

function evaluateSemanticExpectation(
  expectation: ReplaySemanticExpectation,
  semantics: ReplaySemanticSnapshot[],
): JudgmentBenchAssertionResult[] {
  const target = findSemanticSnapshot(expectation, semantics);
  const targetKey = expectation.stepLabel
    ? `semantic reading (${expectation.stepLabel})`
    : `semantic reading (step ${expectation.stepIndex ?? "?"})`;

  if (!target) {
    return [{
      name: `${targetKey} present`,
      passed: false,
      expected: expectation.stepLabel ?? expectation.stepIndex ?? "matching semantic snapshot",
      actual: null,
    }];
  }

  const assertions: JudgmentBenchAssertionResult[] = [];
  const semantic = target.interpretation;

  pushFieldAssertion(assertions, `${targetKey} intent frame`, expectation.intentFrame, semantic.intentFrame);
  pushFieldAssertion(assertions, `${targetKey} activity class`, expectation.activityClass, semantic.activityClass);
  pushFieldAssertion(assertions, `${targetKey} tool family`, expectation.toolFamily, semantic.toolFamily ?? null);
  pushFieldAssertion(assertions, `${targetKey} consequence`, expectation.consequence, semantic.consequence);
  pushFieldAssertion(assertions, `${targetKey} confidence`, expectation.confidence, semantic.confidence);
  pushFieldAssertion(assertions, `${targetKey} abstained`, expectation.abstained, semantic.abstained ?? false);

  if (expectation.whyNowIncludes !== undefined) {
    assertions.push({
      name: `${targetKey} whyNow includes`,
      passed: typeof semantic.whyNow === "string" && semantic.whyNow.includes(expectation.whyNowIncludes),
      expected: expectation.whyNowIncludes,
      actual: semantic.whyNow ?? null,
    });
  }

  if (expectation.reasonsInclude && expectation.reasonsInclude.length > 0) {
    assertions.push({
      name: `${targetKey} reasons include`,
      passed: expectation.reasonsInclude.every((reason) => semantic.reasons.includes(reason)),
      expected: expectation.reasonsInclude,
      actual: semantic.reasons,
    });
  }

  if (expectation.factorsInclude && expectation.factorsInclude.length > 0) {
    assertions.push({
      name: `${targetKey} factors include`,
      passed: expectation.factorsInclude.every((factor) => semantic.factors.includes(factor)),
      expected: expectation.factorsInclude,
      actual: semantic.factors,
    });
  }

  if (expectation.relationKindsInclude && expectation.relationKindsInclude.length > 0) {
    assertions.push({
      name: `${targetKey} relation kinds include`,
      passed: expectation.relationKindsInclude.every((kind) => semantic.relationHints.some((hint) => hint.kind === kind)),
      expected: expectation.relationKindsInclude,
      actual: semantic.relationHints.map((hint) => hint.kind),
    });
  }

  if (expectation.relationKindsExact !== undefined) {
    const actualKinds = semantic.relationHints.map((hint) => hint.kind);
    assertions.push({
      name: `${targetKey} relation kinds exact`,
      passed: sameStringSet(actualKinds, expectation.relationKindsExact),
      expected: expectation.relationKindsExact,
      actual: actualKinds,
    });
  }

  if (expectation.provenanceIncludes) {
    for (const [field, expectedOrigin] of Object.entries(expectation.provenanceIncludes)) {
      const actualOrigin = semantic.provenance?.[
        field as keyof NonNullable<typeof semantic.provenance>
      ] ?? null;
      assertions.push({
        name: `${targetKey} provenance ${field}`,
        passed: actualOrigin === expectedOrigin,
        expected: expectedOrigin,
        actual: actualOrigin,
      });
    }
  }

  return assertions;
}

function findSemanticSnapshot(
  expectation: ReplaySemanticExpectation,
  semantics: ReplaySemanticSnapshot[],
): ReplaySemanticSnapshot | undefined {
  if (expectation.stepLabel !== undefined) {
    return semantics.find((snapshot) => snapshot.stepLabel === expectation.stepLabel);
  }

  if (expectation.stepIndex !== undefined) {
    return semantics.find((snapshot) => snapshot.stepIndex === expectation.stepIndex);
  }

  return undefined;
}

function evaluateDecisionExpectation(
  expectation: ReplayDecisionExpectation,
  decisions: ReplayDecisionSnapshot[],
): JudgmentBenchAssertionResult[] {
  const target = findDecisionSnapshot(expectation, decisions);
  const targetKey = expectation.stepLabel
    ? `decision reading (${expectation.stepLabel})`
    : `decision reading (step ${expectation.stepIndex ?? "?"})`;

  if (!target) {
    return [{
      name: `${targetKey} present`,
      passed: false,
      expected: expectation.stepLabel ?? expectation.stepIndex ?? "matching decision snapshot",
      actual: null,
    }];
  }

  const assertions: JudgmentBenchAssertionResult[] = [];

  pushFieldAssertion(assertions, `${targetKey} evaluation kind`, expectation.evaluationKind, target.evaluationKind);
  pushFieldAssertion(assertions, `${targetKey} decision kind`, expectation.decisionKind, target.decisionKind);
  pushFieldAssertion(assertions, `${targetKey} result bucket`, expectation.resultLane, target.resultLane);
  pushFieldAssertion(assertions, `${targetKey} semantic confidence`, expectation.semanticConfidence, target.semanticConfidence);
  pushFieldAssertion(assertions, `${targetKey} semantic abstained`, expectation.semanticAbstained, target.semanticAbstained ?? false);
  pushFieldAssertion(assertions, `${targetKey} ambiguity reason`, expectation.ambiguityReason, target.ambiguity?.reason ?? null);
  pushFieldAssertion(assertions, `${targetKey} ambiguity resolution`, expectation.ambiguityResolution, target.ambiguity?.resolution ?? null);

  if (expectation.semanticInfluenceIncludes && expectation.semanticInfluenceIncludes.length > 0) {
    assertions.push({
      name: `${targetKey} semantic influence includes`,
      passed: expectation.semanticInfluenceIncludes.every((snippet) =>
        (target.semanticInfluence ?? []).some((entry) => entry.includes(snippet))
      ),
      expected: expectation.semanticInfluenceIncludes,
      actual: target.semanticInfluence ?? [],
    });
  }

  if (expectation.semanticImpactDecisionBearingIncludes && expectation.semanticImpactDecisionBearingIncludes.length > 0) {
    assertions.push({
      name: `${targetKey} semantic impact decision-bearing includes`,
      passed: expectation.semanticImpactDecisionBearingIncludes.every((value) =>
        (target.semanticImpactDecisionBearing ?? []).includes(value)
      ),
      expected: expectation.semanticImpactDecisionBearingIncludes,
      actual: target.semanticImpactDecisionBearing ?? [],
    });
  }

  if (expectation.semanticImpactExplanatoryIncludes && expectation.semanticImpactExplanatoryIncludes.length > 0) {
    assertions.push({
      name: `${targetKey} semantic impact explanatory includes`,
      passed: expectation.semanticImpactExplanatoryIncludes.every((value) =>
        (target.semanticImpactExplanatory ?? []).includes(value)
      ),
      expected: expectation.semanticImpactExplanatoryIncludes,
      actual: target.semanticImpactExplanatory ?? [],
    });
  }

  return assertions;
}

function evaluateExplanationExpectation(
  expectation: ReplayExplanationExpectation,
  scorecard: ReplayScorecard,
): JudgmentBenchAssertionResult[] {
  const assertions: JudgmentBenchAssertionResult[] = [];
  const explanation = scorecard.explanation;

  if (expectation.whyNowIncludes !== undefined) {
    assertions.push({
      name: "explanation whyNow includes",
      passed: typeof explanation.whyNow === "string" && explanation.whyNow.includes(expectation.whyNowIncludes),
      expected: expectation.whyNowIncludes,
      actual: explanation.whyNow ?? null,
    });
  }

  if (expectation.continuityRationaleIncludes && expectation.continuityRationaleIncludes.length > 0) {
    assertions.push({
      name: "explanation continuity rationale includes",
      passed: expectation.continuityRationaleIncludes.every((expectedSnippet) =>
        explanation.continuityRationale.some((rationale) => rationale.includes(expectedSnippet))
      ),
      expected: expectation.continuityRationaleIncludes,
      actual: explanation.continuityRationale,
    });
  }

  return assertions;
}

function evaluateTraceExpectation(
  expectation: ReplayTraceExpectation,
  trace: ReplayScorecard["trace"],
): JudgmentBenchAssertionResult[] {
  const assertions: JudgmentBenchAssertionResult[] = [];

  pushFieldAssertion(assertions, "trace ambiguous decisions", expectation.ambiguousDecisions, trace.ambiguousDecisions);
  pushFieldAssertion(assertions, "trace ambiguous queued", expectation.ambiguousNext, trace.ambiguousNext);
  pushFieldAssertion(assertions, "trace ambiguous ambient", expectation.ambiguousAmbient, trace.ambiguousAmbient);
  pushFieldAssertion(assertions, "trace ambiguous low confidence", expectation.ambiguousLowConfidence, trace.ambiguousLowConfidence);
  pushFieldAssertion(assertions, "trace ambiguous abstained", expectation.ambiguousAbstained, trace.ambiguousAbstained);
  pushFieldAssertion(assertions, "trace ambiguous queued then activated", expectation.ambiguousNextThenActivated, trace.ambiguousNextThenActivated);
  pushFieldAssertion(assertions, "trace ambiguous ambient then activated", expectation.ambiguousAmbientThenActivated, trace.ambiguousAmbientThenActivated);
  pushFieldAssertion(assertions, "trace actionable episodes", expectation.actionableEpisodes, trace.actionableEpisodes);
  pushFieldAssertion(assertions, "trace actionable surfaced", expectation.actionableSurfaced, trace.actionableSurfaced);
  pushFieldAssertion(assertions, "trace actionable activated", expectation.actionableActivated, trace.actionableActivated);
  pushFieldAssertion(assertions, "trace deferred then activated", expectation.deferredThenActivated, trace.deferredThenActivated);
  pushFieldAssertion(assertions, "trace suppressed then activated", expectation.suppressedThenActivated, trace.suppressedThenActivated);
  pushFieldAssertion(assertions, "trace merged episode updates", expectation.mergedEpisodeUpdates, trace.mergedEpisodeUpdates);

  return assertions;
}

function findDecisionSnapshot(
  expectation: ReplayDecisionExpectation,
  decisions: ReplayDecisionSnapshot[],
): ReplayDecisionSnapshot | undefined {
  if (expectation.stepLabel !== undefined) {
    return decisions.find((snapshot) => snapshot.stepLabel === expectation.stepLabel);
  }

  if (expectation.stepIndex !== undefined) {
    return decisions.find((snapshot) => snapshot.stepIndex === expectation.stepIndex);
  }

  return undefined;
}

function pushFieldAssertion(
  assertions: JudgmentBenchAssertionResult[],
  name: string,
  expected: unknown,
  actual: unknown,
): void {
  if (expected === undefined) {
    return;
  }

  assertions.push({
    name,
    passed: actual === expected,
    expected,
    actual,
  });
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
