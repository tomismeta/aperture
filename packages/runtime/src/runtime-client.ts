import type {
  AttentionResponse,
  AttentionSurfaceCapabilities,
  AttentionView,
} from "@tomismeta/aperture-core";
import type {
  ApertureTrace,
  AttentionSignalSummary,
  AttentionState,
} from "@tomismeta/aperture-core/internal";

import type {
  ApertureRuntimeEvent,
  ApertureRuntimeSessionCapture,
  ApertureRuntimeSnapshot,
  ApertureRuntimeSurfaceRole,
} from "./runtime-contract.js";
import { RuntimeAttachmentSession } from "./runtime-client-session.js";
import {
  createEmptyRuntimeSnapshot,
  DEFAULT_RUNTIME_POLL_INTERVAL_MS,
  deleteJson,
  getJson,
  normalizeRuntimeUrls,
  postJson,
  resolveRuntimeAuthToken,
} from "./runtime-client-shared.js";

export type ApertureRuntimeClientOptions = {
  baseUrl: string;
  authToken?: string;
  pollIntervalMs?: number;
  label?: string;
  surfaceRole?: ApertureRuntimeSurfaceRole;
  surfaceCapabilities?: PartialSurfaceCapabilities;
};

export type ApertureRuntimeClientErrorListener = (error: Error) => void;

type PartialSurfaceCapabilities = {
  topology?: Partial<AttentionSurfaceCapabilities["topology"]>;
  responses?: Partial<AttentionSurfaceCapabilities["responses"]>;
};

type AttentionViewListener = (attentionView: AttentionView) => void;
export type ApertureRuntimeSnapshotListener = (snapshot: ApertureRuntimeSnapshot) => void;
type ResponseListener = (response: AttentionResponse) => void;
type TraceListener = (trace: ApertureTrace) => void;

export class ApertureRuntimeClient {
  private readonly controlUrl: string;
  private readonly pollIntervalMs: number;
  private readonly label: string;
  private readonly surfaceRole: ApertureRuntimeSurfaceRole;
  private readonly surfaceCapabilities: PartialSurfaceCapabilities | undefined;
  private readonly explicitAuthToken: string | undefined;
  private readonly attentionListeners = new Set<AttentionViewListener>();
  private readonly snapshotListeners = new Set<ApertureRuntimeSnapshotListener>();
  private readonly responseListeners = new Set<ResponseListener>();
  private readonly traceListeners = new Set<TraceListener>();
  private readonly errorListeners = new Set<ApertureRuntimeClientErrorListener>();
  private snapshotState: ApertureRuntimeSnapshot = createEmptyRuntimeSnapshot();
  private surfaceId: string | null = null;
  private authToken = "";
  private session: RuntimeAttachmentSession | null = null;
  private lastError: Error | null = null;

  private constructor(options: ApertureRuntimeClientOptions) {
    const runtimeUrls = normalizeRuntimeUrls(options.baseUrl);
    this.controlUrl = runtimeUrls.controlUrl;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUNTIME_POLL_INTERVAL_MS;
    this.label = options.label ?? "tui";
    this.surfaceCapabilities = options.surfaceCapabilities;
    this.surfaceRole = options.surfaceRole ?? "participant";
    this.explicitAuthToken = options.authToken;
  }

  static async connect(options: ApertureRuntimeClientOptions): Promise<ApertureRuntimeClient> {
    const client = new ApertureRuntimeClient(options);
    await client.initialize();
    return client;
  }

  getAttentionView(): AttentionView {
    return this.snapshotState.attentionView;
  }

  getSnapshot(): ApertureRuntimeSnapshot {
    return structuredClone(this.snapshotState);
  }

  getSignalSummary(): AttentionSignalSummary {
    return this.snapshotState.signalSummary;
  }

