import {
  ApertureRuntimeAdapterClient,
  type ApertureRuntimeAdapterClientOptions,
} from "@aperture/runtime/adapter";
import type { AttentionResponse } from "@tomismeta/aperture-core";

import { CodexAppServerClient, type CodexAppServerClientOptions } from "./client.js";
import type {
  CodexServerNotification,
  CodexServerRequest,
  JsonRpcId,
} from "./protocol.js";
import {
  mapCodexNotification,
  mapCodexResponse,
  mapCodexServerRequest,
  type CodexMappingContext,
} from "./mapping.js";

export type CodexBridgeOptions = {
  runtimeBaseUrl: string;
  runtimeLabel?: string;
  runtimeMetadata?: Record<string, string>;
  sourceLabel?: string;
  client?: CodexBridgeClient;
  appServer?: CodexAppServerClientOptions;
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
  interactionId: string;
  request: CodexServerRequest;
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
  const pendingByInteractionId = new Map<string, PendingRequest>();
  const pendingByRequestId = new Map<string, PendingRequest>();
  let runtimeClient: CodexRuntimeClient | null = null;
  let responseUnsubscribe: (() => void) | null = null;
  let notificationUnsubscribe: (() => void) | null = null;
  let requestUnsubscribe: (() => void) | null = null;

  return {
    async start() {
      runtimeClient = await runtimeClientFactory({
        baseUrl: options.runtimeBaseUrl,
        kind: "codex",
        id: adapterId,
        label: options.runtimeLabel ?? "Codex adapter",
        metadata: {
          transport: "app-server-stdio",
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

      await client.start();
    },
    async close() {
      responseUnsubscribe?.();
      notificationUnsubscribe?.();
      requestUnsubscribe?.();
      responseUnsubscribe = null;
      notificationUnsubscribe = null;
      requestUnsubscribe = null;
      pendingByInteractionId.clear();
      pendingByRequestId.clear();
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

  async function handleServerRequest(request: CodexServerRequest): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    const mapped = mapCodexServerRequest(request, mappingContext);
    if (!mapped) {
      client.respondError(request.id, {
        code: -32601,
        message: `Unsupported Codex server request: ${request.method}`,
      });
      return;
    }
    pendingByInteractionId.set(mapped.interactionId, {
      interactionId: mapped.interactionId,
      request,
    });
    pendingByRequestId.set(String(request.id), {
      interactionId: mapped.interactionId,
      request,
    });
    await runtimeClient.publishSourceEventBatch(mapped.events);
  }

  async function handleNotification(notification: CodexServerNotification): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    if (notification.method === "serverRequest/resolved") {
      const pending = pendingByRequestId.get(String(notification.params.requestId));
      if (pending) {
        pendingByRequestId.delete(String(notification.params.requestId));
        pendingByInteractionId.delete(pending.interactionId);
      }
      return;
    }

    const events = mapCodexNotification(notification, mappingContext);
    if (events.length === 0) {
      return;
    }
    await runtimeClient.publishSourceEventBatch(events);
  }

  async function handleRuntimeResponse(response: AttentionResponse): Promise<void> {
    const pending = pendingByInteractionId.get(response.interactionId);
    if (!pending) {
      return;
    }
    const payload = mapCodexResponse(response, pending.request);
    if (!payload) {
      return;
    }
    pendingByInteractionId.delete(response.interactionId);
    pendingByRequestId.delete(String(pending.request.id));
    client.respond(pending.request.id as JsonRpcId, payload);
  }
}
