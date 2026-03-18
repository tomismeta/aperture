import {
  type CodexAppServerStdioOptions,
  CodexAppServerStdio,
} from "./stdio.js";
import {
  type CodexAppServerWebSocketOptions,
  CodexAppServerWebSocket,
} from "./websocket.js";
import type {
  CodexClientInfo,
  CodexReviewStartParams,
  CodexReviewStartResult,
  CodexThreadResumeParams,
  CodexThreadResumeResult,
  CodexThreadStartParams,
  CodexThreadStartResult,
  CodexTurnInterruptParams,
  CodexTurnStartParams,
  CodexTurnStartResult,
  CodexTurnSteerParams,
  CodexTurnSteerResult,
  CodexInitializeResult,
  JsonRpcId,
} from "./protocol.js";
import type {
  CodexExitListener,
  CodexNotificationListener,
  CodexRequestListener,
  CodexStderrListener,
  CodexTransport,
} from "./transport.js";

export type CodexAppServerClientOptions = {
  clientInfo?: CodexClientInfo;
  transport?: CodexTransport;
  transportFactory?: () => CodexTransport;
  transportKind?: "stdio" | "websocket";
  // Used only when the client falls back to the built-in stdio transport.
  stdio?: CodexAppServerStdioOptions;
  // Used only when the client falls back to the built-in websocket transport.
  websocket?: CodexAppServerWebSocketOptions;
};

export class CodexAppServerClient {
  private readonly transport: CodexTransport;
  private readonly clientInfo: CodexClientInfo;
  private nextId = 1;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.transport = options.transport
      ?? options.transportFactory?.()
      ?? createBuiltInTransport(options);
    this.clientInfo = options.clientInfo ?? {
      name: "aperture_codex",
      title: "Aperture Codex Adapter",
      version: "0.0.0",
    };
  }

  async start(): Promise<CodexInitializeResult> {
    await this.transport.start();
    const result = await this.transport.request<CodexInitializeResult>({
      method: "initialize",
      id: this.allocateId(),
      params: {
        clientInfo: this.clientInfo,
        capabilities: null,
      },
    });
    this.transport.notify({
      method: "initialized",
    });
    return result;
  }

  onNotification(listener: CodexNotificationListener): () => void {
    return this.transport.onNotification(listener);
  }

  onServerRequest(listener: CodexRequestListener): () => void {
    return this.transport.onServerRequest(listener);
  }

  onExit(listener: CodexExitListener): () => void {
    return this.transport.onExit(listener);
  }

  onStderr(listener: CodexStderrListener): () => void {
    return this.transport.onStderr(listener);
  }

  async threadStart(params: CodexThreadStartParams = {}): Promise<CodexThreadStartResult> {
    const result = await this.transport.request<{
      thread: CodexThreadStartResult["thread"];
    }>({
      method: "thread/start",
      id: this.allocateId(),
      params: {
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
        ...(params.sandbox ? { sandbox: params.sandbox } : {}),
        ...(params.personality ? { personality: params.personality } : {}),
        ...(params.baseInstructions ? { baseInstructions: params.baseInstructions } : {}),
        ...(params.developerInstructions
          ? { developerInstructions: params.developerInstructions }
          : {}),
        ...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      },
    });
    return { thread: result.thread };
  }

  async threadResume(params: CodexThreadResumeParams): Promise<CodexThreadResumeResult> {
    const result = await this.transport.request<{
      thread: CodexThreadResumeResult["thread"];
    }>({
      method: "thread/resume",
      id: this.allocateId(),
      params,
    });
    return { thread: result.thread };
  }

  async turnStart(params: CodexTurnStartParams): Promise<CodexTurnStartResult> {
    return this.transport.request<CodexTurnStartResult>({
      method: "turn/start",
      id: this.allocateId(),
      params,
    });
  }

  async turnSteer(params: CodexTurnSteerParams): Promise<CodexTurnSteerResult> {
    return this.transport.request<CodexTurnSteerResult>({
      method: "turn/steer",
      id: this.allocateId(),
      params,
    });
  }

  async turnInterrupt(params: CodexTurnInterruptParams): Promise<Record<string, never>> {
    return this.transport.request<Record<string, never>>({
      method: "turn/interrupt",
      id: this.allocateId(),
      params,
    });
  }

  async reviewStart(params: CodexReviewStartParams): Promise<CodexReviewStartResult> {
    return this.transport.request<CodexReviewStartResult>({
      method: "review/start",
      id: this.allocateId(),
      params,
    });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.transport.respond(id, result);
  }

  respondError(id: JsonRpcId | null, error: { code: number; message: string; data?: unknown }): void {
    this.transport.respondError(id, error);
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  private allocateId(): JsonRpcId {
    return this.nextId++;
  }
}

function createBuiltInTransport(options: CodexAppServerClientOptions): CodexTransport {
  const transportKind = options.transportKind ?? (options.websocket ? "websocket" : "stdio");
  if (transportKind === "websocket") {
    if (!options.websocket) {
      throw new Error("Codex websocket transport requires websocket options");
    }
    return new CodexAppServerWebSocket(options.websocket);
  }
  return new CodexAppServerStdio(options.stdio);
}
