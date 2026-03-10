import type {
  ApertureEvent,
  ConsequenceLevel,
  FrameResponse,
  HumanInputRequestedEvent,
  TaskUpdatedEvent,
} from "@aperture/core";

export type ClaudeCodeHookEvent =
  | ClaudeCodePreToolUseEvent
  | ClaudeCodePostToolUseFailureEvent
  | ClaudeCodePostToolUseEvent;

export type ClaudeCodeHookEventName =
  | "PreToolUse"
  | "PostToolUseFailure"
  | "PostToolUse";

export type ClaudeCodeHookBaseEvent = {
  session_id: string;
  cwd: string;
  hook_event_name: ClaudeCodeHookEventName;
  permission_mode?: string;
  transcript_path?: string;
};

export type ClaudeCodePreToolUseEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};

export type ClaudeCodePostToolUseFailureEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_use_id: string;
  tool_input?: Record<string, unknown>;
  error: string;
};

export type ClaudeCodePostToolUseEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_use_id: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
};

export type ClaudeCodeHookResponse =
  | {
      hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: "allow" | "deny" | "ask";
        permissionDecisionReason?: string;
      };
    }
  | Record<string, never>;

export type ClaudeCodeMappingOptions = {
  tools?: string[];
  includePostToolUse?: boolean;
};

const DEFAULT_TOOLS = ["Bash"];
const HIGH_CONSEQUENCE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bdocker\s+rm\b/i,
  /\bkill\s+-9\b/i,
  /\bchmod\s+777\b/i,
];

export function mapClaudeCodeHookEvent(
  event: ClaudeCodeHookEvent,
  options: ClaudeCodeMappingOptions = {},
): ApertureEvent[] {
  const tools = options.tools ?? DEFAULT_TOOLS;

  switch (event.hook_event_name) {
    case "PreToolUse":
      return tools.includes(event.tool_name) ? [mapPreToolUse(event)] : [];
    case "PostToolUseFailure":
      return [mapPostToolUseFailure(event)];
    case "PostToolUse":
      return options.includePostToolUse ? [mapPostToolUse(event)] : [];
  }
}

export function mapClaudeCodeFrameResponse(
  response: FrameResponse,
): ClaudeCodeHookResponse | null {
  const parsed = parseClaudeInteractionId(response.interactionId);
  if (!parsed || parsed.kind !== "tool") {
    return null;
  }

  switch (response.response.kind) {
    case "approved":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
    case "rejected":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          ...(response.response.reason
            ? { permissionDecisionReason: response.response.reason }
            : {}),
        },
      };
    case "dismissed":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      };
    case "option_selected":
    case "form_submitted":
      return null;
  }
}

export function bashConsequence(command: string): ConsequenceLevel {
  return HIGH_CONSEQUENCE_PATTERNS.some((pattern) => pattern.test(command))
    ? "high"
    : "medium";
}

function mapPreToolUse(
  event: ClaudeCodePreToolUseEvent,
): HumanInputRequestedEvent {
  const command = readString(event.tool_input.command) ?? event.tool_name;
  const whyNow =
    readString(event.tool_input.description) ??
    `Claude Code requested approval before running ${event.tool_name}.`;

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id, event.tool_use_id),
    interactionId: claudeInteractionId(event.session_id, event.tool_use_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event.session_id),
    title: "Approve Bash command",
    summary: command,
    tone: "focused",
    consequence: bashConsequence(command),
    request: {
      kind: "approval",
    },
    context: {
      items: [
        { id: "command", label: "Command", value: command },
        { id: "cwd", label: "Working directory", value: event.cwd },
      ],
    },
    provenance: {
      whyNow,
    },
  };
}

function mapPostToolUseFailure(
  event: ClaudeCodePostToolUseFailureEvent,
): TaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id, event.tool_use_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event.session_id),
    title: `${event.tool_name} failed`,
    summary: event.error,
    status: "failed",
  };
}

function mapPostToolUse(event: ClaudeCodePostToolUseEvent): TaskUpdatedEvent {
  const summary =
    readString(event.tool_response?.message) ??
    `${event.tool_name} completed successfully.`;

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id, event.tool_use_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event.session_id),
    title: `${event.tool_name} completed`,
    summary,
    status: "running",
  };
}

function parseClaudeInteractionId(
  interactionId: string,
):
  | {
      kind: "tool";
      sessionId: string;
      toolUseId: string;
    }
  | null {
  const parts = interactionId.split(":");
  if (parts.length !== 4) {
    return null;
  }

  if (parts[0] !== "claude-code" || parts[1] !== "tool") {
    return null;
  }

  const sessionIdPart = parts[2];
  const toolUseIdPart = parts[3];
  if (!sessionIdPart || !toolUseIdPart) {
    return null;
  }

  const sessionId = safeDecode(sessionIdPart);
  const toolUseId = safeDecode(toolUseIdPart);
  if (!sessionId || !toolUseId) {
    return null;
  }

  return {
    kind: "tool",
    sessionId,
    toolUseId,
  };
}

function claudeTaskId(sessionId: string, toolUseId: string): string {
  return `claude-code:task:${encodeURIComponent(sessionId)}:${encodeURIComponent(toolUseId)}`;
}

function claudeInteractionId(sessionId: string, toolUseId: string): string {
  return `claude-code:tool:${encodeURIComponent(sessionId)}:${encodeURIComponent(toolUseId)}`;
}

function claudeEventId(
  event: ClaudeCodeHookEvent,
  suffix: string,
): string {
  return `claude-code:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:${encodeURIComponent(event.tool_use_id ?? "none")}:${suffix}`;
}

function claudeSource(sessionId: string) {
  return {
    id: `claude-code:${sessionId}`,
    kind: "claude-code",
    label: "Claude Code",
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
