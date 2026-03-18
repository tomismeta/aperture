import {
  ApertureRuntimeAdapterClient,
  type ApertureRuntimeAdapterClientOptions,
} from "@aperture/runtime/adapter";
import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";

import { CodexAppServerClient, type CodexAppServerClientOptions } from "./client.js";
import type {
  CodexRawServerNotification,
  CodexRawServerRequest,
  JsonRpcId,
} from "./protocol.js";
import {
  mapCodexNotification,
  mapCodexResponse,
  mapCodexServerRequest,
  type CodexResponsePayload,
  type CodexMappingContext,
} from "./mapping.js";

export type CodexBridgeOptions = {
  runtimeBaseUrl: string;
  runtimeLabel?: string;
  runtimeMetadata?: Record<string, string>;
  sourceLabel?: string;
  client?: CodexBridgeClient;
  appServer?: CodexAppServerClientOptions;
  reconnect?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
  };
  requestTimeoutMs?: number;
  debug?: boolean;
  logger?: Pick<Console, "error" | "warn" | "info">;
  runtimeClientFactory?: (
    options: ApertureRuntimeAdapterClientOptions,
  ) => Promise<CodexRuntimeClient>;
};

export type CodexBridge = {
  start(): Promise<void>;
  close(): Promise<void>;
  getClient(): CodexBridgeClient;
};

export type CodexBridgeClient = Pick<
  CodexAppServerClient,
  | "start"
  | "close"
  | "onNotification"
  | "onServerRequest"
  | "onExit"
  | "onStderr"
  | "respond"
  | "respondError"
  | "threadStart"
  | "threadResume"
  | "turnStart"
  | "turnSteer"
  | "turnInterrupt"
  | "reviewStart"
>;

export type CodexRuntimeClient = Pick<
  ApertureRuntimeAdapterClient,
  "publishSourceEventBatch" | "onResponse" | "close"
>;

type PendingRequest = {
  taskId: string;
  interactionId: string;
  request: CodexRawServerRequest;
};

