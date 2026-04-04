import type { AttentionFrame, AttentionTaskView } from "./frame.js";

type FrameLane = "next" | "ambient";

export class TaskViewStore {
  private readonly taskViews = new Map<string, AttentionTaskView>();

  get(taskId: string): AttentionTaskView {
    return (
      this.taskViews.get(taskId) ?? {
        now: null,
        next: [],
        ambient: [],
      }
    );
  }

  setNow(taskId: string, frame: AttentionFrame): AttentionTaskView {
    const taskView = this.get(taskId);
    const nextFrames = taskView.next.filter((item) => item.interactionId !== frame.interactionId);
    const previousNow =
      taskView.now && taskView.now.interactionId !== frame.interactionId
        ? taskView.now
        : null;
    const next: AttentionTaskView = {
      now: frame,
      next: previousNow ? [previousNow, ...nextFrames] : nextFrames,
      ambient: taskView.ambient.filter((item) => item.interactionId !== frame.interactionId),
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  addNext(taskId: string, frame: AttentionFrame): AttentionTaskView {
    return this.upsert(taskId, "next", frame);
  }

  addAmbient(taskId: string, frame: AttentionFrame): AttentionTaskView {
    return this.upsert(taskId, "ambient", frame);
  }

  clear(taskId: string): AttentionTaskView {
    const next: AttentionTaskView = {
      now: null,
      next: [],
      ambient: [],
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  discard(taskId: string, interactionId: string): AttentionTaskView {
    const taskView = this.get(taskId);
    const next: AttentionTaskView = {
      now: taskView.now?.interactionId === interactionId ? null : taskView.now,
      next: taskView.next.filter((frame) => frame.interactionId !== interactionId),
      ambient: taskView.ambient.filter((frame) => frame.interactionId !== interactionId),
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  resolve(taskId: string, interactionId: string): AttentionTaskView {
    const taskView = this.get(taskId);
    const remainingNext = taskView.next.filter((frame) => frame.interactionId !== interactionId);
    const remainingAmbient = taskView.ambient.filter((frame) => frame.interactionId !== interactionId);

    let nextNow = taskView.now;
    if (nextNow?.interactionId === interactionId) {
      nextNow = remainingNext.shift() ?? null;
    }

    const next: AttentionTaskView = {
      now: nextNow,
      next: remainingNext,
      ambient: remainingAmbient,
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  private upsert(taskId: string, lane: FrameLane, frame: AttentionFrame): AttentionTaskView {
    const taskView = this.get(taskId);
    const dedupedNext = taskView.next.filter((item) => item.interactionId !== frame.interactionId);
    const dedupedAmbient = taskView.ambient.filter((item) => item.interactionId !== frame.interactionId);
    const demotingNow = taskView.now?.interactionId === frame.interactionId;
    const nextNow = demotingNow ? dedupedNext.shift() ?? null : taskView.now;

    const next: AttentionTaskView = {
      now: nextNow,
      next: lane === "next" ? [frame, ...dedupedNext] : dedupedNext,
      ambient: lane === "ambient" ? [frame, ...dedupedAmbient] : dedupedAmbient,
    };

    this.taskViews.set(taskId, next);
    return next;
  }

  values(): Iterable<AttentionTaskView> {
    return this.taskViews.values();
  }
}
