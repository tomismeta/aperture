import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

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

export type CodexAppServerStdioOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerStdio implements CodexTransport {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadlineInterface | null = null;
  private stderrReader: ReadlineInterface | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<CodexNotificationListener>();
  private readonly requestListeners = new Set<CodexRequestListener>();
  private readonly exitListeners = new Set<CodexExitListener>();
  private readonly stderrListeners = new Set<CodexStderrListener>();
  private closed = false;

  constructor(options: CodexAppServerStdioOptions = {}) {
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server", "--listen", "stdio://"];
    this.cwd = options.cwd;
    this.env = options.env;
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.closed = false;

    this.child.on("exit", (code, signal) => {
      const reason = new Error(
        `Codex App Server exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}`,
      );
      this.handleDisconnect(reason);
    });

    this.child.on("error", (error) => {
      this.handleDisconnect(error instanceof Error ? error : new Error(String(error)));
    });

    this.stdoutReader = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.stdoutReader.on("line", (line) => {
      this.handleLine(line);
    });

    this.stderrReader = createInterface({
      input: this.child.stderr,
      crlfDelay: Infinity,
    });
    this.stderrReader.on("line", (line) => {
      for (const listener of this.stderrListeners) {
        listener(line);
      }
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
    this.stdoutReader?.close();
    this.stdoutReader = null;
    this.stderrReader?.close();
    this.stderrReader = null;
    const child = this.child;
    this.child = null;
    this.failPending(new Error("Codex App Server transport closed"));
    if (!child) {
      return;
    }
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 100);
    });
  }

  private ensureStarted(): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex App Server transport is not started");
    }
  }

  private write(payload: unknown): void {
    const line = `${JSON.stringify(payload)}\n`;
    this.child?.stdin.write(line);
  }

  private handleLine(line: string): void {
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
    this.child = null;
    this.stdoutReader?.close();
    this.stdoutReader = null;
    this.stderrReader?.close();
    this.stderrReader = null;
    if (this.closed) {
      return;
    }
    for (const listener of this.exitListeners) {
      listener(error);
    }
  }
}
