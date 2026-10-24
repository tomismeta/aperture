import test from "node:test";
import assert from "node:assert/strict";

import { ApertureCore } from "../src/aperture-core.js";
import { OperatorEngagementController } from "../src/aperture-core-engagement.js";

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

  core.engage("task:engaged", "interaction:engaged", { durationMs: 150 });

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

  await sleep(220);

  assert.equal(core.getAttentionView().now?.interactionId, "interaction:challenger");
});

test("engagement expiry notifies subscribers without requiring a getter or another event", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = Date.parse("2026-03-08T12:00:00.000Z");
  const core = new ApertureCore({ timeSource: () => now });
  publishEngagementPair(core);
  core.engage("task:engaged", "interaction:engaged", { durationMs: 100 });
  const seen: Array<string | null> = [];
  core.subscribeAttentionView((view) => seen.push(view.now?.interactionId ?? null));
  assert.deepEqual(seen, ["interaction:engaged"]);
  now += 100;
  t.mock.timers.tick(100);
  assert.deepEqual(seen, ["interaction:engaged", "interaction:challenger"]);
  t.mock.timers.tick(100);
  assert.equal(seen.length, 2);
});

test("getter-driven expiry emits once and renewed engagement ignores the previous timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = Date.parse("2026-03-08T12:00:00.000Z");
  const core = new ApertureCore({ timeSource: () => now });
  publishEngagementPair(core);
  core.engage("task:engaged", "interaction:engaged", { durationMs: 100 });
  const seen: Array<string | null> = [];
  core.subscribeAttentionView((view) => seen.push(view.now?.interactionId ?? null));
  now += 50;
  t.mock.timers.tick(50);
  core.engage("task:engaged", "interaction:engaged", { durationMs: 100 });
  now += 50;
  t.mock.timers.tick(50);
  assert.deepEqual(seen, ["interaction:engaged"]);
  now += 50;
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:challenger");
  assert.deepEqual(seen, ["interaction:engaged", "interaction:challenger"]);
  t.mock.timers.tick(100);
  assert.equal(seen.length, 2);
});

test("non-finite engagement durations reject without replacing a current hold", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = Date.parse("2026-03-08T12:00:00.000Z");
  const core = new ApertureCore({ timeSource: () => now });
  publishEngagementPair(core);
  core.engage("task:engaged", "interaction:engaged", { durationMs: 100 });
  assert.throws(
    () => core.engage("task:challenger", "interaction:challenger", { durationMs: Infinity }),
    RangeError,
  );
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:engaged");
  now += 100;
  t.mock.timers.tick(100);
  assert.equal(core.getAttentionView().now?.interactionId, "interaction:challenger");
});

test("long engagements respect Node's timer limit without shortening the hold", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const schedule = t.mock.method(globalThis, "setTimeout");
  const maxDelay = 2_147_483_647;
  let now = 0;
  const expired: string[] = [];
  const controller = new OperatorEngagementController(() => now);
  controller.engage("task", "interaction", { durationMs: maxDelay + 25 }, (id) => expired.push(id));
  // A larger native delay becomes 1 ms in Node, repeatedly waking before expiry.
  assert.equal(schedule.mock.calls[0]?.arguments[1], maxDelay);
  now = maxDelay;
  t.mock.timers.tick(maxDelay);
  assert.deepEqual(expired, []);
  assert.equal(
    controller.readFocusedInteractionId(() => true),
    "interaction",
  );
  now += 25;
  t.mock.timers.tick(25);
  assert.deepEqual(expired, ["interaction"]);
  assert.equal(
    controller.readFocusedInteractionId(() => true),
    null,
  );
});

function publishEngagementPair(core: ApertureCore): void {
  for (const [id, consequence, timestamp] of [
    ["engaged", "low", "2026-03-08T12:00:00.000Z"],
    ["challenger", "medium", "2026-03-08T12:01:00.000Z"],
  ] as const) {
    core.publish({
      id: `evt:${id}`,
      taskId: `task:${id}`,
      interactionId: `interaction:${id}`,
      timestamp,
      type: "human.input.requested",
      title: `Approve ${id}`,
      summary: "Review the request.",
      consequence,
      request: { kind: "approval" },
    });
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
