import assert from "node:assert/strict";
import test from "node:test";

import {
  compareKernelCanonicalKey,
  KERNEL_PROFILE_SCENARIO_IDS,
  loadGoldenScenarios,
  runJudgmentBench,
  validateReplayScenario,
  type ReplayScenario,
} from "../src/index.js";

test("loads the first golden scenarios from disk", async () => {
  const scenarios = await loadGoldenScenarios();

  assert.ok(scenarios.length >= 20);
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:interrupt:approval"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:ambient:status"));
  assert.ok(
    scenarios.some((scenario) => scenario.id === "golden:semantics:dangerous-approval-language"),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:low-confidence-failed-status-queues",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) =>
        scenario.id === "golden:semantics:low-confidence-blocked-like-waiting-stays-next",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:abstained-waiting-status-stays-ambient",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:abstained-blocked-like-waiting-stays-next",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:low-confidence-failure-recovers-to-now",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:abstained-blocked-work-recovers-to-now",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) =>
        scenario.id ===
        "golden:semantics:abstained-inferred-resurfacing-context-anchor-stays-diagnostic",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:question-tool-family-stays-explanatory",
    ),
  );
  assert.ok(
    scenarios.some((scenario) => scenario.id === "golden:semantics:repeated-failure-same-issue"),
  );
  assert.ok(
    scenarios.some(
      (scenario) =>
        scenario.id === "golden:semantics:inferred-resurfacing-context-anchor-stays-bundled",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:weak-inferred-supersede-stays-next",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:semantics:superseding-approval-replaces-now-step",
    ),
  );
  assert.ok(
    scenarios.some((scenario) => scenario.id === "golden:kernel:attention-decision-record"),
  );
  assert.deepEqual(
    scenarios
      .map((scenario) => scenario.id)
      .filter((id) => id.startsWith("golden:kernel:"))
      .sort(compareKernelCanonicalKey),
    [...KERNEL_PROFILE_SCENARIO_IDS],
  );
  assert.ok(
    scenarios.some(
      (scenario) =>
        scenario.id === "golden:policy:low-trust-failed-status-stays-queued-under-tight-threshold",
    ),
  );
  assert.ok(
    scenarios.some((scenario) => scenario.id === "golden:adversarial:production-read-stays-low"),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:adversarial:negated-resolve-does-not-clear-issue",
    ),
  );
  assert.ok(
    scenarios.some(
      (scenario) => scenario.id === "golden:adversarial:negated-regression-does-not-escalate",
    ),
  );
});

