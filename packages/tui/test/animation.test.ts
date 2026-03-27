import assert from "node:assert/strict";
import test from "node:test";

import {
  QUEUE_MOVEMENT_TICKS,
  createAnimationState,
  reconcileQueueMovement,
  tickAnimation,
} from "../src/animation.js";

test("createAnimationState returns default idle state", () => {
  const state = createAnimationState();

  assert.equal(state.postureFlash, null);
  assert.equal(state.frameEntrance, null);
  assert.equal(state.queueMovement.size, 0);
  assert.equal(state.idleTick, 0);
});

test("tickAnimation decrements posture flash ticks", () => {
  const state = createAnimationState();
  state.postureFlash = { previous: "calm", ticksRemaining: 3 };

  tickAnimation(state);
  assert.equal(state.postureFlash!.ticksRemaining, 2);

  tickAnimation(state);
  assert.equal(state.postureFlash!.ticksRemaining, 1);

  // Third tick brings to 0, which clears it
  tickAnimation(state);
  assert.equal(state.postureFlash, null);
});

test("tickAnimation decrements frame entrance ticks", () => {
  const state = createAnimationState();
  state.frameEntrance = { interactionId: "i1", ticksRemaining: 2 };

  tickAnimation(state);
  assert.equal(state.frameEntrance!.ticksRemaining, 1);

  // Second tick brings to 0, which clears it
  tickAnimation(state);
  assert.equal(state.frameEntrance, null);
});

test("tickAnimation returns false when nothing is animating but still advances idle tick", () => {
  const state = createAnimationState();
  const changed = tickAnimation(state);
  assert.equal(changed, false);
  assert.equal(state.idleTick, 1);
});

test("tickAnimation returns true when flash is active", () => {
  const state = createAnimationState();
  state.postureFlash = { previous: "calm", ticksRemaining: 2 };
  const changed = tickAnimation(state);
  assert.ok(changed);
});

test("reconcileQueueMovement tracks real shared reordering", () => {
  const state = createAnimationState();

  reconcileQueueMovement(state, ["deploy", "qa", "docs"], ["qa", "deploy", "docs"]);

  assert.deepEqual(state.queueMovement.get("qa"), {
    direction: "up",
    delta: 1,
    ticksRemaining: QUEUE_MOVEMENT_TICKS,
  });
  assert.deepEqual(state.queueMovement.get("deploy"), {
    direction: "down",
    delta: 1,
    ticksRemaining: QUEUE_MOVEMENT_TICKS,
  });
  assert.equal(state.queueMovement.has("docs"), false);
});

test("reconcileQueueMovement ignores insertion-only rank shifts", () => {
  const state = createAnimationState();

  reconcileQueueMovement(state, ["deploy", "qa"], ["security", "deploy", "qa"]);

  assert.equal(state.queueMovement.size, 0);
});

test("tickAnimation expires queue movement cues", () => {
  const state = createAnimationState();
  state.queueMovement.set("deploy", { direction: "up", delta: 1, ticksRemaining: 2 });

  tickAnimation(state);
  assert.deepEqual(state.queueMovement.get("deploy"), {
    direction: "up",
    delta: 1,
    ticksRemaining: 1,
  });

  tickAnimation(state);
  assert.equal(state.queueMovement.size, 0);
});
