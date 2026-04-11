import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AttentionResponse, AttentionView, SourceEvent } from "@tomismeta/aperture-core";
import { HeldRequestCoordinator, type HeldRequestResolution } from "@aperture/runtime/internal";

import {
  mapClaudeCodeAskUserQuestionResponse,
  mapClaudeCodeFrameResponse,
  mapClaudeCodeHookEvent,
  type ClaudeCodeElicitationEvent,
  type ClaudeCodeElicitationMappedEvent,
  type ClaudeCodeHookResponse,
  type ClaudeCodeMappingOptions,
  type ClaudeCodePermissionRequestEvent,
  type ClaudeCodePermissionRequestMappedEvent,
  type ClaudeCodePreToolUseEvent,
  type ClaudeCodePreToolUseMappedEvent,
} from "./mapping.js";
import { readHookEvent } from "./server-hook-event.js";
import { enrichHookEvent, hasInteraction, writeJson } from "./server-support.js";

export type ClaudeCodeHookServerOptions = ClaudeCodeMappingOptions & {
  host?: string;
  path?: string;
  port?: number;
  holdTimeoutMs?: number;
  bodyLimitBytes?: number;
  transcriptRoots?: string[];
  transcriptMaxBytes?: number;
  preToolUsePolicy?: (
    event: ClaudeCodePreToolUseEvent,
    mappedEvent: ClaudeCodePreToolUseMappedEvent,
  ) => "hold" | "ask";
  permissionRequestPolicy?: (
    event: ClaudeCodePermissionRequestEvent,
    mappedEvent: ClaudeCodePermissionRequestMappedEvent,
  ) => "hold" | "native";
  elicitationPolicy?: (
    event: ClaudeCodeElicitationEvent,
    mappedEvent: ClaudeCodeElicitationMappedEvent,
  ) => "hold" | "native";
  onPreToolUseFallback?: (
    event: ClaudeCodePreToolUseEvent,
    reason: "no_surface" | "not_held" | "timed_out",
  ) => void;
  onPermissionRequestFallback?: (
    event: ClaudeCodePermissionRequestEvent,
    reason: "no_surface" | "not_held" | "timed_out",
  ) => void;
  onElicitationFallback?: (
    event: ClaudeCodeElicitationEvent,
    reason: "no_surface" | "not_held" | "timed_out",
  ) => void;
};

