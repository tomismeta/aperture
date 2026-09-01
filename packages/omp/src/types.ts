export type OmpEvent =
  | OmpSessionStartEvent
  | OmpSessionStopEvent
  | OmpSessionShutdownEvent
  | OmpBeforeAgentStartEvent
  | OmpAgentStartEvent
  | OmpAgentEndEvent
  | OmpTurnStartEvent
  | OmpTurnEndEvent
  | OmpToolCallEvent
  | OmpToolExecutionStartEvent
  | OmpToolExecutionUpdateEvent
  | OmpToolExecutionEndEvent
  | OmpToolResultEvent
  | OmpToolApprovalRequestedEvent
  | OmpToolApprovalResolvedEvent
  | OmpInputEvent
  | OmpCredentialDisabledEvent;

export type OmpSessionStartEvent = { type: "session_start" };

export type OmpSessionStopEvent = {
  type: "session_stop";
  messages?: unknown[];
  turn_id: number;
  session_id: string;
  session_file?: string;
  last_assistant_message?: unknown;
};
export type OmpSessionShutdownEvent = { type: "session_shutdown" };

export type OmpBeforeAgentStartEvent = {
  type: "before_agent_start";
  prompt?: string;
  systemPrompt?: string;
};

export type OmpAgentStartEvent = { type: "agent_start" };

export type OmpAgentEndEvent = {
  type: "agent_end";
  messages?: unknown[];
  willContinue?: boolean;
};

export type OmpTurnStartEvent = {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
};

export type OmpTurnEndEvent = {
  type: "turn_end";
  turnIndex: number;
  message?: unknown;
  toolResults?: unknown[];
};

export type OmpToolCallEvent = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
};

export type OmpToolExecutionStartEvent = {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  intent?: string;
};

export type OmpToolExecutionUpdateEvent = {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  partialResult?: unknown;
};

export type OmpToolExecutionEndEvent = {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result?: unknown;
  isError: boolean;
};

export type OmpToolResultEvent = {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  content?: unknown[];
  details?: unknown;
  isError: boolean;
};

export type OmpToolApprovalRequestedEvent = {
  type: "tool_approval_requested";
  sessionId: string;
  toolCallId: string;
  toolName: string;
  reason?: string;
  approvalMode: string;
};

export type OmpToolApprovalResolvedEvent = {
  type: "tool_approval_resolved";
  sessionId: string;
  toolCallId: string;
  toolName: string;
  approved: boolean;
  reason?: string;
};

export type OmpInputEvent = {
  type: "input";
  text: string;
  source: "interactive" | "rpc" | "extension";
};

export type OmpCredentialDisabledEvent = {
  type: "credential_disabled";
  provider: string;
  disabledCause: string;
};

export type OmpMappingContext = {
  cwd?: string;
  sessionId?: string;
  sessionFile?: string;
  sourceLabel?: string;
  now?: () => string;
};

export type OmpExtensionContext = {
  cwd?: string;
  sessionManager?: unknown;
  ui?: {
    notify?: (message: string, type?: "info" | "warning" | "error") => void;
  };
};

export type OmpExtensionApi = {
  on(
    event: string,
    handler: (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void,
  ): void;
  logger?: {
    warn?: (message: string, attributes?: Record<string, unknown>) => void;
  };
};
