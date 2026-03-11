import type { AttentionView, Frame, TaskView } from "./index.js";
import type { AttentionState } from "./attention-state.js";
import { scoreFrame } from "./frame-score.js";

type AttentionViewOptions = {
  globalAttentionState?: AttentionState;
  now?: string;
};

export function buildAttentionView(
  taskViews: Iterable<TaskView>,
  options: AttentionViewOptions = {},
): AttentionView {
  let interruptive: Frame[] = [];
  let ambient: Frame[] = [];

  for (const taskView of taskViews) {
    if (taskView.active) {
      if (isBackground(taskView.active)) {
        ambient.push(taskView.active);
      } else {
        interruptive.push(taskView.active);
      }
    }

    interruptive.push(...taskView.queued);
    ambient.push(...taskView.ambient);
  }

  const referenceNow = options.now ?? latestTimestamp([...interruptive, ...ambient]);
  if (countUrgentFrames([...interruptive, ...ambient]) >= 2) {
    const promotedInterruptive: Frame[] = [];
    const demotedAmbient: Frame[] = [];

    for (const frame of interruptive) {
      if (!isUrgent(frame) && scoreFrame(frame, { now: referenceNow }) < 200) {
        demotedAmbient.push(frame);
      } else {
        promotedInterruptive.push(frame);
      }
    }

    interruptive = promotedInterruptive;
    ambient = [...ambient, ...demotedAmbient];
  }
  interruptive.sort((left, right) => compareFrames(left, right, referenceNow));
  ambient.sort((left, right) => compareFrames(left, right, referenceNow));

  if (interruptive.length > 0) {
    const [active, ...queued] = interruptive;
    return {
      active: active ?? null,
      queued,
      ambient,
    };
  }

  if (ambient.length > 0) {
    const [active, ...rest] = ambient;
    if (
      active &&
      (scoreFrame(active, { now: referenceNow }) < 0 ||
        (options.globalAttentionState === "overloaded" && scoreFrame(active, { now: referenceNow }) < 200))
    ) {
      return {
        active: null,
        queued: [],
        ambient,
      };
    }
    return {
      active: active ?? null,
      queued: [],
      ambient: rest,
    };
  }

  return {
    active: null,
    queued: [],
    ambient: [],
  };
}

function isBackground(frame: Frame): boolean {
  return frame.mode === "status" || frame.tone === "ambient";
}

function isUrgent(frame: Frame): boolean {
  return frame.mode !== "status" || frame.tone === "critical" || frame.consequence === "high";
}

function countUrgentFrames(frames: Frame[]): number {
  return frames.filter(isUrgent).length;
}

function compareFrames(left: Frame, right: Frame, now: string): number {
  const score = scoreFrame(right, { now }) - scoreFrame(left, { now });
  if (score !== 0) {
    return score;
  }

  return left.timing.createdAt.localeCompare(right.timing.createdAt);
}

function latestTimestamp(frames: Frame[]): string {
  let latest = "1970-01-01T00:00:00.000Z";

  for (const frame of frames) {
    const candidate = frame.timing.updatedAt;
    if (candidate.localeCompare(latest) > 0) {
      latest = candidate;
    }
  }

  return latest;
}
