import { ApertureRuntimeAdapterClient } from "@aperture/runtime/adapter";
import type { AttentionResponse } from "@tomismeta/aperture-core";

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
  client: OpencodeClientOptions;
};

export type OpencodeBridge = {
  start(): Promise<void>;
  close(): Promise<void>;
};

export function createOpencodeBridge(options: OpencodeBridgeOptions): OpencodeBridge {
  const client = new OpencodeClient(options.client);
  const mappingContext: OpencodeMappingContext = {
    baseUrl: options.client.baseUrl,
    ...(options.client.scope ? { scope: options.client.scope } : {}),
  };
  const adapterId = `opencode-${createOpencodeInstanceKey(mappingContext)}`;
  let runtimeClient: ApertureRuntimeAdapterClient | null = null;
  let streamController: AbortController | null = null;
  let responseUnsubscribe: (() => void) | null = null;
  let streamTask: Promise<void> | null = null;
  const suppressEgress = new Set<string>();

  return {
    async start() {
      runtimeClient = await ApertureRuntimeAdapterClient.connect({
        baseUrl: options.runtimeBaseUrl,
        kind: "opencode",
        id: adapterId,
        label: options.runtimeLabel ?? "OpenCode adapter",
        metadata: {
          baseUrl: options.client.baseUrl,
          ...(options.client.scope?.directory ? { directory: options.client.scope.directory } : {}),
          ...(options.runtimeMetadata ?? {}),
        },
      });

      responseUnsubscribe = runtimeClient.onResponse((response: AttentionResponse) => {
        void handleRuntimeResponse(response);
      });

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

      streamController = new AbortController();
      streamTask = client.consumeEvents(async (event) => {
        const nativeResolution = mapOpencodeNativeResolution(event, mappingContext);
        if (nativeResolution && runtimeClient) {
          suppressEgress.add(nativeResolution.response.interactionId);
          await runtimeClient.submit(nativeResolution.response);
          return;
        }

        const mapped = mapOpencodeEvent(event, mappingContext);
        if (mapped.length > 0 && runtimeClient) {
          await runtimeClient.publishSourceEventBatch(mapped);
        }
      }, { signal: streamController.signal });
    },
    async close() {
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
      suppressEgress.clear();
    },
  };

  async function handleRuntimeResponse(response: AttentionResponse): Promise<void> {
    if (suppressEgress.has(response.interactionId)) {
      suppressEgress.delete(response.interactionId);
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
}
