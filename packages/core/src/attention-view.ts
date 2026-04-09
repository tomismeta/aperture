import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionOperatorPresence } from "./attention-evidence.js";
import type { AttentionState } from "./attention-state.js";
import { scoreAttentionFrame } from "./frame-score.js";

type AttentionViewOptions = {
  globalAttentionState?: AttentionState;
  operatorPresence?: AttentionOperatorPresence;
  now?: string;
  focusedInteractionId?: string | null;
};

const FOCUS_HOLD_PREEMPTION_SCORE_GAP = 250;

export function buildAttentionView(
  taskViews: Iterable<AttentionTaskView>,
  options: AttentionViewOptions = {},
): AttentionView {
  let interruptive: AttentionFrame[] = [];
  let ambient: AttentionFrame[] = [];

  for (const taskView of taskViews) {
    if (taskView.now) {
      if (isBackground(taskView.now)) {
        ambient.push(taskView.now);
      } else {
        interruptive.push(taskView.now);
      }
    }

    interruptive.push(...taskView.next);
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
      now: null,
      next: interruptive,
      ambient,
    };
  }

  const heldFocus = resolveHeldFocus(
    interruptive,
    ambient,
    options.focusedInteractionId ?? null,
    referenceNow,
  );
  if (heldFocus) {
    const isInterruptive = interruptive.some((frame) => frame.interactionId === heldFocus.interactionId);
    return {
      now: heldFocus,
      next: isInterruptive
        ? interruptive.filter((frame) => frame.interactionId !== heldFocus.interactionId)
        : interruptive,
      ambient: ambient.filter((frame) => frame.interactionId !== heldFocus.interactionId),
    };
  }

  if (interruptive.length > 0) {
    const [now, ...next] = interruptive;
    return {
      now: now ?? null,
      next,
      ambient,
    };
  }

  if (ambient.length > 0) {
    const [now, ...rest] = ambient;
    if (
      now &&
      (scoreAttentionFrame(now, { now: referenceNow }) <= 0 ||
        (options.globalAttentionState === "overloaded"
          && scoreAttentionFrame(now, { now: referenceNow }) < 200))
    ) {
      return {
        now: null,
        next: [],
        ambient,
      };
    }
    return {
      now: now ?? null,
      next: [],
      ambient: rest,
    };
  }

  return {
    now: null,
    next: [],
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

function resolveHeldFocus(
  interruptive: AttentionFrame[],
  ambient: AttentionFrame[],
  focusedInteractionId: string | null,
  now: string,
): AttentionFrame | null {
  if (!focusedInteractionId) {
    return null;
  }

  const held =
    interruptive.find((frame) => frame.interactionId === focusedInteractionId)
    ?? ambient.find((frame) => frame.interactionId === focusedInteractionId)
    ?? null;
  if (!held) {
    return null;
  }

  const contender = interruptive[0] ?? ambient[0] ?? null;
  if (!contender || contender.interactionId === held.interactionId) {
    return held;
  }

  return shouldYieldHeldFocus(held, contender, now) ? null : held;
}

function shouldYieldHeldFocus(
  held: AttentionFrame,
  contender: AttentionFrame,
  now: string,
): boolean {
  if (contender.tone === "critical" && held.tone !== "critical") {
    return true;
  }

  if (contender.mode !== "status" && contender.consequence === "high" && held.consequence !== "high") {
    return true;
  }

  return scoreAttentionFrame(contender, { now }) - scoreAttentionFrame(held, { now })
    >= FOCUS_HOLD_PREEMPTION_SCORE_GAP;
}
