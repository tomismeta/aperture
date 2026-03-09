import type { AttentionView, Frame, TaskView } from "./index.js";
import type { AttentionState } from "./attention-state.js";
import { scoreFrame } from "./frame-score.js";

type AttentionViewOptions = {
  globalAttentionState?: AttentionState;
};

export function buildAttentionView(
  taskViews: Iterable<TaskView>,
  options: AttentionViewOptions = {},
): AttentionView {
  const interruptive: Frame[] = [];
  const ambient: Frame[] = [];

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

  interruptive.sort(compareFrames);
  ambient.sort(compareFrames);

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
      (scoreFrame(active) < 0 ||
        (options.globalAttentionState === "overloaded" && scoreFrame(active) < 200))
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

function compareFrames(left: Frame, right: Frame): number {
  const score = scoreFrame(right) - scoreFrame(left);
  if (score !== 0) {
    return score;
  }

  return left.timing.createdAt.localeCompare(right.timing.createdAt);
}
