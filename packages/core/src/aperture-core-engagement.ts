import type { AttentionFrame, AttentionView } from "./frame.js";

export type OperatorEngagement = {
  taskId: string;
  interactionId: string;
  expiresAtMs: number;
};

export class OperatorEngagementController {
  private engagement: OperatorEngagement | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly timeSource: () => number) {}

  engage(
    taskId: string,
    interactionId: string,
    options: { durationMs?: number } = {},
    onExpire?: () => void,
  ): void {
    const durationMs = normalizeOperatorEngagementDuration(options.durationMs);
    this.engagement = {
      taskId,
      interactionId,
      expiresAtMs: this.timeSource() + durationMs,
    };
    this.scheduleExpiry(durationMs, taskId, interactionId, onExpire);
  }

  readFocusedInteractionId(
    hasInteraction: (taskId: string, interactionId: string) => boolean,
  ): string | null {
    const engagement = this.engagement;
    if (!engagement) {
      return null;
    }

    if (engagement.expiresAtMs <= this.timeSource()) {
      this.clear();
      return null;
    }

    if (!hasInteraction(engagement.taskId, engagement.interactionId)) {
      this.clear();
      return null;
    }

    return engagement.interactionId;
  }

  clear(taskId?: string, interactionId?: string): void {
    const engagement = this.engagement;
    if (!engagement) {
      return;
    }

    if (taskId !== undefined && engagement.taskId !== taskId) {
      return;
    }

    if (interactionId !== undefined && engagement.interactionId !== interactionId) {
      return;
    }

    this.engagement = null;
    this.clearTimer();
  }

  dispose(): void {
    this.engagement = null;
    this.clearTimer();
  }

  private scheduleExpiry(
    durationMs: number,
    taskId: string,
    interactionId: string,
    onExpire?: () => void,
  ): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.engagement?.taskId !== taskId || this.engagement?.interactionId !== interactionId) {
        return;
      }

      if (onExpire) {
        onExpire();
        return;
      }

      this.clear();
    }, durationMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export function sameAttentionView(left: AttentionView, right: AttentionView): boolean {
  return (
    left.now?.interactionId === right.now?.interactionId &&
    sameInteractionOrder(left.next, right.next) &&
    sameInteractionOrder(left.ambient, right.ambient)
  );
}

function normalizeOperatorEngagementDuration(durationMs: number | undefined): number {
  if (durationMs === undefined) {
    return 12_000;
  }

  return Math.max(25, Math.floor(durationMs));
}

function sameInteractionOrder(left: AttentionFrame[], right: AttentionFrame[]): boolean {
  return (
    left.length === right.length &&
    left.every((frame, index) => frame.interactionId === right[index]?.interactionId)
  );
}
