import assert from "node:assert/strict";
import test from "node:test";

import { createAnimationState, tickAnimation } from "../src/animation.js";

test("createAnimationState returns default idle state", () => {
  const state = createAnimationState();

  assert.equal(state.postureFlash, null);
  assert.equal(state.frameEntrance, null);
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
