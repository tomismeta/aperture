import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AttentionResponse, AttentionView, SourceEvent } from "@tomismeta/aperture-core";

import {
  codexHookTurnTaskId,
  mapCodexHookEvent,
  mapCodexHookResponse,
  parseCodexHookEvent,
  type CodexHookEvent,
  type CodexHookMappingContext,
  type CodexHookResponse,
  type CodexPreToolUseHookEvent,
} from "./hooks.js";

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
  onPreToolUseFallback?: (
    event: CodexPreToolUseHookEvent,
    reason: "timed_out" | "not_held",
  ) => void;
};

export type CodexHookServer = {
  listen(): Promise<{ host: string; port: number; path: string; url: string }>;
  close(): Promise<void>;
};

type PendingDecision = {
  taskId: string;
  interactionId: string;
  response: ServerResponse<IncomingMessage>;
  timeout: NodeJS.Timeout;
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
  const pending = new Map<string, PendingDecision>();

  const unsubscribe = hostClient.onResponse((response) => {
    const key = pendingKey(response.taskId, response.interactionId);
    const decision = pending.get(key);
    if (!decision) {
      return;
    }

    clearTimeout(decision.timeout);
    pending.delete(key);

    const mapped = mapCodexHookResponse(response);
    if (!mapped) {
      writeEmpty(decision.response, 204);
      return;
    }

    writeJson(decision.response, 200, mapped);
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
        await handlePreToolUse(event, res);
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
      for (const decision of pending.values()) {
        clearTimeout(decision.timeout);
        writeJson(decision.response, 200, denyBody("Codex hook server stopped before the approval completed."));
      }
      pending.clear();
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

  async function handlePreToolUse(
    event: CodexPreToolUseHookEvent,
    res: ServerResponse<IncomingMessage>,
  ): Promise<void> {
    const mapped = mapCodexHookEvent(event, options);
    const firstMappedEvent = mapped[0];
    if (!firstMappedEvent || firstMappedEvent.type !== "human.input.requested") {
      writeEmpty(res, 204);
      return;
    }

    const policy = options.preToolUsePolicy?.(event, firstMappedEvent) ?? "allow";
    if (policy === "allow") {
      writeEmpty(res, 204);
      return;
    }

    const key = pendingKey(firstMappedEvent.taskId, firstMappedEvent.interactionId);
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      pending.delete(key);
      options.onPreToolUseFallback?.(event, "timed_out");
      void hostClient.submit?.({
        taskId: firstMappedEvent.taskId,
        interactionId: firstMappedEvent.interactionId,
        response: {
          kind: "rejected",
          reason: "Codex command approval timed out in Aperture.",
        },
      });
      writeJson(res, 200, denyBody("Codex command approval timed out in Aperture."));
    }, holdTimeoutMs);

    pending.set(key, {
      taskId: firstMappedEvent.taskId,
      interactionId: firstMappedEvent.interactionId,
      response: res,
      timeout,
    });

    try {
      await hostClient.publishSourceEvent(firstMappedEvent);
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(key);
      throw error;
    }

    if (res.writableEnded) {
      return;
    }

    if (!hasInteraction(hostClient.getAttentionView(), firstMappedEvent.taskId, firstMappedEvent.interactionId)) {
      clearTimeout(timeout);
      pending.delete(key);
      options.onPreToolUseFallback?.(event, "not_held");
      void hostClient.submit?.({
        taskId: firstMappedEvent.taskId,
        interactionId: firstMappedEvent.interactionId,
        response: {
          kind: "rejected",
          reason: "Aperture did not retain the Codex command approval.",
        },
      });
      writeJson(res, 200, denyBody("Aperture did not retain the Codex command approval."));
    }
  }
}

export function codexHookFallbackEvent(
  event: CodexPreToolUseHookEvent,
  reason: "timed_out" | "not_held",
  context: CodexHookMappingContext = {},
): SourceEvent {
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:preToolUse:${encodeURIComponent(event.tool_use_id)}:fallback:${reason}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: {
      id: `codex:hook:${event.session_id}`,
      kind: "codex",
      ...(context.sourceLabel ? { label: context.sourceLabel } : {}),
    },
    toolFamily: "bash",
    activityClass: "permission_request",
    title:
      reason === "timed_out"
        ? "Codex command approval timed out"
        : "Codex command approval auto-denied",
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a response in time and denied the command."
        : "Aperture did not retain the approval frame and denied the command to fail closed.",
    status: "blocked",
  };
}

function denyBody(reason: string): CodexHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function pendingKey(taskId: string, interactionId: string): string {
  return `${taskId}::${interactionId}`;
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

function hasInteraction(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
): boolean {
  return (
    (attentionView.active?.taskId === taskId && attentionView.active.interactionId === interactionId) ||
    attentionView.queued.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId) ||
    attentionView.ambient.some((frame) => frame.taskId === taskId && frame.interactionId === interactionId)
  );
}
