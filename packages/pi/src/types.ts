export type PiEvent =
  | PiSessionStartEvent
  | PiSessionShutdownEvent
  | PiBeforeAgentStartEvent
  | PiAgentStartEvent
  | PiAgentEndEvent
  | PiTurnStartEvent
  | PiTurnEndEvent
  | PiToolCallEvent
  | PiToolExecutionStartEvent
  | PiToolExecutionUpdateEvent
  | PiToolExecutionEndEvent
  | PiToolResultEvent
  | PiModelSelectEvent
  | PiThinkingLevelSelectEvent
  | PiInputEvent
  | PiUserBashEvent;

export type PiSessionStartEvent = {
  type: "session_start";
  reason?: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
};

export type PiSessionShutdownEvent = {
  type: "session_shutdown";
  reason?: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string;
};

export type PiBeforeAgentStartEvent = {
  type: "before_agent_start";
  prompt?: string;
  systemPrompt?: string;
};

export type PiAgentStartEvent = {
  type: "agent_start";
};

export type PiAgentEndEvent = {
  type: "agent_end";
  messages?: unknown[];
};

export type PiTurnStartEvent = {
  type: "turn_start";
  turnIndex?: number;
  timestamp?: number;
};

export type PiTurnEndEvent = {
  type: "turn_end";
  turnIndex?: number;
  message?: unknown;
  toolResults?: unknown[];
};

export type PiToolCallEvent = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
};

export type PiToolExecutionStartEvent = {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args?: unknown;
};

export type PiToolExecutionUpdateEvent = {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  partialResult?: unknown;
};

export type PiToolExecutionEndEvent = {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

export type PiToolResultEvent = {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
};

export type PiModelSelectEvent = {
  type: "model_select";
  model?: unknown;
  previousModel?: unknown;
  source?: "set" | "cycle" | "restore";
};

export type PiThinkingLevelSelectEvent = {
  type: "thinking_level_select";
  level?: string;
  previousLevel?: string;
};

export type PiInputEvent = {
  type: "input";
  text?: string;
  source?: "interactive" | "rpc" | "extension";
};

export type PiUserBashEvent = {
  type: "user_bash";
  command?: string;
  cwd?: string;
  excludeFromContext?: boolean;
};

export type PiUnknownEvent = {
  type: string;
  [key: string]: unknown;
};

export type PiExtensionContext = {
  cwd?: string;
  hasUI?: boolean;
  isIdle?: () => boolean;
  getContextUsage?: () => unknown;
  model?: unknown;
  sessionManager?: unknown;
  ui?: {
    notify?: (message: string, type?: "info" | "warning" | "error") => void;
    setStatus?: (key: string, text: string | undefined) => void;
  };
};

export type PiExtensionHandlerResult =
  | {
      block?: boolean;
      reason?: string;
    }
  | undefined
  | void;

export type PiExtensionApi = {
  on(
    event: string,
    handler: (
      event: PiEvent,
      context: PiExtensionContext,
    ) => Promise<PiExtensionHandlerResult> | PiExtensionHandlerResult,
  ): void;
};
