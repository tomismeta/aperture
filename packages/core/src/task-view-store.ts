import type { AttentionFrame, AttentionTaskView } from "./frame.js";

type FrameLane = "next" | "ambient";
const MAX_AMBIENT_FRAMES_PER_TASK = 12;

export type TaskViewStoreStats = {
  taskCount: number;
  nowCount: number;
  nextCount: number;
  ambientCount: number;
  totalFrames: number;
};

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
      taskView.now && taskView.now.interactionId !== frame.interactionId ? taskView.now : null;
    const next: AttentionTaskView = {
      now: frame,
      next: previousNow ? [previousNow, ...nextFrames] : nextFrames,
      ambient: taskView.ambient.filter((item) => item.interactionId !== frame.interactionId),
    };
    return this.persist(taskId, next);
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
    this.taskViews.delete(taskId);
    return next;
  }

  discard(taskId: string, interactionId: string): AttentionTaskView {
    const taskView = this.get(taskId);
    const next: AttentionTaskView = {
      now: taskView.now?.interactionId === interactionId ? null : taskView.now,
      next: taskView.next.filter((frame) => frame.interactionId !== interactionId),
      ambient: taskView.ambient.filter((frame) => frame.interactionId !== interactionId),
    };
    return this.persist(taskId, next);
  }

  resolve(taskId: string, interactionId: string): AttentionTaskView {
    const taskView = this.get(taskId);
    const remainingNext = taskView.next.filter((frame) => frame.interactionId !== interactionId);
    const remainingAmbient = taskView.ambient.filter(
      (frame) => frame.interactionId !== interactionId,
    );

    let nextNow = taskView.now;
    if (nextNow?.interactionId === interactionId) {
      nextNow = remainingNext.shift() ?? null;
    }

    const next: AttentionTaskView = {
      now: nextNow,
      next: remainingNext,
      ambient: remainingAmbient,
    };
    return this.persist(taskId, next);
  }

  private upsert(taskId: string, lane: FrameLane, frame: AttentionFrame): AttentionTaskView {
    const taskView = this.get(taskId);
    const dedupedNext = taskView.next.filter((item) => item.interactionId !== frame.interactionId);
    const dedupedAmbient = taskView.ambient.filter(
      (item) => item.interactionId !== frame.interactionId,
    );
    const demotingNow = taskView.now?.interactionId === frame.interactionId;
    const nextNow = demotingNow ? (dedupedNext.shift() ?? null) : taskView.now;

    const next: AttentionTaskView = {
      now: nextNow,
      next: lane === "next" ? [frame, ...dedupedNext] : dedupedNext,
      ambient:
        lane === "ambient"
          ? [frame, ...dedupedAmbient].slice(0, MAX_AMBIENT_FRAMES_PER_TASK)
          : dedupedAmbient,
    };

    return this.persist(taskId, next);
  }

  values(): Iterable<AttentionTaskView> {
    return this.taskViews.values();
  }

  stats(): TaskViewStoreStats {
    let nowCount = 0;
    let nextCount = 0;
    let ambientCount = 0;

    for (const taskView of this.taskViews.values()) {
      if (taskView.now) {
        nowCount += 1;
      }
      nextCount += taskView.next.length;
      ambientCount += taskView.ambient.length;
    }

    return {
      taskCount: this.taskViews.size,
      nowCount,
      nextCount,
      ambientCount,
      totalFrames: nowCount + nextCount + ambientCount,
    };
  }

  private persist(taskId: string, taskView: AttentionTaskView): AttentionTaskView {
    if (isEmptyTaskView(taskView)) {
      this.taskViews.delete(taskId);
    } else {
      this.taskViews.set(taskId, taskView);
    }
    return taskView;
  }
}

function isEmptyTaskView(taskView: AttentionTaskView): boolean {
  return taskView.now === null && taskView.next.length === 0 && taskView.ambient.length === 0;
}
