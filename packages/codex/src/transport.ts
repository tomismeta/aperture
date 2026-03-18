import type {
  CodexJsonRpcError,
  CodexJsonRpcNotification,
  CodexJsonRpcRequest,
  CodexRawServerNotification,
  CodexRawServerRequest,
  JsonRpcId,
} from "./protocol.js";

export type CodexNotificationListener = (notification: CodexRawServerNotification) => void;
export type CodexRequestListener = (request: CodexRawServerRequest) => void;
export type CodexExitListener = (error: Error) => void;
export type CodexStderrListener = (line: string) => void;

// The adapter depends on this transport seam, not on a particular Codex
// launch mechanism. Stdio is the default implementation, and alternate
// transports such as shared or remote websocket sessions use the same contract.
export type CodexTransport = {
  start(): Promise<void>;
  onNotification(listener: CodexNotificationListener): () => void;
  onServerRequest(listener: CodexRequestListener): () => void;
  onExit(listener: CodexExitListener): () => void;
  onStderr(listener: CodexStderrListener): () => void;
  request<TResult, TParams = unknown>(
    request: CodexJsonRpcRequest<string, TParams>,
  ): Promise<TResult>;
  notify<TParams = unknown>(notification: CodexJsonRpcNotification<string, TParams>): void;
  respond<TResult = unknown>(id: JsonRpcId, result: TResult): void;
  respondError(id: JsonRpcId | null, error: CodexJsonRpcError["error"]): void;
  close(): Promise<void>;
};
