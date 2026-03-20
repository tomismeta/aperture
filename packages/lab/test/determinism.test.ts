import assert from "node:assert/strict";
import test from "node:test";

import { runDeterminismAudit } from "../src/index.js";

test("golden scenarios are structurally deterministic across repeated runs", async () => {
  const audit = await runDeterminismAudit();

  assert.ok(audit.summary.totalScenarios >= 5);
  assert.equal(audit.summary.driftedScenarios, 0);
  assert.equal(audit.summary.determinismScore, 1);
  assert.ok(audit.scenarios.every((scenario) => scenario.stable));
});
