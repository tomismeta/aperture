import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  AttentionResponse,
  HumanInputRequest,
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskCompletedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";
import type { AttentionConsequenceLevel as ConsequenceLevel } from "../../core/src/frame.js";

export type ClaudeCodeHookEvent =
  | ClaudeCodePreToolUseEvent
  | ClaudeCodePermissionRequestEvent
  | ClaudeCodePostToolUseFailureEvent
  | ClaudeCodePostToolUseEvent
  | ClaudeCodeElicitationEvent
  | ClaudeCodeElicitationResultEvent
  | ClaudeCodeNotificationEvent
  | ClaudeCodeUserPromptSubmitEvent
  | ClaudeCodeStopEvent;

export type ClaudeCodeHookEventName =
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUseFailure"
  | "PostToolUse"
  | "Elicitation"
  | "ElicitationResult"
  | "Notification"
  | "UserPromptSubmit"
  | "Stop";

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

export type ClaudeCodePermissionRequestEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_suggestions?: Array<Record<string, unknown>>;
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

export type ClaudeCodeElicitationMode = "form" | "url";

export type ClaudeCodeElicitationEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "Elicitation";
  mcp_server_name: string;
  message: string;
  mode?: ClaudeCodeElicitationMode;
  url?: string;
  elicitation_id?: string;
  requested_schema?: Record<string, unknown>;
};

export type ClaudeCodeElicitationAction = "accept" | "decline" | "cancel";

export type ClaudeCodeElicitationResultEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "ElicitationResult";
  mcp_server_name: string;
  action: ClaudeCodeElicitationAction;
  mode?: ClaudeCodeElicitationMode;
  elicitation_id?: string;
  content?: Record<string, unknown>;
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

export type ClaudeCodeStopEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "Stop";
  stop_hook_active?: boolean;
  stop_reason?: string;
  message?: string;
  last_assistant_message?: string;
};

export type ClaudeCodeHookResponse =
  | {
      hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: "allow" | "deny" | "ask";
        permissionDecisionReason?: string;
      };
    }
  | {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest";
        decision: {
          behavior: "allow" | "deny";
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: Array<Record<string, unknown>>;
          message?: string;
          interrupt?: boolean;
        };
      };
    }
  | {
      hookSpecificOutput: {
        hookEventName: "Elicitation";
        action: ClaudeCodeElicitationAction;
        content?: Record<string, unknown>;
      };
    }
  | Record<string, never>;

export type ClaudeCodePreToolUseMappedEvent = Extract<
  ReturnType<typeof mapPreToolUse>,
  SourceHumanInputRequestedEvent
>;

export type ClaudeCodePermissionRequestMappedEvent = Extract<
  ReturnType<typeof mapPermissionRequest>,
  SourceHumanInputRequestedEvent
>;

export type ClaudeCodeElicitationMappedEvent = Extract<
  ReturnType<typeof mapElicitation>,
  SourceHumanInputRequestedEvent
>;

export type ClaudeCodeMappingOptions = {
  tools?: string[];
  includePostToolUse?: boolean;
  classifyCommand?: (command: string, event: ClaudeCodePreToolUseEvent) => ConsequenceLevel;
};

type HumanInputFormRequest = Extract<HumanInputRequest, { kind: "form" }>;
type HumanInputFormField = HumanInputFormRequest["fields"][number];

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
): SourceEvent[] {
  const tools = options.tools ?? DEFAULT_TOOLS;

  switch (event.hook_event_name) {
    case "PreToolUse":
      return !tools || tools.includes(event.tool_name) ? [mapPreToolUse(event, options)] : [];
    case "PermissionRequest":
      return !tools || tools.includes(event.tool_name) ? [mapPermissionRequest(event, options)] : [];
    case "PostToolUseFailure":
      return [mapPostToolUseFailure(event)];
    case "PostToolUse":
      return options.includePostToolUse ? [mapPostToolUse(event)] : [];
    case "Elicitation":
      return [mapElicitation(event)];
    case "ElicitationResult":
      return [mapElicitationResult(event)];
    case "Notification":
      return mapNotification(event);
    case "UserPromptSubmit":
      return [mapUserPromptSubmit(event)];
    case "Stop":
      return mapStop(event);
  }
}

