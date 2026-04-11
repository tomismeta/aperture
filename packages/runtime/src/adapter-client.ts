import type { AttentionResponse, AttentionView, SourceEvent } from "@tomismeta/aperture-core";

import type {
  ApertureRuntimeEvent,
  ApertureRuntimeSnapshot,
  WorkReceipt,
  WorkResponse,
} from "./runtime-contract.js";
import type { WorkInput } from "./work-event-ingest.js";
import {
  deleteJson,
  createEmptyRuntimeSnapshot,
  DEFAULT_RUNTIME_POLL_INTERVAL_MS,
  getJson,
  normalizeRuntimeUrls,
  postJson,
  resolveRuntimeAuthToken,
} from "./runtime-client-shared.js";
import { buildWorkResponsePath } from "./runtime-work.js";

export type ApertureRuntimeAdapterClientOptions = {
  baseUrl: string;
  kind: string;
  authToken?: string;
  id?: string;
  label?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  metadata?: Record<string, string>;
};

type ResponseListener = (response: AttentionResponse) => void;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
export class ApertureRuntimeAdapterClient {
  private readonly baseUrl: string;
  private readonly controlUrl: string;
  private readonly kind: string;
  private readonly requestedId: string | undefined;
  private readonly label: string | undefined;
  private readonly requestedHeartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly metadata: Record<string, string> | undefined;
  private readonly explicitAuthToken: string | undefined;
  private readonly responseListeners = new Set<ResponseListener>();
  private adapterId: string | null = null;
  private authToken = "";
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private nextSequence = 0;
  private closed = false;
  private snapshotState: ApertureRuntimeSnapshot = createEmptyRuntimeSnapshot();

  private constructor(options: ApertureRuntimeAdapterClientOptions) {
    const runtimeUrls = normalizeRuntimeUrls(options.baseUrl);
    this.baseUrl = runtimeUrls.baseUrl;
    this.controlUrl = runtimeUrls.controlUrl;
    this.kind = options.kind;
    this.requestedId = options.id;
    this.label = options.label;
    this.requestedHeartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUNTIME_POLL_INTERVAL_MS;
    this.metadata = options.metadata;
    this.explicitAuthToken = options.authToken;
  }

  static async connect(
    options: ApertureRuntimeAdapterClientOptions,
  ): Promise<ApertureRuntimeAdapterClient> {
    const client = new ApertureRuntimeAdapterClient(options);
    await client.initialize();
    return client;
  }

  getAttentionView(): AttentionView {
    return this.snapshotState.attentionView;
  }

  getSurfaceCount(): number {
    return this.snapshotState.surfaceCount;
  }

  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  async publishSourceEvent(event: SourceEvent): Promise<void> {
    await this.postControl("/events/source", { event });
    await this.refreshState();
  }

  async publishSourceEventBatch(events: SourceEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.postControl("/events/source", { events });
    await this.refreshState();
  }

  async publishWork(work: WorkInput): Promise<WorkReceipt> {
    const result = await this.postBase<WorkReceipt>(
      "/work",
      work,
      typeof work === "string" ? "text/plain" : "application/json",
    );
    await this.refreshState();
    return result;
  }

  async getWorkResponse(interactionId: string): Promise<WorkResponse> {
    return this.getBase<WorkResponse>(buildWorkResponsePath(interactionId));
  }

  async submit(response: AttentionResponse): Promise<void> {
    await this.postControl("/response", response);
    await this.refreshState();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.adapterId) {
      await deleteJson(
        `${this.controlUrl}/adapters/${encodeURIComponent(this.adapterId)}`,
        this.authToken,
      ).catch(() => {});
      this.adapterId = null;
    }
  }

  private async initialize(): Promise<void> {
    this.authToken = await resolveRuntimeAuthToken(this.controlUrl, this.explicitAuthToken);
    const attach = await this.postControl<{ adapterId: string; heartbeatIntervalMs: number }>(
      "/adapters/register",
      {
        kind: this.kind,
        ...(this.requestedId ? { id: this.requestedId } : {}),
        ...(this.label ? { label: this.label } : {}),
        ...(this.metadata ? { metadata: this.metadata } : {}),
      },
    );
    this.adapterId = attach.adapterId;
    await this.refreshState();
    const heartbeatMs = Math.min(
      attach.heartbeatIntervalMs,
      Math.max(1_000, this.requestedHeartbeatIntervalMs),
    );
    this.heartbeatIntervalId = setInterval(() => {
      if (!this.adapterId || this.closed) {
        return;
      }
      void this.postControl(`/adapters/${encodeURIComponent(this.adapterId)}/heartbeat`, {}).catch(
        () => {},
      );
    }, heartbeatMs);
    this.pollIntervalId = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.closed) {
      return;
    }
    const payload = await this.getControl<{
      events: ApertureRuntimeEvent[];
      nextSequence: number;
      stateVersion: number;
    }>(`/events?since=${this.nextSequence}`);
    this.nextSequence = payload.nextSequence;
    if (payload.stateVersion !== this.snapshotState.version) {
      await this.refreshState();
    }
    for (const event of payload.events) {
      if (event.type === "response") {
        for (const listener of this.responseListeners) {
          listener(event.response);
        }
      }
    }
  }

  private async refreshState(): Promise<void> {
    this.snapshotState = await this.getControl<ApertureRuntimeSnapshot>("/state");
  }

  private async getControl<T>(path: string): Promise<T> {
    return getJson<T>(`${this.controlUrl}${path}`, this.authToken);
  }

  private async postControl<T = Record<string, never>>(path: string, body: unknown): Promise<T> {
    return postJson<T>(`${this.controlUrl}${path}`, body, this.authToken);
  }

  private async postBase<T = Record<string, never>>(
    path: string,
    body: unknown,
    contentType: string,
  ): Promise<T> {
    return postJson<T>(`${this.baseUrl}${path}`, body, this.authToken, contentType);
  }

  private async getBase<T>(path: string): Promise<T> {
    return getJson<T>(`${this.baseUrl}${path}`, this.authToken);
  }
}
