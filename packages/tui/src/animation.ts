import type { AnimationState } from "./types.js";

export function createAnimationState(): AnimationState {
  return {
    postureFlash: null,
    frameEntrance: null,
  };
}

/**
 * Advance animation state by one tick (500ms).
 * Returns true if a re-render is needed.
 */
export function tickAnimation(animation: AnimationState): boolean {
  let changed = false;

  // Decrement posture flash
  if (animation.postureFlash) {
    animation.postureFlash.ticksRemaining -= 1;
    if (animation.postureFlash.ticksRemaining <= 0) {
      animation.postureFlash = null;
    }
    changed = true;
  }

  // Decrement frame entrance
  if (animation.frameEntrance) {
    animation.frameEntrance.ticksRemaining -= 1;
    if (animation.frameEntrance.ticksRemaining <= 0) {
      animation.frameEntrance = null;
    }
    changed = true;
  }

  return changed;
}
