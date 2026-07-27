import type { ReplayDecisionExpectation, ReplayDecisionSnapshot } from "./scenario.js";

type JudgmentBenchAssertionResult = {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export function evaluateDecisionExpectation(
  expectation: ReplayDecisionExpectation,
  decisions: ReplayDecisionSnapshot[],
): JudgmentBenchAssertionResult[] {
  const target = findDecisionSnapshot(expectation, decisions);
  const targetKey = expectation.stepLabel
    ? `decision reading (${expectation.stepLabel})`
    : `decision reading (step ${expectation.stepIndex ?? "?"})`;

  if (!target) {
    return [
      {
        name: `${targetKey} present`,
        passed: false,
        expected: expectation.stepLabel ?? expectation.stepIndex ?? "matching decision snapshot",
        actual: null,
      },
    ];
  }

  const assertions: JudgmentBenchAssertionResult[] = [];

  pushFieldAssertions(assertions, targetKey, expectation, target);
  pushRouteConsistencyAssertion(assertions, targetKey, target);
  pushValueComponentAssertion(assertions, targetKey, expectation, target);
  pushContainedStringAssertion(
    assertions,
    `${targetKey} decision record reasons include`,
    expectation.decisionRecordReasonsInclude,
    target.decisionRecordReasons,
  );
  pushIncludedStringsAssertion(
    assertions,
    `${targetKey} decision record reason codes include`,
    expectation.decisionRecordReasonCodesInclude,
    target.decisionRecordReasonCodes,
  );
  pushIncludedStringsAssertion(
    assertions,
    `${targetKey} episode evidence reasons include`,
    expectation.episodeEvidenceReasonsInclude,
    target.episodeEvidenceReasons,
  );
  pushContainedStringAssertion(
    assertions,
    `${targetKey} semantic influence includes`,
    expectation.semanticInfluenceIncludes,
    target.semanticInfluence,
  );
  pushIncludedStringsAssertion(
    assertions,
    `${targetKey} semantic impact decision-bearing includes`,
    expectation.semanticImpactDecisionBearingIncludes,
    target.semanticImpactDecisionBearing,
  );
  pushIncludedStringsAssertion(
    assertions,
    `${targetKey} semantic impact explanatory includes`,
    expectation.semanticImpactExplanatoryIncludes,
    target.semanticImpactExplanatory,
  );

  return assertions;
}

function pushFieldAssertions(
  assertions: JudgmentBenchAssertionResult[],
  targetKey: string,
  expectation: ReplayDecisionExpectation,
  target: ReplayDecisionSnapshot,
): void {
  const fields = [
    ["evaluation kind", expectation.evaluationKind, target.evaluationKind],
    ["decision kind", expectation.decisionKind, target.decisionKind],
    [
      "decision record projection version",
      expectation.decisionRecordProjectionVersion,
      target.decisionRecordProjectionVersion,
    ],
    ["decision record route", expectation.decisionRecordRoute, target.decisionRecordRoute],
    ["planned lane", expectation.plannedLane, target.plannedLane],
    ["result lane", expectation.resultLane, target.resultLane],
    ["semantic confidence", expectation.semanticConfidence, target.semanticConfidence],
    ["semantic abstained", expectation.semanticAbstained, target.semanticAbstained ?? false],
    ["ambiguity reason", expectation.ambiguityReason, target.ambiguity?.reason ?? null],
    ["ambiguity resolution", expectation.ambiguityResolution, target.ambiguity?.resolution ?? null],
    ["episode id", expectation.episodeId, target.episodeId],
    ["episode key", expectation.episodeKey, target.episodeKey],
    ["episode state", expectation.episodeState, target.episodeState],
    ["episode size", expectation.episodeSize, target.episodeSize],
    ["episode evidence score", expectation.episodeEvidenceScore, target.episodeEvidenceScore],
    ["episode obsolete", expectation.episodeObsolete, target.episodeObsolete ?? false],
    [
      "decision record current frame",
      expectation.decisionRecordCurrentFrameId,
      target.decisionRecordCurrentFrameId,
    ],
    [
      "decision record current episode",
      expectation.decisionRecordCurrentEpisodeId,
      target.decisionRecordCurrentEpisodeId,
    ],
    [
      "decision record operator presence",
      expectation.decisionRecordOperatorPresence,
      target.decisionRecordOperatorPresence,
    ],
    [
      "decision record candidate score",
      expectation.decisionRecordCandidateScore,
      target.decisionRecordCandidateScore,
    ],
  ] as const;

  for (const [label, expected, actual] of fields) {
    pushFieldAssertion(assertions, `${targetKey} ${label}`, expected, actual);
  }
}

function pushRouteConsistencyAssertion(
  assertions: JudgmentBenchAssertionResult[],
  targetKey: string,
  target: ReplayDecisionSnapshot,
): void {
  if (target.decisionRecordRoute === undefined || target.decisionKind === undefined) {
    return;
  }

  assertions.push({
    name: `${targetKey} decision record route matches decision kind`,
    passed:
      target.decisionKind === "suppressed" || target.decisionRecordRoute === target.decisionKind,
    expected: target.decisionKind,
    actual: target.decisionRecordRoute,
  });
}

function pushValueComponentAssertion(
  assertions: JudgmentBenchAssertionResult[],
  targetKey: string,
  expectation: ReplayDecisionExpectation,
  target: ReplayDecisionSnapshot,
): void {
  if (expectation.decisionRecordValueComponentsInclude === undefined) {
    return;
  }

  assertions.push({
    name: `${targetKey} decision record value components include`,
    passed: Object.entries(expectation.decisionRecordValueComponentsInclude).every(
      ([component, expectedValue]) =>
        target.decisionRecordValueComponents?.[
          component as keyof NonNullable<ReplayDecisionSnapshot["decisionRecordValueComponents"]>
        ] === expectedValue,
    ),
    expected: expectation.decisionRecordValueComponentsInclude,
    actual: target.decisionRecordValueComponents ?? null,
  });
}

function pushIncludedStringsAssertion(
  assertions: JudgmentBenchAssertionResult[],
  name: string,
  expected: string[] | undefined,
  actual: string[] | undefined,
): void {
  if (!expected || expected.length === 0) {
    return;
  }

  assertions.push({
    name,
    passed: expected.every((entry) => (actual ?? []).includes(entry)),
    expected,
    actual: actual ?? [],
  });
}

function pushContainedStringAssertion(
  assertions: JudgmentBenchAssertionResult[],
  name: string,
  expected: string[] | undefined,
  actual: string[] | undefined,
): void {
  if (!expected || expected.length === 0) {
    return;
  }

  assertions.push({
    name,
    passed: expected.every((snippet) => (actual ?? []).some((entry) => entry.includes(snippet))),
    expected,
    actual: actual ?? [],
  });
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
