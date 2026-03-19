import assert from "node:assert/strict";
import test from "node:test";

import { loadGoldenScenarios, runJudgmentBench } from "../src/index.js";

test("loads the first golden scenarios from disk", async () => {
  const scenarios = await loadGoldenScenarios();

  assert.ok(scenarios.length >= 5);
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:interrupt:approval"));
  assert.ok(scenarios.some((scenario) => scenario.id === "golden:ambient:status"));
});

test("JudgmentBench runs across the golden scenarios and produces a summary", async () => {
  const result = await runJudgmentBench();

  assert.equal(result.benchmark, "JudgmentBench");
  assert.ok(result.summary.totalScenarios >= 5);
  assert.ok(result.summary.totalCandidates >= result.summary.totalActiveBuckets);
  assert.equal(result.scenarios.length, result.summary.totalScenarios);
  assert.ok(result.scenarios.every((scenario) => scenario.scorecard.explanation.targetBucket !== undefined));
  assert.ok(result.scenarios.some((scenario) => scenario.scorecard.explanation.headline !== null));
});
