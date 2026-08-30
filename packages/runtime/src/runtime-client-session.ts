import type { ApertureRuntimeEvent } from "./runtime-contract.js";

export type RuntimeEventFeed = {
  events: ApertureRuntimeEvent[];
  nextSequence: number;
  stateVersion: number;
};

type RuntimeAttachment = {
  attachedId: string;
  heartbeatIntervalMs: number;
};

type RuntimeAttachmentSessionOptions = {
  pollIntervalMs: number;
  attach: () => Promise<RuntimeAttachment>;
  detach: (attachedId: string) => Promise<void>;
  heartbeat: (attachedId: string) => Promise<void>;
  poll: (since: number) => Promise<RuntimeEventFeed>;
  onPoll: (feed: RuntimeEventFeed) => Promise<void>;
  onError?: (error: unknown) => void;
};

export class RuntimeAttachmentSession {
  private readonly pollIntervalMs: number;
  private readonly attachFn: RuntimeAttachmentSessionOptions["attach"];
  private readonly detachFn: RuntimeAttachmentSessionOptions["detach"];
  private readonly heartbeatFn: RuntimeAttachmentSessionOptions["heartbeat"];
  private readonly pollFn: RuntimeAttachmentSessionOptions["poll"];
  private readonly onPoll: RuntimeAttachmentSessionOptions["onPoll"];
  private readonly onError: RuntimeAttachmentSessionOptions["onError"];
  private attachedId: string | null = null;
  private heartbeatIntervalMs = 0;
  private heartbeatTimeoutId: NodeJS.Timeout | null = null;
  private pollTimeoutId: NodeJS.Timeout | null = null;
  private heartbeatTask: Promise<void> | null = null;
  private pollTask: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private nextSequence = 0;
  private closed = true;

  constructor(options: RuntimeAttachmentSessionOptions) {
    this.pollIntervalMs = options.pollIntervalMs;
    this.attachFn = options.attach;
    this.detachFn = options.detach;
    this.heartbeatFn = options.heartbeat;
    this.pollFn = options.poll;
    this.onPoll = options.onPoll;
    this.onError = options.onError;
  }

  get id(): string | null {
    return this.attachedId;
  }

  async start(): Promise<void> {
    if (!this.closed || this.attachedId) {
      throw new Error("Runtime attachment session is already running.");
    }

    this.closed = false;
    this.nextSequence = 0;
    try {
      const attachment = await this.attachFn();
      if (this.closed) {
        await this.detachFn(attachment.attachedId);
        return;
      }
      this.attachedId = attachment.attachedId;
      this.heartbeatIntervalMs = attachment.heartbeatIntervalMs;
      this.scheduleHeartbeat();
      this.schedulePoll();
    } catch (error) {
      this.closed = true;
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    const closing = this.closeInternal().finally(() => {
      if (this.closePromise === closing) this.closePromise = null;
    });
    this.closePromise = closing;
    return closing;
  }

  private async closeInternal(): Promise<void> {
    this.closed = true;
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }

    const activeTasks = [this.pollTask, this.heartbeatTask].filter(
      (task): task is Promise<void> => task !== null,
    );
    await Promise.allSettled(activeTasks);

    const attachedId = this.attachedId;
    this.attachedId = null;
    if (!attachedId) return;

    try {
      await this.detachFn(attachedId);
    } catch (error) {
      this.reportError(error);
    }
  }

  private scheduleHeartbeat(): void {
    if (this.closed || !this.attachedId) return;
    this.heartbeatTimeoutId = setTimeout(() => {
      this.heartbeatTimeoutId = null;
      const attachedId = this.attachedId;
      if (this.closed || !attachedId) return;

      const task = this.heartbeatFn(attachedId)
        .catch((error) => {
          if (!this.closed) this.reportError(error);
        })
        .finally(() => {
          if (this.heartbeatTask === task) this.heartbeatTask = null;
          this.scheduleHeartbeat();
        });
      this.heartbeatTask = task;
    }, this.heartbeatIntervalMs);
  }

  private schedulePoll(): void {
    if (this.closed || !this.attachedId) return;
    this.pollTimeoutId = setTimeout(() => {
      this.pollTimeoutId = null;
      if (this.closed) return;

      const task = this.pollFn(this.nextSequence)
        .then(async (feed) => {
          if (this.closed) return;
          this.nextSequence = feed.nextSequence;
          await this.onPoll(feed);
        })
        .catch((error) => {
          if (!this.closed) this.reportError(error);
        })
        .finally(() => {
          if (this.pollTask === task) this.pollTask = null;
          this.schedulePoll();
        });
      this.pollTask = task;
    }, this.pollIntervalMs);
  }

  private reportError(error: unknown): void {
    this.onError?.(error);
  }
}
