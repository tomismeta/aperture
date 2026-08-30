import type { AttentionResponse, AttentionView, SourceEvent } from "@tomismeta/aperture-core";

import type {
  ApertureRuntimeEvent,
  ApertureRuntimeSnapshot,
  WorkReceipt,
  WorkResponse,
} from "./runtime-contract.js";
import { RuntimeAttachmentSession } from "./runtime-client-session.js";
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

export type ApertureRuntimeAdapterClientErrorListener = (error: Error) => void;

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
  private readonly errorListeners = new Set<ApertureRuntimeAdapterClientErrorListener>();
  private adapterId: string | null = null;
  private authToken = "";
  private session: RuntimeAttachmentSession | null = null;
  private lastError: Error | null = null;
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

  getResponseSurfaceCount(): number {
    return this.snapshotState.responseSurfaceCount;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  onError(listener: ApertureRuntimeAdapterClientErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
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
    await this.session?.close();
    this.session = null;
    this.adapterId = null;
  }

  private async initialize(): Promise<void> {
    this.authToken = await resolveRuntimeAuthToken(this.controlUrl, this.explicitAuthToken);
    this.session = new RuntimeAttachmentSession({
      pollIntervalMs: this.pollIntervalMs,
      attach: async () => {
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
        return {
          attachedId: attach.adapterId,
          heartbeatIntervalMs: Math.min(
            attach.heartbeatIntervalMs,
            Math.max(1_000, this.requestedHeartbeatIntervalMs),
          ),
        };
      },
      heartbeat: async (adapterId) => {
        await this.postControl(`/adapters/${encodeURIComponent(adapterId)}/heartbeat`, {});
      },
      detach: async (adapterId) => {
        try {
          await deleteJson(
            `${this.controlUrl}/adapters/${encodeURIComponent(adapterId)}`,
            this.authToken,
          );
        } finally {
          this.adapterId = null;
        }
      },
      poll: (since) =>
        this.getControl<{
          events: ApertureRuntimeEvent[];
          nextSequence: number;
          stateVersion: number;
        }>(`/events?since=${since}`),
      onPoll: async (payload) => {
        if (payload.stateVersion !== this.snapshotState.version) {
          await this.refreshState();
        }
        for (const event of payload.events) {
          if (event.type !== "response") {
            continue;
          }
          for (const listener of this.responseListeners) {
            listener(event.response);
          }
        }
      },
      onError: (error) => this.reportError(error),
    });
    await this.session.start();
  }

  private async refreshState(): Promise<void> {
    this.snapshotState = await this.getControl<ApertureRuntimeSnapshot>("/state");
    this.lastError = null;
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

  private reportError(error: unknown): void {
    const nextError = error instanceof Error ? error : new Error(String(error));
    this.lastError = nextError;
    for (const listener of this.errorListeners) {
      listener(nextError);
    }
  }
}
