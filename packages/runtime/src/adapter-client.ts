import type {
  AttentionResponse,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";

import type {
  ApertureRuntimeEvent,
  ApertureRuntimeSnapshot,
  WorkReceipt,
  WorkResponse,
} from "./runtime.js";
import type { WorkPayload } from "./work-event-ingest.js";

export type ApertureRuntimeAdapterClientOptions = {
  baseUrl: string;
  kind: string;
  id?: string;
  label?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  metadata?: Record<string, string>;
};

type ResponseListener = (response: AttentionResponse) => void;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class ApertureRuntimeAdapterClient {
  private readonly baseUrl: string;
  private readonly controlUrl: string;
  private readonly kind: string;
  private readonly requestedId: string | undefined;
  private readonly label: string | undefined;
  private readonly requestedHeartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly metadata: Record<string, string> | undefined;
  private readonly responseListeners = new Set<ResponseListener>();
  private adapterId: string | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private nextSequence = 0;
  private closed = false;
  private snapshotState: ApertureRuntimeSnapshot = {
    version: 0,
    attentionView: { now: null, next: [], ambient: [] },
    signalSummary: {
      recentSignals: 0,
      lifetimeSignals: 0,
      counts: {
        presented: 0,
        viewed: 0,
        responded: 0,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      deferred: {
        next: 0,
        suppressed: 0,
        manual: 0,
      },
      responseRate: 0,
      dismissalRate: 0,
      averageResponseLatencyMs: null,
      averageDismissalLatencyMs: null,
      lastSignalAt: null,
    },
    attentionState: "monitoring",
    adapters: [],
    surfaceCount: 0,
    surfaceCapabilities: {
      topology: {
        supportsAmbient: true,
      },
      responses: {
        supportsSingleChoice: true,
        supportsMultipleChoice: false,
        supportsForm: true,
        supportsTextResponse: false,
      },
    },
  };

  private constructor(options: ApertureRuntimeAdapterClientOptions) {
    const runtimeUrls = normalizeRuntimeUrls(options.baseUrl);
    this.baseUrl = runtimeUrls.baseUrl;
    this.controlUrl = runtimeUrls.controlUrl;
    this.kind = options.kind;
    this.requestedId = options.id;
    this.label = options.label;
    this.requestedHeartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.metadata = options.metadata;
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

  async publishWork(work: WorkPayload): Promise<WorkReceipt> {
    const result = await this.postBase<WorkReceipt>(
      "/work",
      work,
      typeof work === "string" ? "text/plain" : "application/json",
    );
    await this.refreshState();
    return result;
  }

  async getWorkResponse(interactionId: string): Promise<WorkResponse> {
    return this.getBase<WorkResponse>(`/work/response/${encodeURIComponent(interactionId)}`);
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
      await fetch(`${this.controlUrl}/adapters/${encodeURIComponent(this.adapterId)}`, {
        method: "DELETE",
      }).catch(() => {});
      this.adapterId = null;
    }
  }

  private async initialize(): Promise<void> {
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
      void this.postControl(`/adapters/${encodeURIComponent(this.adapterId)}/heartbeat`, {}).catch(() => {});
    }, heartbeatMs);
    this.pollIntervalId = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.closed) {
      return;
    }
    const payload = await this.getControl<{ events: ApertureRuntimeEvent[]; nextSequence: number; stateVersion: number }>(
      `/events?since=${this.nextSequence}`,
    );
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
    const response = await fetch(`${this.controlUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async postControl<T = Record<string, never>>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.controlUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async postBase<T = Record<string, never>>(
    path: string,
    body: unknown,
    contentType: string,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async getBase<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

function normalizeRuntimeUrls(input: string): { baseUrl: string; controlUrl: string } {
  const normalized = input.replace(/\/+$/, "");
  if (normalized.endsWith("/runtime")) {
    return {
      baseUrl: normalized.slice(0, -"/runtime".length),
      controlUrl: normalized,
    };
  }
  return {
    baseUrl: normalized,
    controlUrl: `${normalized}/runtime`,
  };
}
