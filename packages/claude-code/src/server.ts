import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ApertureCore, type FrameResponse } from "@aperture/core";

import {
  mapClaudeCodeFrameResponse,
  mapClaudeCodeHookEvent,
  type ClaudeCodeHookEvent,
  type ClaudeCodeHookResponse,
  type ClaudeCodeMappingOptions,
} from "./index.js";

export type ClaudeCodeHookServerOptions = ClaudeCodeMappingOptions & {
  host?: string;
  path?: string;
  port?: number;
  holdTimeoutMs?: number;
  bodyLimitBytes?: number;
};

export type ClaudeCodeHookServer = {
  listen(): Promise<{ host: string; port: number; path: string; url: string }>;
  close(): Promise<void>;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/hook";
const DEFAULT_HOLD_TIMEOUT_MS = 55_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

type PendingDecision = {
  taskId: string;
  interactionId: string;
  response: ServerResponse<IncomingMessage>;
  timeout: NodeJS.Timeout;
};

export function createClaudeCodeHookServer(
  core: ApertureCore,
  options: ClaudeCodeHookServerOptions = {},
): ClaudeCodeHookServer {
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;
  const port = options.port ?? 0;
  const holdTimeoutMs = options.holdTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS;
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const pending = new Map<string, PendingDecision>();

  const unsubscribe = core.onResponse((response) => {
    const key = pendingKey(response);
    const decision = pending.get(key);
    if (!decision) {
      return;
    }

    const mapped = mapClaudeCodeFrameResponse(response);
    if (!mapped) {
      return;
    }

    clearTimeout(decision.timeout);
    pending.delete(key);
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

      const event = await readHookEvent(req, bodyLimitBytes);
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

        const published = core.publish(firstMappedEvent);
        if (!published) {
          writeJson(res, 200, askResponse());
          return;
        }

        const key = pendingKey({
          taskId: published.taskId,
          interactionId: published.interactionId,
        });
        const timeout = setTimeout(() => {
          core.submit({
            taskId: published.taskId,
            interactionId: published.interactionId,
            response: { kind: "dismissed" },
          });
        }, holdTimeoutMs);

        pending.set(key, {
          taskId: published.taskId,
          interactionId: published.interactionId,
          response: res,
          timeout,
        });
        return;
      }

      for (const apertureEvent of mapped) {
        core.publish(apertureEvent);
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
      for (const decision of pending.values()) {
        clearTimeout(decision.timeout);
        if (!decision.response.writableEnded) {
          writeJson(decision.response, 200, askResponse());
        }
      }
      pending.clear();
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
}

function pendingKey(response: Pick<FrameResponse, "taskId" | "interactionId">): string {
  return `${response.taskId}::${response.interactionId}`;
}

function askResponse(): ClaudeCodeHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    },
  };
}

async function readHookEvent(
  req: IncomingMessage,
  bodyLimitBytes: number,
): Promise<ClaudeCodeHookEvent> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > bodyLimitBytes) {
      throw new Error(`Claude Code hook request exceeded ${bodyLimitBytes} bytes`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new Error("Claude Code hook request body is empty");
  }

  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Claude Code hook request must be a JSON object");
  }

  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.cwd !== "string" ||
    typeof parsed.hook_event_name !== "string"
  ) {
    throw new Error("Claude Code hook request is missing required fields");
  }

  if (
    parsed.hook_event_name !== "PreToolUse" &&
    parsed.hook_event_name !== "PostToolUse" &&
    parsed.hook_event_name !== "PostToolUseFailure"
  ) {
    throw new Error(`Unsupported Claude Code hook event: ${parsed.hook_event_name}`);
  }

  if (
    (parsed.hook_event_name === "PreToolUse" || parsed.hook_event_name === "PostToolUseFailure" || parsed.hook_event_name === "PostToolUse") &&
    (typeof parsed.tool_name !== "string" || typeof parsed.tool_use_id !== "string")
  ) {
    throw new Error(`${parsed.hook_event_name} hook request is missing tool fields`);
  }

  const toolName = parsed["tool_name"] as string;
  const toolUseId = parsed["tool_use_id"] as string;

  if (parsed.hook_event_name === "PreToolUse") {
    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PreToolUse",
      ...(typeof parsed["permission_mode"] === "string" ? { permission_mode: parsed["permission_mode"] } : {}),
      ...(typeof parsed["transcript_path"] === "string" ? { transcript_path: parsed["transcript_path"] } : {}),
      tool_name: toolName,
      tool_use_id: toolUseId,
      tool_input:
        parsed["tool_input"] && typeof parsed["tool_input"] === "object"
          ? (parsed["tool_input"] as Record<string, unknown>)
          : {},
    };
  }

  if (parsed.hook_event_name === "PostToolUseFailure") {
    if (typeof parsed.error !== "string") {
      throw new Error("PostToolUseFailure hook request is missing an error");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PostToolUseFailure",
      ...(typeof parsed["permission_mode"] === "string" ? { permission_mode: parsed["permission_mode"] } : {}),
      ...(typeof parsed["transcript_path"] === "string" ? { transcript_path: parsed["transcript_path"] } : {}),
      tool_name: toolName,
      tool_use_id: toolUseId,
      ...(parsed["tool_input"] && typeof parsed["tool_input"] === "object"
        ? { tool_input: parsed["tool_input"] as Record<string, unknown> }
        : {}),
      error: parsed["error"],
    };
  }

  return {
    session_id: parsed.session_id,
    cwd: parsed.cwd,
    hook_event_name: "PostToolUse",
    ...(typeof parsed["permission_mode"] === "string" ? { permission_mode: parsed["permission_mode"] } : {}),
    ...(typeof parsed["transcript_path"] === "string" ? { transcript_path: parsed["transcript_path"] } : {}),
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(parsed["tool_input"] && typeof parsed["tool_input"] === "object"
      ? { tool_input: parsed["tool_input"] as Record<string, unknown> }
      : {}),
    ...(parsed["tool_response"] && typeof parsed["tool_response"] === "object"
      ? { tool_response: parsed["tool_response"] as Record<string, unknown> }
      : {}),
  };
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: ClaudeCodeHookResponse | Record<string, unknown>,
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
