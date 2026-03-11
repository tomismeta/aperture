import { basename } from "node:path";

import type {
  ConformedEvent,
  ConformedHumanInputRequestedEvent,
  ConformedTaskCompletedEvent,
  ConformedTaskUpdatedEvent,
  ConsequenceLevel,
  FrameResponse,
} from "@aperture/core";

export type ClaudeCodeHookEvent =
  | ClaudeCodePreToolUseEvent
  | ClaudeCodePostToolUseFailureEvent
  | ClaudeCodePostToolUseEvent
  | ClaudeCodeNotificationEvent
  | ClaudeCodeUserPromptSubmitEvent;

export type ClaudeCodeHookEventName =
  | "PreToolUse"
  | "PostToolUseFailure"
  | "PostToolUse"
  | "Notification"
  | "UserPromptSubmit";

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

export type ClaudeCodeNotificationType =
  | "permission_prompt"
  | "idle_prompt"
  | "auth_success"
  | "elicitation_dialog";

export type ClaudeCodeNotificationEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "Notification";
  message: string;
  title?: string;
  notification_type: ClaudeCodeNotificationType;
};

export type ClaudeCodeUserPromptSubmitEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
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
  classifyCommand?: (command: string, event: ClaudeCodePreToolUseEvent) => ConsequenceLevel;
};

const DEFAULT_TOOLS: string[] | undefined = undefined;
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
): ConformedEvent[] {
  const tools = options.tools ?? DEFAULT_TOOLS;

  switch (event.hook_event_name) {
    case "PreToolUse":
      return !tools || tools.includes(event.tool_name) ? [mapPreToolUse(event, options)] : [];
    case "PostToolUseFailure":
      return [mapPostToolUseFailure(event)];
    case "PostToolUse":
      return options.includePostToolUse ? [mapPostToolUse(event)] : [];
    case "Notification":
      return mapNotification(event);
    case "UserPromptSubmit":
      return [mapUserPromptSubmit(event)];
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
    case "acknowledged":
      return null;
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

export function classifyToolRisk(
  event: ClaudeCodePreToolUseEvent,
  options: Pick<ClaudeCodeMappingOptions, "classifyCommand"> = {},
): ConsequenceLevel {
  const command = readString(event.tool_input.command);
  const classifyCommand = options.classifyCommand ?? bashConsequence;
  if (command) {
    return classifyCommand(command, event);
  }

  const toolName = event.tool_name.toLowerCase();
  if (toolName === "read" || toolName === "grep" || toolName === "glob" || toolName === "ls") {
    return "low";
  }

  if (toolName === "websearch" || toolName === "web_fetch" || toolName === "webfetch") {
    return "low";
  }

  if (toolName === "write" || toolName === "edit" || toolName === "multiedit") {
    return hasSensitivePath(event) ? "high" : "medium";
  }

  return "medium";
}

function mapPreToolUse(
  event: ClaudeCodePreToolUseEvent,
  options: ClaudeCodeMappingOptions,
): ConformedHumanInputRequestedEvent {
  const command = readString(event.tool_input.command);
  const summary = command ?? toolInputSummary(event);
  const whyNow =
    readString(event.tool_input.description) ??
    `Claude Code requested approval before running ${event.tool_name}.`;

  const contextItems: { id: string; label: string; value: string }[] = [];
  if (command) {
    contextItems.push({ id: "command", label: "Command", value: command });
  } else {
    contextItems.push(...toolInputContextItems(event));
  }
  contextItems.push({ id: "cwd", label: "Working directory", value: event.cwd });

  const consequence = classifyToolRisk(event, options);

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudeInteractionId(event.session_id, event.tool_use_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title: `Approve ${event.tool_name}`,
    summary,
    request: {
      kind: "approval",
    },
    riskHint: consequence,
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow,
    },
  };
}

function mapPostToolUseFailure(
  event: ClaudeCodePostToolUseFailureEvent,
): ConformedTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title: `${event.tool_name} failed`,
    summary: event.error,
    status: "failed",
  };
}

function mapPostToolUse(event: ClaudeCodePostToolUseEvent): ConformedTaskUpdatedEvent {
  const summary =
    readString(event.tool_response?.message) ??
    `${event.tool_name} completed successfully.`;

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title: `${event.tool_name} completed`,
    summary,
    status: "running",
  };
}

