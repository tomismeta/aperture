import type { AttentionFrame, AttentionView } from "./frame.js";

export type OperatorEngagement = {
  taskId: string;
  interactionId: string;
  expiresAtMs: number;
};

export class OperatorEngagementController {
  private engagement: OperatorEngagement | null = null;
  private timer: NodeJS.Timeout | null = null;
  private onExpire: ((interactionId: string) => void) | undefined;

  constructor(private readonly timeSource: () => number) {}

  engage(
    taskId: string,
    interactionId: string,
    options: { durationMs?: number } = {},
    onExpire?: (interactionId: string) => void,
  ): void {
    const durationMs = normalizeOperatorEngagementDuration(options.durationMs);
    this.engagement = {
      taskId,
      interactionId,
      expiresAtMs: this.timeSource() + durationMs,
    };
    this.onExpire = onExpire;
    this.scheduleExpiry(durationMs, this.engagement);
  }

  readFocusedInteractionId(
    hasInteraction: (taskId: string, interactionId: string) => boolean,
  ): string | null {
    const engagement = this.engagement;
    if (!engagement) {
      return null;
    }

    if (engagement.expiresAtMs <= this.timeSource()) {
      this.expire(engagement);
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
    this.onExpire = undefined;
    this.clearTimer();
  }

  dispose(): void {
    this.clear();
  }

  private expire(engagement: OperatorEngagement): void {
    if (this.engagement !== engagement) {
      return;
    }
    const onExpire = this.onExpire;
    this.clear();
    onExpire?.(engagement.interactionId);
  }

  private scheduleExpiry(durationMs: number, engagement: OperatorEngagement): void {
    this.clearTimer();
    this.timer = setTimeout(
      () => {
        if (this.engagement !== engagement) {
          return;
        }
        const remainingMs = engagement.expiresAtMs - this.timeSource();
        if (remainingMs > 0) {
          this.scheduleExpiry(remainingMs, engagement);
          return;
        }
        this.expire(engagement);
      },
      Math.min(durationMs, 2_147_483_647),
    );
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
  if (!Number.isFinite(durationMs)) {
    throw new RangeError("Operator engagement duration must be finite");
  }

  return Math.max(25, Math.floor(durationMs));
}

function sameInteractionOrder(left: AttentionFrame[], right: AttentionFrame[]): boolean {
  return (
    left.length === right.length &&
    left.every((frame, index) => frame.interactionId === right[index]?.interactionId)
  );
}
