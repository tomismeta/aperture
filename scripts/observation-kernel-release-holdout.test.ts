import assert from "node:assert/strict";
import test from "node:test";

import {
  buildObservationKernelReleaseHoldoutReport,
  parseObservationKernelReleaseHoldout,
  runObservationKernelReleaseHoldout,
} from "../packages/lab/src/observation-kernel-release-holdout.js";

test("release holdout covers typed and structural evidence with exact deterministic outcomes", () => {
  const artifact = parseObservationKernelReleaseHoldout();
  const first = runObservationKernelReleaseHoldout();
  const report = buildObservationKernelReleaseHoldoutReport(
    first,
    runObservationKernelReleaseHoldout(),
  );

  assert.equal(artifact.fixtures.length, 46);
  assert.equal(report.passed, true, report.failures.join(", "));
  assert.deepEqual(report.summary.exactOutcomes, { passed: 46, total: 46 });
  assert.deepEqual(report.summary.byEvidence, {
    typed: { passed: 12, total: 12 },
    fallback: { passed: 34, total: 34 },
  });
  assert.equal(report.summary.determinism.stable, true);
});

test("release holdout provenance does not overclaim independent oracle authorship", () => {
  const artifact = parseObservationKernelReleaseHoldout();
  assert.equal(artifact.methodology.oracleProvenance.authoredWithoutExecution, true);
  assert.equal(
    artifact.methodology.oracleProvenance.authoredWithoutImplementationInspection,
    false,
  );
  assert.equal(artifact.methodology.oracleProvenance.authoredWithoutPriorOracleInspection, false);
});
