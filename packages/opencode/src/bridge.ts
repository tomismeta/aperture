import { ApertureRuntimeAdapterClient } from "@aperture/runtime/adapter";
import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";

import { OpencodeClient } from "./client.js";
import {
  createOpencodeInstanceKey,
  mapOpencodeEvent,
  mapOpencodeNativeResolution,
  mapOpencodeResponse,
  parseOpencodeInteractionId,
  type OpencodeMappingContext,
} from "./mapping.js";
import type { OpencodeClientOptions } from "./types.js";

export type OpencodeBridgeOptions = {
  runtimeBaseUrl: string;
  runtimeLabel?: string;
  runtimeMetadata?: Record<string, string>;
  sourceLabel?: string;
  client: OpencodeClientOptions;
  bridgeClient?: OpencodeBridgeClient;
  runtimeClientFactory?: () => Promise<OpencodeRuntimeClient>;
};

export type OpencodeBridge = {
  start(): Promise<void>;
  close(): Promise<void>;
};

export type OpencodeBridgeClient = Pick<
  OpencodeClient,
  | "listPermissions"
  | "listQuestions"
  | "replyToPermission"
  | "replyToQuestion"
  | "rejectQuestion"
  | "streamEvents"
>;

export type OpencodeRuntimeClient = Pick<
  ApertureRuntimeAdapterClient,
  "publishSourceEvent" | "publishSourceEventBatch" | "submit" | "onResponse" | "close"
>;