export function mapClaudeCodeFrameResponse(
  response: AttentionResponse,
): ClaudeCodeHookResponse | null {
  const parsed = parseClaudeInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "tool") {
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
      case "text_submitted":
        return null;
    }
  }

  if (parsed.kind === "permission") {
    switch (response.response.kind) {
      case "approved":
        return {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
              behavior: "allow",
            },
          },
        };
      case "rejected":
        return {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
              behavior: "deny",
              ...(response.response.reason ? { message: response.response.reason } : {}),
            },
          },
        };
      case "dismissed":
        return {};
      case "acknowledged":
      case "option_selected":
      case "form_submitted":
      case "text_submitted":
        return null;
    }
  }

  switch (response.response.kind) {
    case "acknowledged":
      return null;
    case "approved":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
        },
      };
    case "rejected":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "decline",
        },
      };
    case "dismissed":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "cancel",
        },
      };
    case "option_selected": {
      const content = elicitationContentFromOptionIds(parsed, response.response.optionIds);
      if (!content) {
        return null;
      }
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content,
        },
      };
    }
    case "text_submitted": {
      const content = parsed.fieldId
        ? { [parsed.fieldId]: response.response.text }
        : { response: response.response.text };
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content,
        },
      };
    }
    case "form_submitted":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content: response.response.values,
        },
      };
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

  if (
    toolName === "websearch"
    || toolName === "toolsearch"
    || toolName === "web_fetch"
    || toolName === "webfetch"
  ) {
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
): SourceHumanInputRequestedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
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
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    title: approvalTitle(event, summary),
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

function mapPermissionRequest(
  event: ClaudeCodePermissionRequestEvent,
  options: ClaudeCodeMappingOptions,
): SourceHumanInputRequestedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const command = readString(event.tool_input.command);
  const summary = command ?? permissionRequestSummary(event);
  const whyNow =
    readString(event.tool_input.description)
    ?? `Claude Code is asking for permission before running ${event.tool_name}.`;

  const contextItems: { id: string; label: string; value: string }[] = [];
  if (command) {
    contextItems.push({ id: "command", label: "Command", value: command });
  } else {
    contextItems.push(...permissionInputContextItems(event));
  }
  contextItems.push({ id: "cwd", label: "Working directory", value: event.cwd });
  if (event.permission_suggestions?.length) {
    contextItems.push({
      id: "permission_suggestions",
      label: "Claude suggestions",
      value: `${event.permission_suggestions.length} native permission suggestion${event.permission_suggestions.length === 1 ? "" : "s"}`,
    });
  }

  const consequence = classifyPermissionRequestRisk(event, options);

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudePermissionInteractionId(event.session_id, event.tool_name, event.tool_input),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    title: permissionRequestTitle(event, summary),
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
): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "tool_failure",
    title: `${event.tool_name} failed`,
    summary: event.error,
    status: "failed",
  };
}

function mapPostToolUse(event: ClaudeCodePostToolUseEvent): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const summary =
    readString(event.tool_response?.message) ??
    `${event.tool_name} completed successfully.`;

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "tool_completion",
    title: `${event.tool_name} completed`,
    summary,
    status: "running",
  };
}

function mapElicitation(event: ClaudeCodeElicitationEvent): SourceHumanInputRequestedEvent {
  const request = buildElicitationRequest(event);
  const contextItems = [
    { id: "mcp_server_name", label: "Server", value: event.mcp_server_name },
  ];

  if (event.mode) {
    contextItems.push({ id: "mode", label: "Mode", value: event.mode });
  }
  if (event.url) {
    contextItems.push({ id: "url", label: "URL", value: event.url });
  }

  const fieldId = singleTextFieldId(event.requested_schema);

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudeElicitationInteractionId(
      event.session_id,
      event.mcp_server_name,
      elicitationToken(event),
      fieldId,
    ),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    toolFamily: "mcp",
    activityClass: "question_request",
    title: event.message,
    summary: elicitationSummary(event, request),
    request,
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow: `Claude is waiting for input from ${event.mcp_server_name}.`,
    },
  };
}

function mapElicitationResult(
  event: ClaudeCodeElicitationResultEvent,
): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    summary: `Claude ${elicitationActionPastTense(event.action)} an input request for ${event.mcp_server_name}.`,
  };
}

