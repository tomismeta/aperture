import type {
  AttentionView,
  ConformedEvent,
  FrameResponse,
} from "@aperture/core";

import type { ApertureRuntimeEvent, ApertureRuntimeSnapshot } from "./runtime.js";

export type ApertureRuntimeAdapterClientOptions = {
  baseUrl: string;
  kind: string;
  id?: string;
  label?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  metadata?: Record<string, string>;
};

type ResponseListener = (response: FrameResponse) => void;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class ApertureRuntimeAdapterClient {
  private readonly baseUrl: string;
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
    attentionView: { active: null, queued: [], ambient: [] },
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
        queued: 0,
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
  };

  private constructor(options: ApertureRuntimeAdapterClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
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

  async publishConformed(event: ConformedEvent): Promise<void> {
    await this.post("/events/conformed", { event });
    await this.refreshState();
  }

  async publishConformedBatch(events: ConformedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.post("/events/conformed", { events });
    await this.refreshState();
  }

  async submit(response: FrameResponse): Promise<void> {
    await this.post("/responses", response);
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
      await fetch(`${this.baseUrl}/adapters/${encodeURIComponent(this.adapterId)}`, {
        method: "DELETE",
      }).catch(() => {});
      this.adapterId = null;
    }
  }

  private async initialize(): Promise<void> {
    const attach = await this.post<{ adapterId: string; heartbeatIntervalMs: number }>(
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
      void this.post(`/adapters/${encodeURIComponent(this.adapterId)}/heartbeat`, {}).catch(() => {});
    }, heartbeatMs);
    this.pollIntervalId = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.refreshState();
    const payload = await this.get<{ events: ApertureRuntimeEvent[]; nextSequence: number }>(
      `/events?since=${this.nextSequence}`,
    );
    this.nextSequence = payload.nextSequence;
    for (const event of payload.events) {
      if (event.type === "response") {
        for (const listener of this.responseListeners) {
          listener(event.response);
        }
      }
    }
  }

  private async refreshState(): Promise<void> {
    this.snapshotState = await this.get<ApertureRuntimeSnapshot>("/state");
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async post<T = Record<string, never>>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
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
}
