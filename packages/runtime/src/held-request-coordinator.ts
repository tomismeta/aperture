import type { IncomingMessage, ServerResponse } from "node:http";

import type { AttentionResponse } from "@tomismeta/aperture-core";

export type HeldRequestResolution<TBody> = {
  statusCode: number;
  body?: TBody;
};

type HeldRequestRecord<TBody> = {
  taskId: string;
  interactionId: string;
  response: ServerResponse<IncomingMessage>;
  timeout: NodeJS.Timeout;
  fallback: HeldRequestResolution<TBody>;
  mapResponse: (response: AttentionResponse) => HeldRequestResolution<TBody> | null;
  onTimeout?: () => void;
};

export class HeldRequestCoordinator<TBody> {
  private readonly pending = new Map<string, HeldRequestRecord<TBody>>();
  private readonly writeResolution: (
    response: ServerResponse<IncomingMessage>,
    resolution: HeldRequestResolution<TBody>,
  ) => void;

  constructor(options: {
    writeResolution: (
      response: ServerResponse<IncomingMessage>,
      resolution: HeldRequestResolution<TBody>,
    ) => void;
  }) {
    this.writeResolution = options.writeResolution;
  }

  hold(options: {
    taskId: string;
    interactionId: string;
    response: ServerResponse<IncomingMessage>;
    timeoutMs: number;
    fallback: HeldRequestResolution<TBody>;
    mapResponse?: (response: AttentionResponse) => HeldRequestResolution<TBody> | null;
    onTimeout?: () => void;
  }): void {
    const key = heldRequestKey(options.taskId, options.interactionId);
    const timeout = setTimeout(() => {
      const record = this.pending.get(key);
      if (!record) {
        return;
      }
      clearTimeout(record.timeout);
      this.pending.delete(key);
      record.onTimeout?.();
      this.write(record.response, record.fallback);
    }, options.timeoutMs);

    this.pending.set(key, {
      taskId: options.taskId,
      interactionId: options.interactionId,
      response: options.response,
      timeout,
      fallback: options.fallback,
      mapResponse:
        options.mapResponse ?? ((response) => ({ statusCode: 200, body: response as TBody })),
      ...(options.onTimeout ? { onTimeout: options.onTimeout } : {}),
    });
  }

  resolve(response: AttentionResponse): boolean {
    const key = heldRequestKey(response.taskId, response.interactionId);
    const record = this.pending.get(key);
    if (!record) {
      return false;
    }
    const resolution = record.mapResponse(response);
    if (!resolution) {
      return false;
    }
    this.releaseRecord(key, record, resolution);
    return true;
  }

  has(taskId: string, interactionId: string): boolean {
    return this.pending.has(heldRequestKey(taskId, interactionId));
  }

  release(
    taskId: string,
    interactionId: string,
    resolution?: HeldRequestResolution<TBody>,
  ): boolean {
    const key = heldRequestKey(taskId, interactionId);
    const record = this.pending.get(key);
    if (!record) {
      return false;
    }
    this.releaseRecord(key, record, resolution ?? record.fallback);
    return true;
  }

  cancel(taskId: string, interactionId: string): boolean {
    const key = heldRequestKey(taskId, interactionId);
    const record = this.pending.get(key);
    if (!record) {
      return false;
    }
    clearTimeout(record.timeout);
    this.pending.delete(key);
    return true;
  }

  close(): void {
    for (const [key, record] of this.pending.entries()) {
      this.releaseRecord(key, record, record.fallback);
    }
  }

  private releaseRecord(
    key: string,
    record: HeldRequestRecord<TBody>,
    resolution: HeldRequestResolution<TBody>,
  ): void {
    clearTimeout(record.timeout);
    this.pending.delete(key);
    this.write(record.response, resolution);
  }

  private write(
    response: ServerResponse<IncomingMessage>,
    resolution: HeldRequestResolution<TBody>,
  ): void {
    if (response.writableEnded) {
      return;
    }
    this.writeResolution(response, resolution);
  }
}

function heldRequestKey(taskId: string, interactionId: string): string {
  return `${taskId}::${interactionId}`;
}