function mapNotification(event: ClaudeCodeNotificationEvent): SourceEvent[] {
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
      activityClass: "follow_up",
      title,
      summary: event.title ? `${event.title}: ${event.message}` : event.message,
      status: "blocked",
    },
  ];
}

function mapUserPromptSubmit(
  event: ClaudeCodeUserPromptSubmitEvent,
): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    summary: "Operator replied in Claude Code.",
  };
}

function mapStop(event: ClaudeCodeStopEvent): SourceEvent[] {
  if (event.stop_hook_active) {
    return [];
  }

  const message = stopSummary(event);
  if (message && looksLikeFollowUpQuestion(message)) {
    return [
      {
        id: claudeEventId(event, "task.updated"),
        type: "task.updated",
        taskId: claudeTaskId(event.session_id),
        timestamp: new Date().toISOString(),
        source: claudeSource(event),
        activityClass: "follow_up",
        title: "Claude is waiting for follow-up",
        summary: message,
        status: "blocked",
      },
    ];
  }

  return [
    {
      id: claudeEventId(event, "task.updated"),
      type: "task.updated",
      taskId: claudeTaskId(event.session_id),
      timestamp: new Date().toISOString(),
      source: claudeSource(event),
      activityClass: "status_update",
      title: "Claude completed a turn",
      summary: message ?? "Claude finished responding.",
      status: "running",
    },
  ];
}