export function createOpencodeBridge(options: OpencodeBridgeOptions): OpencodeBridge {
  const client = options.bridgeClient ?? new OpencodeClient(options.client);
  const mappingContext: OpencodeMappingContext = {
    baseUrl: options.client.baseUrl,
    ...(options.client.scope ? { scope: options.client.scope } : {}),
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
  };
  const adapterId = `opencode-${createOpencodeInstanceKey(mappingContext)}`;
  const runtimeClientFactory =
    options.runtimeClientFactory
    ?? (() => ApertureRuntimeAdapterClient.connect({
      baseUrl: options.runtimeBaseUrl,
      kind: "opencode",
      id: adapterId,
      label: options.runtimeLabel ?? "OpenCode adapter",
      metadata: {
        baseUrl: options.client.baseUrl,
        ...(options.client.scope?.directory ? { directory: options.client.scope.directory } : {}),
        ...(options.runtimeMetadata ?? {}),
      },
    }));
  let runtimeClient: OpencodeRuntimeClient | null = null;
  let streamController: AbortController | null = null;
  let responseUnsubscribe: (() => void) | null = null;
  let streamTask: Promise<void> | null = null;
  let closed = false;
  const suppressEgress = new Map<string, NodeJS.Timeout>();
  const startupBufferedEvents: Array<{ event: Parameters<typeof mapOpencodeEvent>[0]; receivedAt: string }> = [];
  let bootstrapping = true;

  const reconnectInitialDelayMs = options.client.reconnect?.initialDelayMs ?? 1_000;
  const reconnectMaxDelayMs = options.client.reconnect?.maxDelayMs ?? 10_000;
  const heartbeatTimeoutMs = options.client.reconnect?.heartbeatTimeoutMs ?? 30_000;
  const reconnectMaxAttempts = options.client.reconnect?.maxAttempts ?? Infinity;

  return {
    async start() {
      closed = false;
      runtimeClient = await runtimeClientFactory();

      responseUnsubscribe = runtimeClient.onResponse((response: AttentionResponse) => {
        void handleRuntimeResponse(response).catch((error) => {
          void reportBridgeIssue(response.taskId, "OpenCode reply failed", error).catch((reportError) => {
            console.error("Failed to publish OpenCode bridge issue", reportError);
          });
        });
      });

      streamController = new AbortController();
      streamTask = runEventLoop(streamController.signal);

      const [permissions, questions] = await Promise.all([
        client.listPermissions(),
        client.listQuestions(),
      ]);

      const bootstrapEvents = [
        ...permissions.flatMap((permission) =>
          mapOpencodeEvent({ type: "permission.asked", properties: permission }, mappingContext),
        ),
        ...questions.flatMap((question) =>
          mapOpencodeEvent({ type: "question.asked", properties: question }, mappingContext),
        ),
      ];
      await runtimeClient.publishSourceEventBatch(bootstrapEvents);
      const bootstrapEventIds = new Set(bootstrapEvents.map((event) => event.id));

      bootstrapping = false;
      for (const buffered of startupBufferedEvents.splice(0)) {
        await processEvent(buffered.event, bootstrapEventIds);
      }
    },
    async close() {
      closed = true;
      streamController?.abort();
      streamController = null;
      if (streamTask) {
        await streamTask.catch(() => {});
        streamTask = null;
      }
      responseUnsubscribe?.();
      responseUnsubscribe = null;
      if (runtimeClient) {
        await runtimeClient.close();
        runtimeClient = null;
      }
      for (const timeout of suppressEgress.values()) {
        clearTimeout(timeout);
      }
      suppressEgress.clear();
    },
  };

  async function runEventLoop(signal: AbortSignal): Promise<void> {
    let attempts = 0;
    let delayMs = reconnectInitialDelayMs;

    while (!closed && !signal.aborted) {
      const attemptController = new AbortController();
      const onAbort = () => {
        attemptController.abort();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      let heartbeatTimedOut = false;
      let heartbeatTimer: NodeJS.Timeout | null = null;

      const clearHeartbeatTimer = () => {
        if (heartbeatTimer) {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const resetHeartbeatTimer = () => {
        clearHeartbeatTimer();
        heartbeatTimer = setTimeout(() => {
          heartbeatTimedOut = true;
          attemptController.abort();
        }, heartbeatTimeoutMs);
      };

      try {
        resetHeartbeatTimer();
        for await (const event of client.streamEvents({ signal: attemptController.signal })) {
          resetHeartbeatTimer();
          attempts = 0;
          delayMs = reconnectInitialDelayMs;
          if (bootstrapping) {
            startupBufferedEvents.push({ event, receivedAt: new Date().toISOString() });
            continue;
          }
          await processEvent(event);
        }

        if (closed || signal.aborted) {
          return;
        }
        throw new Error("OpenCode event stream ended");
      } catch (error) {
        if (closed || signal.aborted) {
          return;
        }

        attempts += 1;
        const disconnectError = heartbeatTimedOut
          ? new Error(`OpenCode event stream heartbeat timed out after ${heartbeatTimeoutMs}ms`)
          : error;
        await reportBridgeIssue(undefined, "OpenCode event stream disconnected", disconnectError).catch((reportError) => {
          console.error("Failed to publish OpenCode bridge issue", reportError);
        });
        if (attempts > reconnectMaxAttempts) {
          return;
        }
        await sleep(delayMs);
        delayMs = Math.min(reconnectMaxDelayMs, delayMs * 2);
      } finally {
        clearHeartbeatTimer();
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async function processEvent(
    event: Parameters<typeof mapOpencodeEvent>[0],
    skipEventIds: Set<string> = new Set(),
  ): Promise<void> {
    const nativeResolution = mapOpencodeNativeResolution(event, mappingContext);
    if (nativeResolution && runtimeClient) {
      suppressInteraction(nativeResolution.response.interactionId);
      await runtimeClient.submit(nativeResolution.response);
      return;
    }

    const mapped = mapOpencodeEvent(event, mappingContext).filter((sourceEvent) => !skipEventIds.has(sourceEvent.id));
    if (mapped.length > 0 && runtimeClient) {
      await runtimeClient.publishSourceEventBatch(mapped);
    }
  }

  async function handleRuntimeResponse(response: AttentionResponse): Promise<void> {
    if (suppressEgress.has(response.interactionId)) {
      clearSuppressedInteraction(response.interactionId);
      return;
    }

    if (!parseOpencodeInteractionId(response.interactionId)) {
      return;
    }

    const action = mapOpencodeResponse(response);
    if (!action) {
      return;
    }

    switch (action.kind) {
      case "permission.reply":
        await client.replyToPermission(action.requestId, action.body);
        return;
      case "question.reply":
        await client.replyToQuestion(action.requestId, action.body);
        return;
      case "question.reject":
        await client.rejectQuestion(action.requestId, action.body);
        return;
    }
  }

  function suppressInteraction(interactionId: string): void {
    clearSuppressedInteraction(interactionId);
    suppressEgress.set(
      interactionId,
      setTimeout(() => {
        suppressEgress.delete(interactionId);
      }, 60_000),
    );
  }

  function clearSuppressedInteraction(interactionId: string): void {
    const timeout = suppressEgress.get(interactionId);
    if (timeout) {
      clearTimeout(timeout);
    }
    suppressEgress.delete(interactionId);
  }

  async function reportBridgeIssue(
    taskId: string | undefined,
    title: string,
    error: unknown,
  ): Promise<void> {
    if (!runtimeClient) {
      return;
    }

    const event: SourceEvent = {
      id: `opencode:${createOpencodeInstanceKey(mappingContext)}:bridge:${encodeURIComponent(title)}:${Date.now()}`,
      type: "task.updated",
      taskId: taskId ?? `opencode:${createOpencodeInstanceKey(mappingContext)}:session:bridge`,
      timestamp: new Date().toISOString(),
      source: {
        id: `opencode:${createOpencodeInstanceKey(mappingContext)}`,
        kind: "opencode",
        label: mappingContext.sourceLabel ?? "OpenCode",
      },
      title,
      summary: error instanceof Error ? error.message : String(error),
      status: "waiting",
    };
    await runtimeClient.publishSourceEvent(event);
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
