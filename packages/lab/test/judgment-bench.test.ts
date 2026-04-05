import assert from "node:assert/strict";
import test from "node:test";

import { loadGoldenScenarios, runJudgmentBench } from "../src/index.js";

test("loads the first golden scenarios from disk", async () => {
  const scenarios = await loadGoldenScenarios();

  assert.ok(scenarios.length >= 20);
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:interrupt:approval"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:ambient:status"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:dangerous-approval-language"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:low-confidence-failed-status-queues"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:abstained-waiting-status-stays-ambient"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:low-confidence-failure-recovers-to-now"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:abstained-blocked-work-recovers-to-now"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:question-tool-family-stays-explanatory"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:repeated-failure-same-issue"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:superseding-approval-replaces-now-step"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:adversarial:production-read-stays-low"));
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
  assert.ok(result.scenarios.every((scenario) => scenario.scorecard.explanation.targetLane !== undefined));
  assert.ok(result.scenarios.some((scenario) => scenario.scorecard.explanation.headline !== null));
  assert.ok(result.scenarios.some((scenario) => scenario.run.semantics.length > 0));
  assert.ok(result.scenarios.some((scenario) => scenario.run.decisions.some((decision) => decision.ambiguity !== null && decision.ambiguity !== undefined)));
  assert.ok(result.semanticHealth.length >= 8);
  assert.ok(result.semanticHealth.some((family) => family.family === "episode_missed"));
  assert.ok(result.semanticHealth.some((family) => family.family === "blocking_missed"));

  const resurfacingScenario = result.scenarios.find(
    (scenario) => scenario.scenario.id === "golden:semantics:resurfacing-same-episode-reclaims-focus",
  );
  assert.ok(resurfacingScenario);
  assert.equal(
    resurfacingScenario?.assertions.find((assertion) => assertion.name === "explanation continuity rationale includes")?.passed,
    true,
  );

  const supersedingScenario = result.scenarios.find(
    (scenario) => scenario.scenario.id === "golden:semantics:superseding-approval-replaces-now-step",
  );
  assert.ok(supersedingScenario);
  assert.equal(
    supersedingScenario?.assertions.find((assertion) => assertion.name === "explanation continuity rationale includes")?.passed,
    true,
  );

  const questionToolScenario = result.scenarios.find(
    (scenario) => scenario.scenario.id === "golden:semantics:question-tool-family-stays-explanatory",
  );
  assert.ok(questionToolScenario);
  assert.equal(
    questionToolScenario?.assertions.find((assertion) => assertion.name === "decision reading (question with explicit tool context) semantic impact explanatory includes")?.passed,
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
    repeatedFailureScenario?.assertions.find((assertion) => assertion.name === "semantic reading (repeated failure) ontology episode")?.passed,
    true,
  );
});
