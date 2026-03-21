import assert from "node:assert/strict";
import test from "node:test";

import { loadGoldenScenarios, runJudgmentBench } from "../src/index.js";

test("loads the first golden scenarios from disk", async () => {
  const scenarios = await loadGoldenScenarios();

  assert.ok(scenarios.length >= 18);
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:interrupt:approval"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:ambient:status"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:dangerous-approval-language"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:low-confidence-failed-status-queues"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:abstained-waiting-status-stays-ambient"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:repeated-failure-same-issue"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:semantics:superseding-approval-replaces-active-step"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:adversarial:production-read-stays-low"));
});

test("JudgmentBench runs across the golden scenarios and produces a summary", async () => {
  const result = await runJudgmentBench();

  assert.equal(result.benchmark, "JudgmentBench");
  assert.ok(result.summary.totalScenarios >= 18);
  assert.ok(result.summary.totalSemanticReadings >= 13);
  assert.ok(result.summary.totalDecisionReadings >= 18);
  assert.ok(result.summary.totalAmbiguousDecisions >= 2);
  assert.ok(result.summary.totalCandidates >= result.summary.totalActiveBuckets);
  assert.equal(result.scenarios.length, result.summary.totalScenarios);
  assert.ok(result.scenarios.every((scenario) => scenario.scorecard.explanation.targetBucket !== undefined));
  assert.ok(result.scenarios.some((scenario) => scenario.scorecard.explanation.headline !== null));
  assert.ok(result.scenarios.some((scenario) => scenario.run.semantics.length > 0));
  assert.ok(result.scenarios.some((scenario) => scenario.run.decisions.some((decision) => decision.ambiguity !== null && decision.ambiguity !== undefined)));
});