export type ClaudeCodeHookServer = {
  listen(): Promise<{ host: string; port: number; path: string; url: string }>;
  close(): Promise<void>;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/hook";
const DEFAULT_HOLD_TIMEOUT_MS = 55_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

type ClaudeCodeEventHost = {
  publishSourceEvent(event: SourceEvent): unknown | Promise<unknown>;
  submit(response: AttentionResponse): unknown | Promise<unknown>;
  getAttentionView(): AttentionView;
  onResponse(listener: (response: AttentionResponse) => void): () => void;
};

export function createClaudeCodeHookServer(
  hostClient: ClaudeCodeEventHost,
  options: ClaudeCodeHookServerOptions = {},
): ClaudeCodeHookServer {
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;
  const port = options.port ?? 0;
  const holdTimeoutMs = options.holdTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS;
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const pending = new HeldRequestCoordinator<ClaudeCodeHookResponse>({
    writeResolution: (response, resolution) => writeClaudeResolution(response, resolution),
  });

  const unsubscribe = hostClient.onResponse((response) => {
    pending.resolve(response);
  });

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || !req.url) {
        writeJson(res, 404, { error: "not found" });
        return;
      }

      const url = new URL(req.url, `http://${host}`);
      if (url.pathname !== path) {
        writeJson(res, 404, { error: "not found" });
        return;
      }

      const event = await enrichHookEvent(await readHookEvent(req, bodyLimitBytes), {
        ...(options.transcriptRoots !== undefined ? { allowedRoots: options.transcriptRoots } : {}),
        ...(options.transcriptMaxBytes !== undefined
          ? { maxBytes: options.transcriptMaxBytes }
          : {}),
      });
      const mapped = mapClaudeCodeHookEvent(event, {
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.includePostToolUse !== undefined
          ? { includePostToolUse: options.includePostToolUse }
          : {}),
      });

      if (event.hook_event_name === "PreToolUse") {
        if (mapped.length === 0) {
          writeJson(res, 200, askResponse());
          return;
        }

        const firstMappedEvent = mapped[0];
        if (!firstMappedEvent) {
          writeJson(res, 200, askResponse());
          return;
        }
        if (firstMappedEvent.type !== "human.input.requested") {
          writeJson(res, 200, askResponse());
          return;
        }

        const preToolUsePolicy = options.preToolUsePolicy?.(event, firstMappedEvent);
        if (preToolUsePolicy === "ask") {
          options.onPreToolUseFallback?.(event, "no_surface");
          writeJson(res, 200, askResponse());
          return;
        }
        await holdClaudeRequest({
          event,
          mappedEvent: firstMappedEvent,
          response: res,
          fallback: askResponse(),
          ...(options.onPreToolUseFallback ? { onFallback: options.onPreToolUseFallback } : {}),
          ...(event.tool_name === "AskUserQuestion" && event.askUserQuestion
            ? {
                mapResponse: (response: AttentionResponse) =>
                  mapClaudeCodeAskUserQuestionResponse(response, event.askUserQuestion!),
              }
            : {}),
        });
        return;
      }

      if (event.hook_event_name === "PermissionRequest") {
        const firstMappedEvent = mapped[0];
        if (!firstMappedEvent || firstMappedEvent.type !== "human.input.requested") {
          writeJson(res, 200, {});
          return;
        }

        const permissionRequestPolicy = options.permissionRequestPolicy?.(event, firstMappedEvent);
        if (permissionRequestPolicy === "native") {
          options.onPermissionRequestFallback?.(event, "no_surface");
          writeJson(res, 200, {});
          return;
        }
        await holdClaudeRequest({
          event,
          mappedEvent: firstMappedEvent,
          response: res,
          fallback: {},
          ...(options.onPermissionRequestFallback
            ? { onFallback: options.onPermissionRequestFallback }
            : {}),
        });
        return;
      }

      if (event.hook_event_name === "Elicitation") {
        const firstMappedEvent = mapped[0];
        if (!firstMappedEvent || firstMappedEvent.type !== "human.input.requested") {
          writeJson(res, 200, {});
          return;
        }

        const elicitationPolicy = options.elicitationPolicy?.(event, firstMappedEvent);
        if (elicitationPolicy === "native") {
          options.onElicitationFallback?.(event, "no_surface");
          writeJson(res, 200, {});
          return;
        }
        await holdClaudeRequest({
          event,
          mappedEvent: firstMappedEvent,
          response: res,
          fallback: {},
          ...(options.onElicitationFallback ? { onFallback: options.onElicitationFallback } : {}),
        });
        return;
      }

      for (const apertureEvent of mapped) {
        await hostClient.publishSourceEvent(apertureEvent);
      }

      writeJson(res, 200, {});
    } catch (error) {
      writeJson(res, 400, {
        error: error instanceof Error ? error.message : "invalid request",
      });
    }
  });

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Claude Code hook server did not bind to a TCP address");
      }

      return {
        host,
        port: address.port,
        path,
        url: `http://${host}:${address.port}${path}`,
      };
    },
    async close() {
      pending.close();
      unsubscribe();
      if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
      if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };

  async function holdClaudeRequest<
    TEvent extends
      | ClaudeCodePreToolUseEvent
      | ClaudeCodePermissionRequestEvent
      | ClaudeCodeElicitationEvent,
  >(request: {
    event: TEvent;
    mappedEvent:
      | ClaudeCodePreToolUseMappedEvent
      | ClaudeCodePermissionRequestMappedEvent
      | ClaudeCodeElicitationMappedEvent;
    response: ServerResponse<IncomingMessage>;
    fallback: ClaudeCodeHookResponse;
    onFallback?: (event: TEvent, reason: "no_surface" | "not_held" | "timed_out") => void;
    mapResponse?: (response: AttentionResponse) => ClaudeCodeHookResponse | null;
  }): Promise<void> {
    pending.hold({
      taskId: request.mappedEvent.taskId,
      interactionId: request.mappedEvent.interactionId,
      response: request.response,
      timeoutMs: holdTimeoutMs,
      fallback: { statusCode: 200, body: request.fallback },
      mapResponse: (response) => {
        const mapped = (request.mapResponse ?? mapClaudeCodeFrameResponse)(response);
        return mapped ? { statusCode: 200, body: mapped } : null;
      },
      onTimeout: () => {
        request.onFallback?.(request.event, "timed_out");
        void hostClient.submit({
          taskId: request.mappedEvent.taskId,
          interactionId: request.mappedEvent.interactionId,
          response: { kind: "dismissed" },
        });
      },
    });

    try {
      await hostClient.publishSourceEvent(request.mappedEvent);
    } catch (error) {
      pending.cancel(request.mappedEvent.taskId, request.mappedEvent.interactionId);
      throw error;
    }
    if (request.response.writableEnded) {
      return;
    }
    if (
      !hasInteraction(
        hostClient.getAttentionView(),
        request.mappedEvent.taskId,
        request.mappedEvent.interactionId,
      )
    ) {
      request.onFallback?.(request.event, "not_held");
      pending.release(request.mappedEvent.taskId, request.mappedEvent.interactionId);
    }
  }
}

function askResponse(): ClaudeCodeHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    },
  };
}

function writeClaudeResolution(
  response: ServerResponse<IncomingMessage>,
  resolution: HeldRequestResolution<ClaudeCodeHookResponse>,
): void {
  writeJson(response, resolution.statusCode, resolution.body ?? {});
}
