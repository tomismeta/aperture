import type { AnimationState } from "./types.js";

export function createAnimationState(): AnimationState {
  return {
    postureFlash: null,
    frameEntrance: null,
    idleTick: 0,
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

  // Idle tick always advances (for lens pulse when surface is empty)
  animation.idleTick = (animation.idleTick + 1) % 4;

  return changed;
}