  getAttentionState(): AttentionState {
    return this.snapshotState.attentionState;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  subscribeAttentionView(listener: AttentionViewListener): () => void {
    this.attentionListeners.add(listener);
    listener(this.snapshotState.attentionView);
    return () => {
      this.attentionListeners.delete(listener);
    };
  }

  subscribeSnapshot(listener: ApertureRuntimeSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.snapshotListeners.delete(listener);
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

  onError(listener: ApertureRuntimeClientErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  submit(response: AttentionResponse): void {
    this.runInBackground(async () => {
      await this.post("/response", response);
      await this.refreshState();
    });
  }

  engage(taskId: string, interactionId: string, options: { durationMs?: number } = {}): void {
    this.runInBackground(async () => {
      await this.post("/engagement", {
        taskId,
        interactionId,
        ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
      });
      await this.refreshState();
    });
  }

  exportSessionCapture(): Promise<ApertureRuntimeSessionCapture> {
    return this.get<ApertureRuntimeSessionCapture>("/session");
  }

  async close(): Promise<void> {
    await this.session?.close();
    this.session = null;
    this.surfaceId = null;
  }

  private async initialize(): Promise<void> {
    this.authToken = await resolveRuntimeAuthToken(this.controlUrl, this.explicitAuthToken);
    this.session = new RuntimeAttachmentSession({
      pollIntervalMs: this.pollIntervalMs,
      attach: async () => {
        const attach = await this.post<{ surfaceId: string; heartbeatIntervalMs: number }>(
          "/surfaces/attach",
          {
            label: this.label,
            role: this.surfaceRole,
            ...(this.surfaceCapabilities ? { capabilities: this.surfaceCapabilities } : {}),
          },
        );
        this.surfaceId = attach.surfaceId;
        await this.refreshState();
        return {
          attachedId: attach.surfaceId,
          heartbeatIntervalMs: attach.heartbeatIntervalMs,
        };
      },
      heartbeat: async (surfaceId) => {
        await this.post(`/surfaces/${encodeURIComponent(surfaceId)}/heartbeat`, {});
      },
      detach: async (surfaceId) => {
        try {
          await deleteJson(
            `${this.controlUrl}/surfaces/${encodeURIComponent(surfaceId)}`,
            this.authToken,
          );
        } finally {
          this.surfaceId = null;
        }
      },
      poll: (since) =>
        this.get<{
          events: ApertureRuntimeEvent[];
          nextSequence: number;
          stateVersion: number;
        }>(`/events?since=${since}`),
      onPoll: async (payload) => {
        if (payload.stateVersion !== this.snapshotState.version) {
          await this.refreshState();
        }
        for (const event of payload.events) {
          if (event.type === "response") {
            for (const listener of this.responseListeners) {
              listener(event.response);
            }
            continue;
          }
          for (const listener of this.traceListeners) {
            listener(event.trace);
          }
        }
      },
      onError: (error) => this.reportError(error),
    });
    await this.session.start();
  }

  private async refreshState(): Promise<void> {
    const snapshot = await this.get<ApertureRuntimeSnapshot>("/state");
    const versionChanged = snapshot.version !== this.snapshotState.version;
    this.snapshotState = snapshot;
    this.lastError = null;
    if (versionChanged) {
      for (const listener of this.attentionListeners) {
        listener(snapshot.attentionView);
      }
      for (const listener of this.snapshotListeners) {
        listener(this.getSnapshot());
      }
    }
  }

  private async get<T>(path: string): Promise<T> {
    return getJson<T>(`${this.controlUrl}${path}`, this.authToken);
  }

  private async post<T = Record<string, never>>(path: string, body: unknown): Promise<T> {
    return postJson<T>(`${this.controlUrl}${path}`, body, this.authToken);
  }

  private runInBackground(task: () => Promise<void>): void {
    void task().catch((error) => this.reportError(error));
  }

  private reportError(error: unknown): void {
    const nextError = error instanceof Error ? error : new Error(String(error));
    this.lastError = nextError;
    for (const listener of this.errorListeners) {
      listener(nextError);
    }
  }
}
