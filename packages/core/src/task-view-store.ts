import type { Frame, TaskView } from "./index.js";

type FrameBucket = "active" | "queued" | "ambient";

export class TaskViewStore {
  private readonly taskViews = new Map<string, TaskView>();

  get(taskId: string): TaskView {
    return (
      this.taskViews.get(taskId) ?? {
        active: null,
        queued: [],
        ambient: [],
      }
    );
  }

  setActive(taskId: string, frame: Frame): TaskView {
    const taskView = this.get(taskId);
    const nextQueued = taskView.queued.filter((item) => item.interactionId !== frame.interactionId);
    const previousActive =
      taskView.active && taskView.active.interactionId !== frame.interactionId
        ? taskView.active
        : null;
    const next: TaskView = {
      active: frame,
      queued: previousActive ? [previousActive, ...nextQueued] : nextQueued,
      ambient: taskView.ambient.filter((item) => item.interactionId !== frame.interactionId),
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  enqueue(taskId: string, frame: Frame): TaskView {
    return this.upsert(taskId, "queued", frame);
  }

  addAmbient(taskId: string, frame: Frame): TaskView {
    return this.upsert(taskId, "ambient", frame);
  }

  clear(taskId: string): TaskView {
    const next: TaskView = {
      active: null,
      queued: [],
      ambient: [],
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  discard(taskId: string, interactionId: string): TaskView {
    const taskView = this.get(taskId);
    const next: TaskView = {
      active: taskView.active?.interactionId === interactionId ? null : taskView.active,
      queued: taskView.queued.filter((frame) => frame.interactionId !== interactionId),
      ambient: taskView.ambient.filter((frame) => frame.interactionId !== interactionId),
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  resolve(taskId: string, interactionId: string): TaskView {
    const taskView = this.get(taskId);
    const remainingQueued = taskView.queued.filter((frame) => frame.interactionId !== interactionId);
    const remainingAmbient = taskView.ambient.filter((frame) => frame.interactionId !== interactionId);

    let nextActive = taskView.active;
    if (nextActive?.interactionId === interactionId) {
      nextActive = remainingQueued.shift() ?? null;
    }

    const next: TaskView = {
      active: nextActive,
      queued: remainingQueued,
      ambient: remainingAmbient,
    };
    this.taskViews.set(taskId, next);
    return next;
  }

  private upsert(taskId: string, bucket: FrameBucket, frame: Frame): TaskView {
    const taskView = this.get(taskId);
    const dedupedQueued = taskView.queued.filter((item) => item.interactionId !== frame.interactionId);
    const dedupedAmbient = taskView.ambient.filter((item) => item.interactionId !== frame.interactionId);

    const next: TaskView = {
      active: taskView.active?.interactionId === frame.interactionId ? taskView.active : taskView.active,
      queued: bucket === "queued" ? [frame, ...dedupedQueued] : dedupedQueued,
      ambient: bucket === "ambient" ? [frame, ...dedupedAmbient] : dedupedAmbient,
    };

    this.taskViews.set(taskId, next);
    return next;
  }

  values(): Iterable<TaskView> {
    return this.taskViews.values();
  }
}
