import {
  type CodexAppServerStdioOptions,
  CodexAppServerStdio,
} from "./stdio.js";
import type {
  CodexClientInfo,
  CodexReviewStartParams,
  CodexReviewStartResult,
  CodexRawServerNotification,
  CodexRawServerRequest,
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

export type CodexAppServerClientOptions = CodexAppServerStdioOptions & {
  clientInfo?: CodexClientInfo;
};

type NotificationListener = (notification: CodexRawServerNotification) => void;
type RequestListener = (request: CodexRawServerRequest) => void;
type ExitListener = (error: Error) => void;
type StderrListener = (line: string) => void;

export class CodexAppServerClient {
  private readonly transport: CodexAppServerStdio;
  private readonly clientInfo: CodexClientInfo;
  private nextId = 1;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.transport = new CodexAppServerStdio(options);
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

  onNotification(listener: NotificationListener): () => void {
    return this.transport.onNotification(listener);
  }

  onServerRequest(listener: RequestListener): () => void {
    return this.transport.onServerRequest(listener);
  }

  onExit(listener: ExitListener): () => void {
    return this.transport.onExit(listener);
  }

  onStderr(listener: StderrListener): () => void {
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
