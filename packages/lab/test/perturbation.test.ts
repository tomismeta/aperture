import assert from "node:assert/strict";
import test from "node:test";

import {
  loadGoldenScenarios,
  generatePerturbedSemanticScenarios,
  runPerturbedJudgmentBench,
} from "../src/index.js";

test("perturbation generator creates deterministic semantic variants", async () => {
  const scenarios = await loadGoldenScenarios();
  const perturbed = generatePerturbedSemanticScenarios(scenarios);

  assert.ok(perturbed.length >= 18);
  assert.ok(perturbed.some((scenario) => scenario.id.includes(":perturbed:surface_noise")));
  assert.ok(perturbed.some((scenario) => scenario.id.includes(":perturbed:synonym_shift")));
  assert.ok(perturbed.every((scenario) => (scenario.doctrineTags ?? []).includes("semantic_perturbation")));
});

test("perturbed JudgmentBench runs across generated semantic variants", async () => {
  const result = await runPerturbedJudgmentBench();

  assert.equal(result.benchmark, "JudgmentBench");
  assert.ok(result.summary.totalScenarios >= 18);
  assert.ok(result.summary.totalSemanticReadings >= 18);
  assert.equal(result.summary.failedAssertions, 0);
  assert.ok(result.doctrineHealth.some((doctrine) => doctrine.doctrine === "semantic_perturbation"));
});