test("JudgmentBench runs across the golden scenarios and produces a summary", async () => {
  const result = await runJudgmentBench();

  assert.equal(result.benchmark, "JudgmentBench");
  assert.ok(result.summary.totalScenarios >= 20);
  assert.ok(result.summary.totalSemanticReadings >= 17);
  assert.ok(result.summary.totalDecisionReadings >= 22);
  assert.ok(result.summary.totalAmbiguousDecisions >= 4);
  assert.ok(result.summary.totalAmbiguousNextThenNow >= 1);
  assert.ok(result.summary.totalAmbiguousAmbientThenNow >= 1);
  assert.ok(result.summary.totalCandidates >= result.summary.totalNowLanes);
  assert.equal(result.scenarios.length, result.summary.totalScenarios);
  assert.ok(
    result.scenarios.every((scenario) => scenario.scorecard.explanation.targetLane !== undefined),
  );
  assert.ok(result.scenarios.some((scenario) => scenario.scorecard.explanation.headline !== null));
  assert.ok(result.scenarios.some((scenario) => scenario.run.semantics.length > 0));
  assert.ok(
    result.scenarios.some((scenario) =>
      scenario.run.decisions.some(
        (decision) => decision.ambiguity !== null && decision.ambiguity !== undefined,
      ),
    ),
  );
  assert.ok(result.semanticHealth.length >= 8);
  assert.ok(result.semanticHealth.some((family) => family.family === "episode_missed"));
  assert.ok(result.semanticHealth.some((family) => family.family === "blocking_missed"));

  const resurfacingScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:resurfacing-same-episode-reclaims-focus",
  );
  assert.ok(resurfacingScenario);
  assert.equal(
    resurfacingScenario?.assertions.find(
      (assertion) => assertion.name === "explanation continuity rationale includes",
    )?.passed,
    true,
  );

  const supersedingScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:superseding-approval-replaces-now-step",
  );
  assert.ok(supersedingScenario);
  assert.equal(
    supersedingScenario?.assertions.find(
      (assertion) => assertion.name === "explanation continuity rationale includes",
    )?.passed,
    true,
  );

  const questionToolScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:question-tool-family-stays-explanatory",
  );
  assert.ok(questionToolScenario);
  assert.equal(
    questionToolScenario?.assertions.find(
      (assertion) =>
        assertion.name ===
        "decision reading (question with explicit tool context) semantic impact explanatory includes",
    )?.passed,
    true,
  );

  const episodeHealth = result.semanticHealth.find((family) => family.family === "episode_missed");
  assert.ok(episodeHealth);
  assert.ok((episodeHealth?.scenarios ?? 0) >= 1);

  const repeatedFailureScenario = result.scenarios.find(
    (scenario) => scenario.scenario.id === "golden:semantics:repeated-failure-same-issue",
  );
  assert.ok(repeatedFailureScenario);
  assert.equal(
    repeatedFailureScenario?.assertions.find(
      (assertion) => assertion.name === "semantic reading (repeated failure) ontology episode",
    )?.passed,
    true,
  );

  const inferredResurfacingScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:inferred-resurfacing-context-anchor-stays-bundled",
  );
  assert.ok(inferredResurfacingScenario);
  assert.equal(
    inferredResurfacingScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const weakInferredSupersedeScenario = result.scenarios.find(
    (scenario) => scenario.scenario.id === "golden:semantics:weak-inferred-supersede-stays-next",
  );
  assert.ok(weakInferredSupersedeScenario);
  assert.equal(
    weakInferredSupersedeScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const lowConfidenceBlockedLikeScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:low-confidence-blocked-like-waiting-stays-next",
  );
  assert.ok(lowConfidenceBlockedLikeScenario);
  assert.equal(
    lowConfidenceBlockedLikeScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const abstainedBlockedLikeScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:semantics:abstained-blocked-like-waiting-stays-next",
  );
  assert.ok(abstainedBlockedLikeScenario);
  assert.equal(
    abstainedBlockedLikeScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const abstainedResurfacingScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id ===
      "golden:semantics:abstained-inferred-resurfacing-context-anchor-stays-diagnostic",
  );
  assert.ok(abstainedResurfacingScenario);
  assert.equal(
    abstainedResurfacingScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const lowTrustScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id ===
      "golden:policy:low-trust-failed-status-stays-queued-under-tight-threshold",
  );
  assert.ok(lowTrustScenario);
  assert.equal(
    lowTrustScenario?.assertions.every((assertion) => assertion.passed),
    true,
  );

  const kernelScenarios = result.scenarios.filter((scenario) =>
    scenario.scenario.id.startsWith("golden:kernel:"),
  );
  assert.deepEqual(
    kernelScenarios.map((scenario) => scenario.scenario.id).sort(compareKernelCanonicalKey),
    [...KERNEL_PROFILE_SCENARIO_IDS],
  );
  assert.equal(
    kernelScenarios.every((scenario) => scenario.assertions.every((assertion) => assertion.passed)),
    true,
  );

  const negatedResolveScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:adversarial:negated-resolve-does-not-clear-issue",
  );
  assert.ok(negatedResolveScenario);
  assert.equal(
    negatedResolveScenario?.assertions.find(
      (assertion) =>
        assertion.name === "semantic reading (negated resolve status) relation kinds exact",
    )?.passed,
    true,
  );

  const negatedRegressionScenario = result.scenarios.find(
    (scenario) =>
      scenario.scenario.id === "golden:adversarial:negated-regression-does-not-escalate",
  );
  assert.ok(negatedRegressionScenario);
  assert.equal(
    negatedRegressionScenario?.assertions.find(
      (assertion) =>
        assertion.name === "semantic reading (negated regression status) relation kinds exact",
    )?.passed,
    true,
  );
});

test("semantic relation hint exact expectations are order-sensitive", async () => {
  const scenario: ReplayScenario = {
    id: "test:relation-hints-exact-order",
    title: "Relation hints exact order",
    expectations: {
      semanticReadings: [
        {
          stepLabel: "targeted rollback",
          relationHintsExact: [
            { kind: "supersedes", target: "issue:test:relation-hints" },
            { kind: "same_issue", target: "issue:test:relation-hints" },
          ],
        },
      ],
    },
    steps: [
      {
        kind: "publishSource",
        label: "targeted rollback",
        event: {
          id: "evt:test:relation-hints",
          type: "human.input.requested",
          taskId: "task:test:relation-hints",
          interactionId: "interaction:test:relation-hints",
          timestamp: "2026-03-10T12:00:00.000Z",
          source: { id: "custom-agent" },
          title: "Approve rollback instead",
          summary: "Use this rollback plan instead for the same production deploy.",
          request: { kind: "approval" },
          semanticHints: {
            relationHints: [
              { kind: "same_issue", target: "issue:test:relation-hints" },
              { kind: "supersedes", target: "issue:test:relation-hints" },
            ],
          },
        },
      },
    ],
  };

  const result = await runJudgmentBench([scenario]);
  const assertion = result.scenarios[0]?.assertions.find(
    (entry) => entry.name === "semantic reading (targeted rollback) relation hints exact",
  );

  assert.equal(assertion?.passed, false);
  assert.deepEqual(assertion?.actual, [
    { kind: "same_issue", target: "issue:test:relation-hints" },
    { kind: "supersedes", target: "issue:test:relation-hints" },
  ]);
});

test("replay validation rejects malformed exact relation hints", () => {
  const invalidScenario = {
    id: "test:invalid-relation-hints-exact",
    title: "Invalid relation hints exact",
    expectations: {
      semanticReadings: [
        {
          stepLabel: "invalid relation hints",
          relationHintsExact: [{ kind: "same_issue", target: 42 }],
        },
      ],
    },
    steps: [],
  };

  assert.equal(validateReplayScenario(invalidScenario), null);
});