function mapNotification(event: ClaudeCodeNotificationEvent): ConformedEvent[] {
  if (
    event.notification_type !== "idle_prompt"
    && event.notification_type !== "elicitation_dialog"
  ) {
    return [];
  }

  const title = event.notification_type === "elicitation_dialog"
    ? "Claude requested input"
    : "Claude is waiting for input";

  return [
    {
      id: claudeEventId(event, "task.updated"),
      type: "task.updated",
      taskId: claudeTaskId(event.session_id),
      timestamp: new Date().toISOString(),
      source: claudeSource(event),
      title,
      summary: event.title ? `${event.title}: ${event.message}` : event.message,
      status: "blocked",
    },
  ];
}

function mapUserPromptSubmit(
  event: ClaudeCodeUserPromptSubmitEvent,
): ConformedTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    summary: "Operator replied in Claude Code.",
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

function claudeTaskId(sessionId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}`;
}

function claudeInteractionId(sessionId: string, toolUseId: string): string {
  return `claude-code:tool:${encodeURIComponent(sessionId)}:${encodeURIComponent(toolUseId)}`;
}

function claudeEventId(
  event: ClaudeCodeHookEvent,
  suffix: string,
): string {
  return `claude-code:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:${encodeURIComponent("tool_use_id" in event ? event.tool_use_id ?? "none" : "none")}:${suffix}`;
}

function claudeSource(event: Pick<ClaudeCodeHookBaseEvent, "session_id" | "cwd">) {
  const workspace = workspaceLabel(event.cwd);
  const session = shortSessionLabel(event.session_id);
  const label = workspace
    ? `Claude Code ${workspace} #${session}`
    : `Claude Code #${session}`;

  return {
    id: `claude-code:${event.session_id}`,
    kind: "claude-code",
    label,
  };
}

function workspaceLabel(cwd: string): string | null {
  const normalized = cwd.replace(/[\\/]+$/, "");
  if (normalized.length === 0) {
    return null;
  }

  const label = basename(normalized);
  return label.length > 0 ? label : normalized;
}

function shortSessionLabel(sessionId: string): string {
  const collapsed = sessionId.replace(/[^a-zA-Z0-9]/g, "");
  if (collapsed.length > 0 && collapsed.length <= 8) {
    return collapsed.toLowerCase();
  }

  if (collapsed.length > 8) {
    return collapsed.slice(0, 6).toLowerCase();
  }

  if (sessionId.length <= 12) {
    return sessionId;
  }

  return sessionId.slice(0, 12);
}

function toolInputSummary(event: ClaudeCodePreToolUseEvent): string {
  const input = event.tool_input;
  // Try common field names across Claude Code tools
  const filePath = readString(input.file_path) ?? readString(input.path);
  const pattern = readString(input.pattern);
  const query = readString(input.query);
  const url = readString(input.url);

  if (filePath && pattern) return `${pattern} in ${filePath}`;
  if (filePath) return filePath;
  if (pattern) return pattern;
  if (query) return query;
  if (url) return url;
  return event.tool_name;
}

function hasSensitivePath(event: ClaudeCodePreToolUseEvent): boolean {
  return collectStringValues(event.tool_input).some((value) => isSensitivePathValue(value, event.cwd));
}

function isSensitivePathValue(value: string, cwd: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const cwdNormalized = cwd.replace(/\\/g, "/").replace(/[\\/]+$/, "");

  if (lower.includes(".env") || lower.includes(".ssh/") || lower.endsWith("/.ssh")) {
    return true;
  }

  if (
    lower.includes(".github/workflows") ||
    lower.endsWith("package.json") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("dockerfile") ||
    lower.endsWith(".git/config") ||
    lower.endsWith(".npmrc") ||
    lower.endsWith(".bashrc") ||
    lower.endsWith(".zshrc") ||
    lower.endsWith("tsconfig.json")
  ) {
    return true;
  }

  if (normalized.startsWith("/") && cwdNormalized.length > 0 && !normalized.startsWith(`${cwdNormalized}/`)) {
    return true;
  }

  return false;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStringValues(item));
  }

  return [];
}

function toolInputContextItems(
  event: ClaudeCodePreToolUseEvent,
): { id: string; label: string; value: string }[] {
  const items: { id: string; label: string; value: string }[] = [];
  const input = event.tool_input;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 500) {
      items.push({ id: key, label: key, value });
    }
  }
  return items;
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
