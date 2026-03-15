import type {
  AttentionResponse,
  AttentionSignalSummary,
  AttentionSurfaceCapabilities,
  AttentionState,
  AttentionView,
} from "@tomismeta/aperture-core";

import type { ApertureRuntimeEvent, ApertureRuntimeSnapshot } from "./runtime.js";

export type ApertureRuntimeClientOptions = {
  baseUrl: string;
  pollIntervalMs?: number;
  label?: string;
  surfaceCapabilities?: PartialSurfaceCapabilities;
};

type PartialSurfaceCapabilities = {
  topology?: Partial<AttentionSurfaceCapabilities["topology"]>;
  responses?: Partial<AttentionSurfaceCapabilities["responses"]>;
};

type AttentionViewListener = (attentionView: AttentionView) => void;
type ResponseListener = (response: AttentionResponse) => void;

const DEFAULT_POLL_INTERVAL_MS = 250;

export class ApertureRuntimeClient {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly label: string;
  private readonly surfaceCapabilities: PartialSurfaceCapabilities | undefined;
  private readonly attentionListeners = new Set<AttentionViewListener>();
  private readonly responseListeners = new Set<ResponseListener>();
  private snapshotState: ApertureRuntimeSnapshot = {
    version: 0,
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
  private surfaceId: string | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private nextSequence = 0;
  private closed = false;

  private constructor(options: ApertureRuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.label = options.label ?? "tui";
    this.surfaceCapabilities = options.surfaceCapabilities;
  }

  static async connect(options: ApertureRuntimeClientOptions): Promise<ApertureRuntimeClient> {
    const client = new ApertureRuntimeClient(options);
    await client.initialize();
    return client;
  }

  getAttentionView(): AttentionView {
    return this.snapshotState.attentionView;
  }

  getSignalSummary(): AttentionSignalSummary {
    return this.snapshotState.signalSummary;
  }

  getAttentionState(): AttentionState {
    return this.snapshotState.attentionState;
  }

  subscribeAttentionView(listener: AttentionViewListener): () => void {
    this.attentionListeners.add(listener);
    listener(this.snapshotState.attentionView);
    return () => {
      this.attentionListeners.delete(listener);
    };
  }

  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  submit(response: AttentionResponse): void {
    void this.post("/responses", response)
      .then(() => this.refreshState())
      .catch(() => {});
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
    if (this.surfaceId) {
      await fetch(`${this.baseUrl}/surfaces/${encodeURIComponent(this.surfaceId)}`, {
        method: "DELETE",
      }).catch(() => {});
      this.surfaceId = null;
    }
  }

  private async initialize(): Promise<void> {
    const attach = await this.post<{ surfaceId: string; heartbeatIntervalMs: number }>(
      "/surfaces/attach",
      {
        label: this.label,
        ...(this.surfaceCapabilities ? { capabilities: this.surfaceCapabilities } : {}),
      },
    );
    this.surfaceId = attach.surfaceId;
    await this.refreshState();
    this.heartbeatIntervalId = setInterval(() => {
      if (!this.surfaceId || this.closed) {
        return;
      }
      void this.post(`/surfaces/${encodeURIComponent(this.surfaceId)}/heartbeat`, {}).catch(() => {});
    }, attach.heartbeatIntervalMs);
    this.pollIntervalId = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.closed) {
      return;
    }
    const payload = await this.get<{ events: ApertureRuntimeEvent[]; nextSequence: number; stateVersion: number }>(
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
    const snapshot = await this.get<ApertureRuntimeSnapshot>("/state");
    const versionChanged = snapshot.version !== this.snapshotState.version;
    this.snapshotState = snapshot;
    if (versionChanged) {
      for (const listener of this.attentionListeners) {
        listener(snapshot.attentionView);
      }
    }
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
