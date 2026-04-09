import test from "node:test";
import assert from "node:assert/strict";

import { ApertureCore } from "../src/aperture-core.js";

test("operator engagement holds focus briefly before yielding back to normal ordering", async () => {
  const core = new ApertureCore();

  core.publish({
    id: "evt:engaged",
    taskId: "task:engaged",
    timestamp: "2026-03-08T12:00:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:engaged",
    title: "Approve engaged deploy",
    summary: "The current deploy is waiting for approval.",
    consequence: "low",
    request: { kind: "approval" },
  });

  core.engage("task:engaged", "interaction:engaged", { durationMs: 40 });

  core.publish({
    id: "evt:challenger",
    taskId: "task:challenger",
    timestamp: "2026-03-08T12:01:00.000Z",
    type: "human.input.requested",
    interactionId: "interaction:challenger",
    title: "Approve fresher deploy",
    summary: "A fresher deploy is now waiting for approval.",
    consequence: "medium",
    request: { kind: "approval" },
  });

  assert.equal(core.getAttentionView().now?.interactionId, "interaction:engaged");

  await sleep(80);

  assert.equal(core.getAttentionView().now?.interactionId, "interaction:challenger");
});

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
