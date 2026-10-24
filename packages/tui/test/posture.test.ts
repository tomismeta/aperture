import assert from "node:assert/strict";
import test from "node:test";

import { ApertureCore } from "@tomismeta/aperture-core";
import { computePosture } from "../src/posture.js";

test("posture translates core pressure levels without inferring demand", () => {
  assert.equal(computePosture({ level: "steady" }), "calm");
  assert.equal(computePosture({ level: "elevated" }), "elevated");
  assert.equal(computePosture({ level: "high" }), "busy");
});

test("posture cools after a stale burst using the core clock", () => {
  let now = Date.parse("2026-03-15T12:00:00.000Z");
  const core = new ApertureCore({ timeSource: () => now });
  for (let index = 0; index < 12; index++) {
    core.recordSignal({
      kind: "presented",
      taskId: `task-${index}`,
      interactionId: `interaction-${index}`,
      timestamp: new Date(now).toISOString(),
    });
    core.recordSignal({
      kind: "deferred",
      reason: "suppressed",
      taskId: `task-${index}`,
      interactionId: `interaction-${index}`,
      timestamp: new Date(now).toISOString(),
    });
  }
  assert.equal(computePosture(core.getAttentionPressure()), "busy");
  now += 180_000;
  assert.equal(computePosture(core.getAttentionPressure()), "calm");
});
