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
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private nextSequence = 0;
  private closed = false;

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
    if (this.attachedId) {
      throw new Error("Runtime attachment session is already running.");
    }

    const attachment = await this.attachFn();
    this.attachedId = attachment.attachedId;
    this.closed = false;

    this.heartbeatIntervalId = setInterval(() => {
      const attachedId = this.attachedId;
      if (!attachedId || this.closed) {
        return;
      }
      void this.heartbeatFn(attachedId).catch((error) => this.reportError(error));
    }, attachment.heartbeatIntervalMs);

    this.pollIntervalId = setInterval(() => {
      void this.pollOnce().catch((error) => this.reportError(error));
    }, this.pollIntervalMs);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }

    const attachedId = this.attachedId;
    this.attachedId = null;
    if (!attachedId) {
      return;
    }

    try {
      await this.detachFn(attachedId);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.closed) {
      return;
    }
    const feed = await this.pollFn(this.nextSequence);
    this.nextSequence = feed.nextSequence;
    await this.onPoll(feed);
  }

  private reportError(error: unknown): void {
    this.onError?.(error);
  }
}
