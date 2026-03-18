import WebSocket from "ws";

import type {
  CodexJsonRpcError,
  CodexJsonRpcNotification,
  CodexJsonRpcRequest,
  CodexJsonRpcSuccess,
  CodexRawServerNotification,
  CodexRawServerRequest,
  JsonRpcId,
} from "./protocol.js";
import {
  isCodexJsonRpcError,
  isCodexJsonRpcSuccess,
  isCodexServerNotification,
  isCodexServerRequest,
} from "./protocol.js";
import type {
  CodexExitListener,
  CodexNotificationListener,
  CodexRequestListener,
  CodexStderrListener,
  CodexTransport,
} from "./transport.js";

export type CodexAppServerWebSocketOptions = {
  url: string;
  headers?: Record<string, string>;
  origin?: string;
  protocols?: string | string[];
  handshakeTimeoutMs?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerWebSocket implements CodexTransport {
  private readonly url: string;
  private readonly headers: Record<string, string> | undefined;
  private readonly origin: string | undefined;
  private readonly protocols: string | string[] | undefined;
  private readonly handshakeTimeoutMs: number | undefined;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<CodexNotificationListener>();
  private readonly requestListeners = new Set<CodexRequestListener>();
  private readonly exitListeners = new Set<CodexExitListener>();
  private readonly stderrListeners = new Set<CodexStderrListener>();
  private closed = false;

  constructor(options: CodexAppServerWebSocketOptions) {
    this.url = options.url;
    this.headers = options.headers;
    this.origin = options.origin;
    this.protocols = options.protocols;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs;
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }

    this.closed = false;
    const socket = this.protocols
      ? new WebSocket(this.url, this.protocols, this.createSocketOptions())
      : new WebSocket(this.url, this.createSocketOptions());
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off("open", handleOpen);
        socket.off("error", handleError);
      };
      socket.once("open", handleOpen);
      socket.once("error", handleError);
    });

    socket.on("message", (data) => {
      this.handleMessage(this.toMessageText(data));
    });
    socket.on("close", (code, reason) => {
      this.handleDisconnect(this.formatCloseError(code, reason));
    });
    socket.on("error", (error) => {
      this.handleDisconnect(error instanceof Error ? error : new Error(String(error)));
    });
  }

  onNotification(listener: CodexNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onServerRequest(listener: CodexRequestListener): () => void {
    this.requestListeners.add(listener);
    return () => {
      this.requestListeners.delete(listener);
    };
  }

  onExit(listener: CodexExitListener): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  onStderr(listener: CodexStderrListener): () => void {
    this.stderrListeners.add(listener);
    return () => {
      this.stderrListeners.delete(listener);
    };
  }

  request<TResult, TParams = unknown>(
    request: CodexJsonRpcRequest<string, TParams>,
  ): Promise<TResult> {
    this.ensureStarted();
    this.write(request);
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });
  }

  notify<TParams = unknown>(notification: CodexJsonRpcNotification<string, TParams>): void {
    this.ensureStarted();
    this.write(notification);
  }

  respond<TResult = unknown>(id: JsonRpcId, result: TResult): void {
    this.ensureStarted();
    this.write({ id, result });
  }

  respondError(id: JsonRpcId | null, error: CodexJsonRpcError["error"]): void {
    this.ensureStarted();
    this.write({ id, error });
  }

  async close(): Promise<void> {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.failPending(new Error("Codex App Server transport closed"));
    if (!socket) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      socket.once("close", finish);
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      } else {
        finish();
      }
      setTimeout(finish, 5_000);
    });
  }

  private createSocketOptions(): {
    headers?: Record<string, string>;
    origin?: string;
    handshakeTimeout?: number;
  } {
    return {
      ...(this.headers ? { headers: this.headers } : {}),
      ...(this.origin ? { origin: this.origin } : {}),
      ...(this.handshakeTimeoutMs ? { handshakeTimeout: this.handshakeTimeoutMs } : {}),
    };
  }

  private ensureStarted(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex App Server transport is not started");
    }
  }

  private write(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload));
  }

  private handleMessage(line: string): void {
    if (line.trim() === "") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (isCodexJsonRpcSuccess(payload)) {
      this.resolvePending(payload);
      return;
    }

    if (isCodexJsonRpcError(payload)) {
      this.rejectPending(payload);
      return;
    }

    if (isCodexServerRequest(payload)) {
      for (const listener of this.requestListeners) {
        listener(payload);
      }
      return;
    }

    if (isCodexServerNotification(payload)) {
      for (const listener of this.notificationListeners) {
        listener(payload);
      }
    }
  }

  private resolvePending(payload: CodexJsonRpcSuccess): void {
    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    this.pending.delete(payload.id);
    pending.resolve(payload.result);
  }

  private rejectPending(payload: CodexJsonRpcError): void {
    if (payload.id === null) {
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    this.pending.delete(payload.id);
    pending.reject(new Error(payload.error.message));
  }

  private failPending(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleDisconnect(error: Error): void {
    this.failPending(error);
    this.socket = null;
    if (this.closed) {
      return;
    }
    for (const listener of this.exitListeners) {
      listener(error);
    }
  }

  private formatCloseError(code: number, reason: Buffer): Error {
    const reasonText = reason.length > 0 ? ` (${reason.toString("utf8")})` : "";
    return new Error(`Codex App Server websocket closed with code ${code}${reasonText}`);
  }

  private toMessageText(data: WebSocket.RawData): string {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString("utf8");
    }
    return data.toString("utf8");
  }
}