function parseClaudeInteractionId(
  interactionId: string,
):
  | {
      kind: "tool";
      sessionId: string;
      toolUseId: string;
    }
  | {
      kind: "permission";
      sessionId: string;
      permissionToken: string;
    }
  | {
      kind: "elicitation";
      sessionId: string;
      mcpServerName: string;
      elicitationId: string;
      fieldId?: string;
    }
  | null {
  const parts = interactionId.split(":");
  if (parts.length < 4 || parts[0] !== "claude-code") {
    return null;
  }

  if (parts[1] === "tool") {
    if (parts.length !== 4) {
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

  if (parts[1] === "permission") {
    if (parts.length !== 4) {
      return null;
    }

    const sessionId = safeDecode(parts[2] ?? "");
    const permissionToken = safeDecode(parts[3] ?? "");
    if (!sessionId || !permissionToken) {
      return null;
    }

    return {
      kind: "permission",
      sessionId,
      permissionToken,
    };
  }

  if (parts[1] !== "elicitation" || (parts.length !== 5 && parts.length !== 6)) {
    return null;
  }

  const sessionId = safeDecode(parts[2] ?? "");
  const mcpServerName = safeDecode(parts[3] ?? "");
  const elicitationId = safeDecode(parts[4] ?? "");
  const fieldId = parts[5] ? safeDecode(parts[5]) : null;
  if (!sessionId || !mcpServerName || !elicitationId) {
    return null;
  }

  return {
    kind: "elicitation",
    sessionId,
    mcpServerName,
    elicitationId,
    ...(fieldId ? { fieldId } : {}),
  };
}

function claudeTaskId(sessionId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}`;
}

function claudeInteractionId(sessionId: string, toolUseId: string): string {
  return `claude-code:tool:${encodeURIComponent(sessionId)}:${encodeURIComponent(toolUseId)}`;
}

function claudePermissionInteractionId(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  return `claude-code:permission:${encodeURIComponent(sessionId)}:${encodeURIComponent(permissionRequestToken(toolName, toolInput))}`;
}

function claudeElicitationInteractionId(
  sessionId: string,
  mcpServerName: string,
  elicitationId: string,
  fieldId?: string,
): string {
  return fieldId
    ? `claude-code:elicitation:${encodeURIComponent(sessionId)}:${encodeURIComponent(mcpServerName)}:${encodeURIComponent(elicitationId)}:${encodeURIComponent(fieldId)}`
    : `claude-code:elicitation:${encodeURIComponent(sessionId)}:${encodeURIComponent(mcpServerName)}:${encodeURIComponent(elicitationId)}`;
}

function elicitationToken(event: ClaudeCodeElicitationEvent): string {
  return event.elicitation_id ?? event.message;
}

function claudeEventId(
  event: ClaudeCodeHookEvent,
  suffix: string,
): string {
  return `claude-code:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:${encodeURIComponent(claudeEventToken(event))}:${suffix}`;
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
  const query = readSearchQuery(input);
  const url = readString(input.url);

  if (filePath && pattern) return `${pattern} in ${filePath}`;
  if (filePath) return filePath;
  if (pattern) return pattern;
  if (query) return query;
  if (event.tool_name.toLowerCase() === "toolsearch") return "web search";
  if (url) return url;
  return event.tool_name;
}

function permissionRequestSummary(event: ClaudeCodePermissionRequestEvent): string {
  const input = event.tool_input;
  const filePath = readString(input.file_path) ?? readString(input.path);
  const pattern = readString(input.pattern);
  const query = readSearchQuery(input);
  const url = readString(input.url);

  if (filePath && pattern) return `${pattern} in ${filePath}`;
  if (filePath) return filePath;
  if (pattern) return pattern;
  if (query) return query;
  if (event.tool_name.toLowerCase() === "toolsearch") return "web search";
  if (url) return url;
  return event.tool_name;
}

function elicitationSummary(
  event: ClaudeCodeElicitationEvent,
  request: HumanInputRequest,
): string {
  if (request.kind === "approval" && event.url) {
    return `Open ${event.url} to continue.`;
  }

  return `Input requested by ${event.mcp_server_name}.`;
}

function buildElicitationRequest(event: ClaudeCodeElicitationEvent): HumanInputRequest {
  if (event.mode === "url") {
    return {
      kind: "approval",
    };
  }

  const schema = event.requested_schema;
  const singleEnum = singleEnumField(schema);
  if (singleEnum) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: singleEnum.values.map((value) => ({
        id: elicitationChoiceOptionId(singleEnum.fieldId, value),
        label: value,
      })),
    };
  }

  const singleBoolean = singleBooleanField(schema);
  if (singleBoolean) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: elicitationChoiceOptionId(singleBoolean.fieldId, "true"), label: "Yes" },
        { id: elicitationChoiceOptionId(singleBoolean.fieldId, "false"), label: "No" },
      ],
    };
  }

  const textFieldId = singleTextFieldId(schema);
  if (textFieldId) {
    return {
      kind: "choice",
      selectionMode: "single",
      allowTextResponse: true,
      options: [],
    };
  }

  const fields = schemaToFormFields(schema);
  if (fields.length > 0) {
    return {
      kind: "form",
      fields,
    };
  }

  return {
    kind: "choice",
    selectionMode: "single",
    allowTextResponse: true,
    options: [],
  };
}

function schemaToFormFields(schema: Record<string, unknown> | undefined): HumanInputFormField[] {
  const properties = schemaProperties(schema);
  const required = schemaRequiredFields(schema);
  return Object.entries(properties).flatMap(([fieldId, definition]) => {
    const field = definitionToFormField(fieldId, definition, required.has(fieldId));
    return field ? [field] : [];
  });
}

function definitionToFormField(
  fieldId: string,
  definition: Record<string, unknown>,
  required: boolean,
): HumanInputFormField | null {
  const label = readString(definition.title) ?? humanizeFieldId(fieldId);
  const type = fieldType(definition);

  switch (type) {
    case "string": {
      const enumValues = readStringArray(definition.enum);
      if (enumValues) {
        return {
          id: fieldId,
          label,
          type: "select",
          required,
          options: enumValues.map((value) => ({ value, label: value })),
        };
      }
      return {
        id: fieldId,
        label,
        type: "text",
        required,
      };
    }
    case "integer":
    case "number":
      return {
        id: fieldId,
        label,
        type: "number",
        required,
      };
    case "boolean":
      return {
        id: fieldId,
        label,
        type: "boolean",
        required,
      };
    default:
      return null;
  }
}

function schemaProperties(schema: Record<string, unknown> | undefined): Record<string, Record<string, unknown>> {
  if (!schema || typeof schema !== "object") {
    return {};
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [[key, value as Record<string, unknown>]];
      }
      return [];
    }),
  );
}

function schemaRequiredFields(schema: Record<string, unknown> | undefined): Set<string> {
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  return new Set(required);
}

function singleEnumField(
  schema: Record<string, unknown> | undefined,
): { fieldId: string; values: string[] } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  const values = readStringArray(definition.enum);
  if (!values || fieldType(definition) !== "string") {
    return null;
  }
  return { fieldId, values };
}

function singleBooleanField(
  schema: Record<string, unknown> | undefined,
): { fieldId: string } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  return fieldType(definition) === "boolean" ? { fieldId } : null;
}

function singleTextFieldId(schema: Record<string, unknown> | undefined): string | undefined {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return undefined;
  }
  const [fieldId, definition] = properties[0]!;
  return fieldType(definition) === "string" && !readStringArray(definition.enum)
    ? fieldId
    : undefined;
}

function fieldType(definition: Record<string, unknown>): string | undefined {
  return readString(definition.type);
}

function elicitationChoiceOptionId(fieldId: string, value: string): string {
  return `${encodeURIComponent(fieldId)}=${encodeURIComponent(value)}`;
}

function elicitationContentFromOptionIds(
  parsed: Extract<NonNullable<ReturnType<typeof parseClaudeInteractionId>>, { kind: "elicitation" }>,
  optionIds: string[],
): Record<string, unknown> | null {
  const selected = optionIds[0];
  if (!selected) {
    return null;
  }

  const separator = selected.indexOf("=");
  if (separator === -1) {
    return parsed.fieldId ? { [parsed.fieldId]: selected } : null;
  }

  const fieldId = safeDecode(selected.slice(0, separator));
  const value = safeDecode(selected.slice(separator + 1));
  if (!fieldId || value === null) {
    return null;
  }

  if (value === "true") {
    return { [fieldId]: true };
  }
  if (value === "false") {
    return { [fieldId]: false };
  }

  return { [fieldId]: value };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return next.length > 0 ? next : undefined;
}

function humanizeFieldId(fieldId: string): string {
  return fieldId
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function claudeEventToken(event: ClaudeCodeHookEvent): string {
  if ("tool_use_id" in event && typeof event.tool_use_id === "string" && event.tool_use_id.length > 0) {
    return event.tool_use_id;
  }

  if ("tool_name" in event && event.hook_event_name === "PermissionRequest") {
    return permissionRequestToken(event.tool_name, event.tool_input);
  }

  if ("elicitation_id" in event) {
    return event.elicitation_id ?? ("message" in event ? event.message : "none");
  }

  return "none";
}

function elicitationActionPastTense(action: ClaudeCodeElicitationAction): string {
  switch (action) {
    case "accept":
      return "accepted";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
  }
}

function permissionRequestToken(toolName: string, toolInput: Record<string, unknown>): string {
  const hash = createHash("sha1");
  hash.update(toolName);
  hash.update(":");
  hash.update(stableJson(toolInput));
  return hash.digest("hex").slice(0, 12);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function claudeToolFamily(toolName: string): string | undefined {
  switch (toolName.toLowerCase()) {
    case "read":
    case "grep":
    case "glob":
    case "ls":
      return "read";
    case "write":
      return "write";
    case "edit":
    case "multiedit":
      return "edit";
    case "bash":
      return "bash";
    case "websearch":
    case "toolsearch":
    case "web_fetch":
    case "webfetch":
      return "web";
    default:
      return undefined;
  }
}

function approvalTitle(event: ClaudeCodePreToolUseEvent, summary: string): string {
  const action = approvalActionLabel(event);
  const detail = approvalTitleDetail(event, summary);
  return detail ? `Claude Code wants to ${action} ${detail}` : `Claude Code wants to ${action}`;
}

function approvalTitleDetail(event: ClaudeCodePreToolUseEvent, summary: string): string | null {
  const toolName = event.tool_name.toLowerCase();
  const input = event.tool_input;

  if (toolName === "bash") {
    return "a shell command";
  }

  const filePath = readString(input.file_path) ?? readString(input.path);
  if (filePath) {
    return basename(filePath);
  }

  const pattern = readString(input.pattern);
  if (pattern) return pattern;

  const query = readSearchQuery(input);
  if (query) return query;

  if (summary && summary !== event.tool_name) return summary;

  return null;
}

function approvalActionLabel(event: ClaudeCodePreToolUseEvent): string {
  const toolName = event.tool_name.toLowerCase();

  switch (toolName) {
    case "read":
      return "read";
    case "write":
      return "write";
    case "edit":
    case "multiedit":
      return "edit";
    case "glob":
      return "search files with";
    case "grep":
      return "search file contents with";
    case "ls":
      return "list files in";
    case "websearch":
    case "toolsearch":
      return "search the web for";
    case "web_fetch":
    case "webfetch":
      return "fetch";
    case "bash":
      return "run";
    default:
      return `use ${event.tool_name}`;
  }
}

function permissionActionLabel(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "read":
      return "read";
    case "write":
      return "write";
    case "edit":
    case "multiedit":
      return "edit";
    case "glob":
      return "search files with";
    case "grep":
      return "search file contents with";
    case "ls":
      return "list files in";
    case "websearch":
    case "toolsearch":
      return "search the web for";
    case "web_fetch":
    case "webfetch":
      return "fetch";
    case "bash":
      return "run";
    default:
      return `use ${toolName}`;
  }
}

function readSearchQuery(input: Record<string, unknown>): string | undefined {
  return (
    readString(input.query)
    ?? readString(input.search_query)
    ?? readString(input.q)
    ?? readString(input.searchTerm)
  );
}

function classifyPermissionRequestRisk(
  event: ClaudeCodePermissionRequestEvent,
  options: Pick<ClaudeCodeMappingOptions, "classifyCommand"> = {},
): ConsequenceLevel {
  const command = readString(event.tool_input.command);
  const classifyCommand = options.classifyCommand ?? bashConsequence;
  if (command) {
    return classifyCommand(command, {
      session_id: event.session_id,
      cwd: event.cwd,
      hook_event_name: "PreToolUse",
      tool_name: event.tool_name,
      tool_use_id: permissionRequestToken(event.tool_name, event.tool_input),
      tool_input: event.tool_input,
      ...(event.permission_mode !== undefined ? { permission_mode: event.permission_mode } : {}),
      ...(event.transcript_path !== undefined ? { transcript_path: event.transcript_path } : {}),
    });
  }

  const toolName = event.tool_name.toLowerCase();
  if (toolName === "read" || toolName === "grep" || toolName === "glob" || toolName === "ls") {
    return "low";
  }

  if (
    toolName === "websearch"
    || toolName === "toolsearch"
    || toolName === "web_fetch"
    || toolName === "webfetch"
  ) {
    return "low";
  }

  if (toolName === "write" || toolName === "edit" || toolName === "multiedit") {
    return hasSensitivePermissionPath(event) ? "high" : "medium";
  }

  return "medium";
}

function hasSensitivePath(event: ClaudeCodePreToolUseEvent): boolean {
  return collectStringValues(event.tool_input).some((value) => isSensitivePathValue(value, event.cwd));
}

function hasSensitivePermissionPath(event: ClaudeCodePermissionRequestEvent): boolean {
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

function stopSummary(event: ClaudeCodeStopEvent): string | undefined {
  const direct =
    readString(event.last_assistant_message) ??
    readString(event.message);
  if (direct) {
    // Take only the first non-empty line to avoid dumping full responses
    const firstLine = direct
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return firstLine ?? "Claude finished responding.";
  }

  if (event.stop_reason === "end_turn") {
    return "Claude finished responding.";
  }

  return undefined;
}

function looksLikeFollowUpQuestion(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? value.trim();
  return /\?\s*$/.test(lastLine);
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

function permissionInputContextItems(
  event: ClaudeCodePermissionRequestEvent,
): { id: string; label: string; value: string }[] {
  const items: { id: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(event.tool_input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 500) {
      items.push({ id: key, label: key, value });
    }
  }
  return items;
}

function permissionRequestTitle(event: ClaudeCodePermissionRequestEvent, summary: string): string {
  const action = permissionActionLabel(event.tool_name);
  const detail = permissionRequestTitleDetail(event, summary);
  return detail ? `Claude Code wants permission to ${action} ${detail}` : `Claude Code wants permission to ${action}`;
}

function permissionRequestTitleDetail(
  event: ClaudeCodePermissionRequestEvent,
  summary: string,
): string | null {
  const toolName = event.tool_name.toLowerCase();
  const input = event.tool_input;

  if (toolName === "bash") {
    return "a shell command";
  }

  const filePath = readString(input.file_path) ?? readString(input.path);
  if (filePath) {
    return basename(filePath);
  }

  const pattern = readString(input.pattern);
  if (pattern) return pattern;

  const query = readSearchQuery(input);
  if (query) return query;

  if (summary && summary !== event.tool_name) return summary;

  return null;
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