export function createCodexBridge(options: CodexBridgeOptions): CodexBridge {
  const client = options.client ?? new CodexAppServerClient(options.appServer);
  const runtimeClientFactory =
    options.runtimeClientFactory
    ?? ((runtimeOptions) => ApertureRuntimeAdapterClient.connect(runtimeOptions));
  const mappingContext: CodexMappingContext = {
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
  };
  const adapterId = "codex-app-server";
  const logger = options.logger ?? console;
  const debug = options.debug ?? false;
  const reconnectInitialDelayMs = options.reconnect?.initialDelayMs ?? 1_000;
  const reconnectMaxDelayMs = options.reconnect?.maxDelayMs ?? 10_000;
  const reconnectMaxAttempts = options.reconnect?.maxAttempts ?? Infinity;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5 * 60_000;
  const pendingByInteractionId = new Map<string, PendingRequest>();
  const pendingByRequestId = new Map<string, PendingRequest>();
  const timeoutByInteractionId = new Map<string, NodeJS.Timeout>();
  let runtimeClient: CodexRuntimeClient | null = null;
  let responseUnsubscribe: (() => void) | null = null;
  let notificationUnsubscribe: (() => void) | null = null;
  let requestUnsubscribe: (() => void) | null = null;
  let exitUnsubscribe: (() => void) | null = null;
  let stderrUnsubscribe: (() => void) | null = null;
  let closed = false;
  let startPromise: Promise<void> | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;

  return {
    async start() {
      closed = false;
      runtimeClient = await runtimeClientFactory({
        baseUrl: options.runtimeBaseUrl,
        kind: "codex",
        id: adapterId,
        label: options.runtimeLabel ?? "Codex adapter",
        metadata: {
          transport: "app-server",
          ...(options.runtimeMetadata ?? {}),
        },
      });

      responseUnsubscribe = runtimeClient.onResponse((response: AttentionResponse) => {
        void handleRuntimeResponse(response);
      });
      notificationUnsubscribe = client.onNotification((notification) => {
        void handleNotification(notification);
      });
      requestUnsubscribe = client.onServerRequest((request) => {
        void handleServerRequest(request);
      });
      exitUnsubscribe = client.onExit((error) => {
        void handleClientExit(error);
      });
      stderrUnsubscribe = client.onStderr((line) => {
        logger.info?.(`[codex] ${line}`);
      });

      await startClient();
    },
    async close() {
      closed = true;
      clearReconnectTimer();
      responseUnsubscribe?.();
      notificationUnsubscribe?.();
      requestUnsubscribe?.();
      exitUnsubscribe?.();
      stderrUnsubscribe?.();
      responseUnsubscribe = null;
      notificationUnsubscribe = null;
      requestUnsubscribe = null;
      exitUnsubscribe = null;
      stderrUnsubscribe = null;
      clearPendingRequests();
      await client.close();
      if (runtimeClient) {
        await runtimeClient.close();
        runtimeClient = null;
      }
    },
    getClient() {
      return client;
    },
  };

  async function handleServerRequest(request: CodexRawServerRequest): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    if (debug) {
      logger.info?.(`[codex] server request ${request.method}`);
    }
    const mapped = mapCodexServerRequest(request, mappingContext);
    if (!mapped) {
      logger.warn?.(`[codex] unsupported server request ${request.method}`);
      client.respondError(request.id, {
        code: -32601,
        message: `Unsupported Codex server request: ${request.method}`,
      });
      return;
    }
    if (debug) {
      logger.info?.(
        `[codex] mapped request ${request.method} -> ${mapped.events.length} SourceEvent(s)`,
      );
    }
    pendingByInteractionId.set(mapped.interactionId, {
      taskId: mapped.taskId,
      interactionId: mapped.interactionId,
      request,
    });
    pendingByRequestId.set(String(request.id), {
      taskId: mapped.taskId,
      interactionId: mapped.interactionId,
      request,
    });
    scheduleRequestTimeout(mapped.taskId, mapped.interactionId, request);
    await runtimeClient.publishSourceEventBatch(mapped.events);
  }

  async function handleNotification(notification: CodexRawServerNotification): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    if (debug) {
      logger.info?.(`[codex] notification ${notification.method}`);
    }
    if (
      notification.method === "serverRequest/resolved"
      && isServerRequestResolvedNotification(notification.params)
    ) {
      const pending = pendingByRequestId.get(String(notification.params.requestId));
      if (pending) {
        clearPendingRequest(pending.interactionId, String(notification.params.requestId));
      }
      return;
    }

    const events = mapCodexNotification(notification, mappingContext);
    if (debug && events.length > 0) {
      logger.info?.(
        `[codex] mapped notification ${notification.method} -> ${events.length} SourceEvent(s)`,
      );
    }
    if (events.length === 0) {
      return;
    }
    await runtimeClient.publishSourceEventBatch(events);
  }

  async function handleRuntimeResponse(response: AttentionResponse): Promise<void> {
    if (debug) {
      logger.info?.(`[codex] runtime response ${response.response.kind} for ${response.interactionId}`);
    }
    const pending = pendingByInteractionId.get(response.interactionId);
    if (!pending) {
      return;
    }
    const payload: CodexResponsePayload | null = mapCodexResponse(response, pending.request);
    if (!payload) {
      return;
    }
    clearPendingRequest(response.interactionId, String(pending.request.id));
    client.respond(pending.request.id as JsonRpcId, payload);
  }

  async function startClient(): Promise<void> {
    if (startPromise) {
      return startPromise;
    }
    startPromise = client.start()
      .then(() => {
        reconnectAttempts = 0;
      })
      .finally(() => {
        startPromise = null;
      });
    return startPromise;
  }

  async function handleClientExit(error: Error): Promise<void> {
    if (closed) {
      return;
    }
    logger.warn?.(`[codex] app server disconnected: ${error.message}`);
    clearPendingRequests();
    await publishBridgeStatusEvent(
      "Codex App Server disconnected",
      error.message,
      "waiting",
    );
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) {
      return;
    }
    reconnectAttempts += 1;
    if (reconnectAttempts > reconnectMaxAttempts) {
      logger.error?.("[codex] reconnect limit reached; stopping Codex adapter");
      return;
    }
    const delayMs = Math.min(
      reconnectMaxDelayMs,
      reconnectInitialDelayMs * 2 ** Math.max(0, reconnectAttempts - 1),
    );
    logger.info?.(`[codex] reconnecting in ${delayMs}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void startClient().then(() => {
        void publishBridgeStatusEvent(
          "Codex App Server connected",
          reconnectAttempts > 1 ? "Codex App Server reconnected." : "Codex App Server connected.",
          "running",
        );
      }).catch((restartError) => {
        const message = restartError instanceof Error ? restartError.message : String(restartError);
        logger.error?.(`[codex] reconnect failed: ${message}`);
        scheduleReconnect();
      });
    }, delayMs);
  }

  function clearReconnectTimer(): void {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearPendingRequests(): void {
    for (const timeout of timeoutByInteractionId.values()) {
      clearTimeout(timeout);
    }
    timeoutByInteractionId.clear();
    pendingByInteractionId.clear();
    pendingByRequestId.clear();
  }

  function clearPendingRequest(interactionId: string, requestId: string): void {
    pendingByInteractionId.delete(interactionId);
    pendingByRequestId.delete(requestId);
    const timeout = timeoutByInteractionId.get(interactionId);
    if (timeout) {
      clearTimeout(timeout);
      timeoutByInteractionId.delete(interactionId);
    }
  }

  function scheduleRequestTimeout(
    taskId: string,
    interactionId: string,
    request: CodexRawServerRequest,
  ): void {
    const existing = timeoutByInteractionId.get(interactionId);
    if (existing) {
      clearTimeout(existing);
    }
    timeoutByInteractionId.set(
      interactionId,
      setTimeout(() => {
        timeoutByInteractionId.delete(interactionId);
        if (!pendingByInteractionId.has(interactionId)) {
          return;
        }
        logger.warn?.(
          `[codex] request timed out waiting for Aperture response: ${request.method} (${interactionId})`,
        );
        clearPendingRequest(interactionId, String(request.id));
        client.respondError(request.id, {
          code: -32000,
          message: `Timed out waiting for Aperture response to ${request.method}`,
        });
        void publishBridgeStatusEvent(
          "Codex request timed out",
          `Aperture did not respond to ${request.method} in time.`,
          "waiting",
          taskId,
        );
      }, requestTimeoutMs),
    );
  }

  async function publishBridgeStatusEvent(
    title: string,
    summary: string,
    status: "running" | "waiting",
    taskId = "codex:adapter",
  ): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    const event: SourceEvent = {
      id: `codex-bridge:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`,
      type: "task.updated",
      taskId,
      timestamp: new Date().toISOString(),
      source: {
        id: "codex-app-server",
        kind: "codex",
        label: options.sourceLabel ?? "Codex",
      },
      activityClass: "session_status",
      title,
      summary,
      status,
    };
    await runtimeClient.publishSourceEventBatch([event]);
  }

  function isServerRequestResolvedNotification(
    params: unknown,
  ): params is { threadId: string; requestId: JsonRpcId } {
    return (
      typeof params === "object"
      && params !== null
      && typeof (params as { threadId?: unknown }).threadId === "string"
      && (typeof (params as { requestId?: unknown }).requestId === "string"
        || typeof (params as { requestId?: unknown }).requestId === "number")
    );
  }
}
