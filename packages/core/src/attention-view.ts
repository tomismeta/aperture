import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionOperatorPresence } from "./attention-evidence.js";
import type { AttentionState } from "./attention-state.js";
import { scoreAttentionFrame } from "./frame-score.js";

type AttentionViewOptions = {
  globalAttentionState?: AttentionState;
  operatorPresence?: AttentionOperatorPresence;
  now?: string;
};

export function buildAttentionView(
  taskViews: Iterable<AttentionTaskView>,
  options: AttentionViewOptions = {},
): AttentionView {
  let interruptive: AttentionFrame[] = [];
  let ambient: AttentionFrame[] = [];

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
    const promotedInterruptive: AttentionFrame[] = [];
    const demotedAmbient: AttentionFrame[] = [];

    for (const frame of interruptive) {
      if (!isUrgent(frame) && scoreAttentionFrame(frame, { now: referenceNow }) < 200) {
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

  if (options.operatorPresence === "absent") {
    return {
      active: null,
      queued: interruptive,
      ambient,
    };
  }

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
      (scoreAttentionFrame(active, { now: referenceNow }) <= 0 ||
        (options.globalAttentionState === "overloaded"
          && scoreAttentionFrame(active, { now: referenceNow }) < 200))
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

function isBackground(frame: AttentionFrame): boolean {
  return frame.mode === "status" || frame.tone === "ambient";
}

function isUrgent(frame: AttentionFrame): boolean {
  return frame.mode !== "status" || frame.tone === "critical" || frame.consequence === "high";
}

function countUrgentFrames(frames: AttentionFrame[]): number {
  return frames.filter(isUrgent).length;
}

function compareFrames(left: AttentionFrame, right: AttentionFrame, now: string): number {
  const score = scoreAttentionFrame(right, { now }) - scoreAttentionFrame(left, { now });
  if (score !== 0) {
    return score;
  }

  return left.timing.createdAt.localeCompare(right.timing.createdAt);
}

function latestTimestamp(frames: AttentionFrame[]): string {
  let latest = "1970-01-01T00:00:00.000Z";

  for (const frame of frames) {
    const candidate = frame.timing.updatedAt;
    if (candidate.localeCompare(latest) > 0) {
      latest = candidate;
    }
  }

  return latest;
}
