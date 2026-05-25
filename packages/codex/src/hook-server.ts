import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AttentionResponse, AttentionView, SourceEvent } from "@tomismeta/aperture-core";
import { HeldRequestCoordinator, type HeldRequestResolution } from "@aperture/runtime/internal";

import {
  mapCodexHookEvent,
  mapCodexHookResponse,
  parseCodexHookEvent,
  type CodexHookMappingContext,
  type CodexHookResponse,
  type CodexPermissionRequestHookEvent,
  type CodexPreToolUseHookEvent,
} from "./hooks.js";
import {
  codexHookDenyBody,
  type CodexHeldApprovalFallback,
  type CodexHeldApprovalPolicy,
  type CodexHeldHookEvent,
} from "./hook-server-support.js";

export type CodexHookServerOptions = CodexHookMappingContext & {
  host?: string;
  path?: string;
  port?: number;
  holdTimeoutMs?: number;
  bodyLimitBytes?: number;
  preToolUsePolicy?: (
    event: CodexPreToolUseHookEvent,
    mappedEvent: Extract<SourceEvent, { type: "human.input.requested" }>,
  ) => "hold" | "allow";
  permissionRequestPolicy?: (
    event: CodexPermissionRequestHookEvent,
    mappedEvent: Extract<SourceEvent, { type: "human.input.requested" }>,
  ) => "hold" | "allow";
  onPreToolUseFallback?: (
    event: CodexPreToolUseHookEvent,
    reason: "timed_out" | "not_held",
  ) => void;
  onPermissionRequestFallback?: (
    event: CodexPermissionRequestHookEvent,
    reason: "timed_out" | "not_held",
  ) => void;
};

export type CodexHookServer = {
  listen(): Promise<{ host: string; port: number; path: string; url: string }>;
  close(): Promise<void>;
};

type CodexHookEventHost = {
  publishSourceEvent(event: SourceEvent): unknown | Promise<unknown>;
  submit?(response: AttentionResponse): unknown | Promise<unknown>;
  getAttentionView(): AttentionView;
  onResponse(listener: (response: AttentionResponse) => void): () => void;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/hook";
const DEFAULT_HOLD_TIMEOUT_MS = 55_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

export function createCodexHookServer(
  hostClient: CodexHookEventHost,
  options: CodexHookServerOptions = {},
): CodexHookServer {
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;
  const port = options.port ?? 0;
  const holdTimeoutMs = options.holdTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS;
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const pending = new HeldRequestCoordinator<CodexHookResponse>({
    writeResolution: (response, resolution) => writeCodexResolution(response, resolution),
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

      const event = parseCodexHookEvent(await readHookBody(req, bodyLimitBytes));
      if (event.hook_event_name === "PreToolUse") {
        await handleHeldApproval(
          event,
          res,
          options.preToolUsePolicy,
          options.onPreToolUseFallback,
          "Codex command approval timed out in Aperture.",
          "Aperture did not retain the Codex command approval.",
        );
        return;
      }

      if (event.hook_event_name === "PermissionRequest") {
        await handleHeldApproval(
          event,
          res,
          options.permissionRequestPolicy,
          options.onPermissionRequestFallback,
          "Codex permission request timed out in Aperture.",
          "Aperture did not retain the Codex permission request.",
        );
        return;
      }

      const mapped = mapCodexHookEvent(event, options);
      for (const apertureEvent of mapped) {
        await hostClient.publishSourceEvent(apertureEvent);
      }
      writeEmpty(res, 204);
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
        throw new Error("Unable to determine Codex hook server address");
      }
      return {
        host,
        port: address.port,
        path,
        url: `http://${host}:${address.port}${path}`,
      };
    },
    async close() {
      unsubscribe();
      pending.close();
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

  async function handleHeldApproval<TEvent extends CodexHeldHookEvent>(
    event: TEvent,
    res: ServerResponse<IncomingMessage>,
    policy: CodexHeldApprovalPolicy<TEvent> | undefined,
    onFallback: CodexHeldApprovalFallback<TEvent> | undefined,
    timeoutReason: string,
    notHeldReason: string,
  ): Promise<void> {
    const mapped = mapCodexHookEvent(event, options);
    const firstMappedEvent = mapped[0];
    if (!firstMappedEvent || firstMappedEvent.type !== "human.input.requested") {
      writeEmpty(res, 204);
      return;
    }

    const decision = policy?.(event, firstMappedEvent) ?? "allow";
    if (decision === "allow") {
      const body = mapCodexHookResponse({
        taskId: firstMappedEvent.taskId,
        interactionId: firstMappedEvent.interactionId,
        response: { kind: "approved" },
      });
      if (body) {
        writeJson(res, 200, body);
      } else {
        writeEmpty(res, 204);
      }
      return;
    }

    pending.hold({
      taskId: firstMappedEvent.taskId,
      interactionId: firstMappedEvent.interactionId,
      response: res,
      timeoutMs: holdTimeoutMs,
      fallback: {
        statusCode: 200,
        body: codexHookDenyBody(event, timeoutReason),
      },
      mapResponse: (response) => {
        const mappedResponse = mapCodexHookResponse(response);
        return mappedResponse ? { statusCode: 200, body: mappedResponse } : { statusCode: 204 };
      },
      onTimeout: () => {
        onFallback?.(event, "timed_out");
        void hostClient.submit?.({
          taskId: firstMappedEvent.taskId,
          interactionId: firstMappedEvent.interactionId,
          response: {
            kind: "rejected",
            reason: timeoutReason,
          },
        });
      },
    });

    try {
      await hostClient.publishSourceEvent(firstMappedEvent);
    } catch (error) {
      pending.cancel(firstMappedEvent.taskId, firstMappedEvent.interactionId);
      throw error;
    }

    if (res.writableEnded) {
      return;
    }

    if (
      !hasInteraction(
        hostClient.getAttentionView(),
        firstMappedEvent.taskId,
        firstMappedEvent.interactionId,
      )
    ) {
      onFallback?.(event, "not_held");
      void hostClient.submit?.({
        taskId: firstMappedEvent.taskId,
        interactionId: firstMappedEvent.interactionId,
        response: {
          kind: "rejected",
          reason: notHeldReason,
        },
      });
      pending.release(firstMappedEvent.taskId, firstMappedEvent.interactionId, {
        statusCode: 200,
        body: codexHookDenyBody(event, notHeldReason),
      });
    }
  }
}

async function readHookBody(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > bodyLimitBytes) {
      throw new Error(`Codex hook body exceeds ${bodyLimitBytes} bytes`);
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as unknown;
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: CodexHookResponse | Record<string, unknown>,
): void {
  if (res.writableEnded) {
    return;
  }

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    Connection: "close",
  });
  res.end(JSON.stringify(body));
}

function writeEmpty(res: ServerResponse<IncomingMessage>, statusCode: number): void {
  if (res.writableEnded) {
    return;
  }

  res.writeHead(statusCode, { Connection: "close" });
  res.end();
}

function writeCodexResolution(
  response: ServerResponse<IncomingMessage>,
  resolution: HeldRequestResolution<CodexHookResponse>,
): void {
  if (resolution.body === undefined) {
    writeEmpty(response, resolution.statusCode);
    return;
  }
  writeJson(response, resolution.statusCode, resolution.body);
}

function hasInteraction(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
): boolean {
  return (
    (attentionView.now?.taskId === taskId && attentionView.now.interactionId === interactionId) ||
    attentionView.next.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    ) ||
    attentionView.ambient.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    )
  );
}
