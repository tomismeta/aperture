import type { AnimationState } from "./types.js";

export const QUEUE_MOVEMENT_TICKS = 2;

export function createAnimationState(): AnimationState {
  return {
    postureFlash: null,
    frameEntrance: null,
    queueMovement: new Map(),
    idleTick: 0,
  };
}

export function reconcileQueueMovement(
  animation: AnimationState,
  previousOrder: string[],
  nextOrder: string[],
): void {
  const previousSet = new Set(previousOrder);
  const nextSet = new Set(nextOrder);
  const sharedPreviousOrder = previousOrder.filter((key) => nextSet.has(key));
  const sharedNextOrder = nextOrder.filter((key) => previousSet.has(key));
  const previousRanks = new Map(sharedPreviousOrder.map((key, index) => [key, index + 1]));

  for (const key of animation.queueMovement.keys()) {
    if (!nextSet.has(key)) {
      animation.queueMovement.delete(key);
    }
  }

  for (const [index, key] of sharedNextOrder.entries()) {
    const previousRank = previousRanks.get(key);
    const nextRank = index + 1;
    if (previousRank === undefined || previousRank === nextRank) {
      continue;
    }

    animation.queueMovement.set(key, {
      direction: previousRank > nextRank ? "up" : "down",
      delta: Math.abs(previousRank - nextRank),
      ticksRemaining: QUEUE_MOVEMENT_TICKS,
    });
  }
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

  for (const [key, cue] of animation.queueMovement) {
    cue.ticksRemaining -= 1;
    if (cue.ticksRemaining <= 0) {
      animation.queueMovement.delete(key);
    }
    changed = true;
  }

  // Idle tick always advances (for lens pulse when surface is empty)
  animation.idleTick = (animation.idleTick + 1) % 4;

  return changed;
}
