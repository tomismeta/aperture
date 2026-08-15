import assert from "node:assert/strict";
import test from "node:test";

import { assertKernelScaleBenchmarkPassed, runKernelScaleBenchmark } from "./kernel-scale.ts";

test("kernel scale benchmark produces stable mixed-workload digests", () => {
  const report = runKernelScaleBenchmark({
    evaluationsPerRound: 80,
    rounds: 2,
    warmupEvaluations: 8,
  });

  assert.equal(report.workload.families, 8);
  assert.equal(report.workload.totalEvaluations, 160);
  assert.equal(report.determinism.stable, true);
  assert.match(report.determinism.resultDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(new Set(report.rounds.map((round) => round.resultDigest)).size, 1);
  assert.equal(report.performance.minimumThroughputPerSecond > 0, true);
  assert.equal(report.performance.p95RoundMeanLatencyMicroseconds > 0, true);
  assert.equal(report.passed, false);
  assert.throws(() => assertKernelScaleBenchmarkPassed(report), /insufficient_rounds/);
});
