import type {
  AttentionResponse,
  AttentionSurfaceCapabilities,
  AttentionView,
} from "@tomismeta/aperture-core";
import type {
  ApertureTrace,
  AttentionSignalSummary,
  AttentionState,
} from "../../core/src/internal-contract.js";

import type {
  ApertureRuntimeEvent,
  ApertureRuntimeSessionCapture,
  ApertureRuntimeSnapshot,
} from "./runtime-contract.js";
import {
  createEmptyRuntimeSnapshot,
  DEFAULT_RUNTIME_POLL_INTERVAL_MS,
  getJson,
  normalizeRuntimeUrls,
  postJson,
} from "./runtime-client-shared.js";

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
type TraceListener = (trace: ApertureTrace) => void;

export class ApertureRuntimeClient {
  private readonly controlUrl: string;
  private readonly pollIntervalMs: number;
  private readonly label: string;
  private readonly surfaceCapabilities: PartialSurfaceCapabilities | undefined;
  private readonly attentionListeners = new Set<AttentionViewListener>();
  private readonly responseListeners = new Set<ResponseListener>();
  private readonly traceListeners = new Set<TraceListener>();
  private snapshotState: ApertureRuntimeSnapshot = createEmptyRuntimeSnapshot();
  private surfaceId: string | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;
  private nextSequence = 0;
  private closed = false;

  private constructor(options: ApertureRuntimeClientOptions) {
    const runtimeUrls = normalizeRuntimeUrls(options.baseUrl);
    this.controlUrl = runtimeUrls.controlUrl;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUNTIME_POLL_INTERVAL_MS;
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

  onTrace(listener: TraceListener): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  submit(response: AttentionResponse): void {
    void this.post("/response", response)
      .then(() => this.refreshState())
      .catch(() => {});
  }

  engage(taskId: string, interactionId: string, options: { durationMs?: number } = {}): void {
    void this.post("/engagement", {
      taskId,
      interactionId,
      ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    })
      .then(() => this.refreshState())
      .catch(() => {});
  }

  exportSessionCapture(): Promise<ApertureRuntimeSessionCapture> {
    return this.get<ApertureRuntimeSessionCapture>("/session");
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
      await fetch(`${this.controlUrl}/surfaces/${encodeURIComponent(this.surfaceId)}`, {
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
      } else if (event.type === "trace") {
        for (const listener of this.traceListeners) {
          listener(event.trace);
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
    return getJson<T>(`${this.controlUrl}${path}`);
  }

  private async post<T = Record<string, never>>(path: string, body: unknown): Promise<T> {
    return postJson<T>(`${this.controlUrl}${path}`, body);
  }
}
