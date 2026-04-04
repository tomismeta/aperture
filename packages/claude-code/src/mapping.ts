import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  AttentionConsequenceLevel as ConsequenceLevel,
  AttentionResponse,
  HumanInputRequest,
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskCompletedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";
import type { ClaudeCodeAskUserQuestionTranscriptPayload } from "./transcript.js";

export type ClaudeCodeHookEvent =
  | ClaudeCodeSessionStartEvent
  | ClaudeCodePreToolUseEvent
  | ClaudeCodePermissionRequestEvent
  | ClaudeCodePermissionDeniedEvent
  | ClaudeCodePostToolUseFailureEvent
  | ClaudeCodePostToolUseEvent
  | ClaudeCodeElicitationEvent
  | ClaudeCodeElicitationResultEvent
  | ClaudeCodeNotificationEvent
  | ClaudeCodeSubagentStartEvent
  | ClaudeCodeSubagentStopEvent
  | ClaudeCodeTaskCreatedEvent
  | ClaudeCodeTaskCompletedEvent
  | ClaudeCodeUserPromptSubmitEvent
  | ClaudeCodeStopFailureEvent
  | ClaudeCodeSessionEndEvent
  | ClaudeCodeStopEvent;

export type ClaudeCodeHookEventName =
  | "SessionStart"
  | "PreToolUse"
  | "PermissionRequest"
  | "PermissionDenied"
  | "PostToolUseFailure"
  | "PostToolUse"
  | "Elicitation"
  | "ElicitationResult"
  | "Notification"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCreated"
  | "TaskCompleted"
  | "UserPromptSubmit"
  | "StopFailure"
  | "SessionEnd"
  | "Stop";

export type ClaudeCodeHookBaseEvent = {
  session_id: string;
  cwd: string;
  hook_event_name: ClaudeCodeHookEventName;
  permission_mode?: string;
  transcript_path?: string;
};

export type ClaudeCodeSessionStartSource = "startup" | "resume" | "clear" | "compact";

export type ClaudeCodeSessionStartEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "SessionStart";
  source: ClaudeCodeSessionStartSource;
  model: string;
  agent_type?: string;
};

export type ClaudeCodePreToolUseEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
  askUserQuestion?: ClaudeCodeAskUserQuestionTranscriptPayload;
};

export type ClaudeCodePermissionRequestEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_suggestions?: Array<Record<string, unknown>>;
  askUserQuestion?: ClaudeCodeAskUserQuestionTranscriptPayload;
};

export type ClaudeCodePermissionDeniedEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PermissionDenied";
  tool_name: string;
  tool_input?: Record<string, unknown>;
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
  askUserQuestion?: ClaudeCodeAskUserQuestionTranscriptPayload;
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

export type ClaudeCodeSubagentStartEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
};

export type ClaudeCodeSubagentStopEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "SubagentStop";
  stop_hook_now?: boolean;
  agent_id: string;
  agent_type: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
};

export type ClaudeCodeTaskCreatedEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "TaskCreated";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
};

export type ClaudeCodeTaskCompletedEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "TaskCompleted";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
};

export type ClaudeCodeUserPromptSubmitEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
};

export type ClaudeCodeStopFailureError =
  | "rate_limit"
  | "authentication_failed"
  | "billing_error"
  | "invalid_request"
  | "server_error"
  | "max_output_tokens"
  | "unknown";

export type ClaudeCodeStopFailureEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "StopFailure";
  error: ClaudeCodeStopFailureError;
  error_details?: string;
  last_assistant_message?: string;
};

export type ClaudeCodeSessionEndReason =
  | "clear"
  | "resume"
  | "logout"
  | "prompt_input_exit"
  | "bypass_permissions_disabled"
  | "other";

export type ClaudeCodeSessionEndEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "SessionEnd";
  reason: ClaudeCodeSessionEndReason;
};

export type ClaudeCodeStopEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "Stop";
  stop_hook_now?: boolean;
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
        updatedInput?: Record<string, unknown>;
        additionalContext?: string;
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
type ContextItem = NonNullable<NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]>[number];
type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

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
    case "SessionStart":
      return [mapSessionStart(event)];
    case "PreToolUse":
      if (tools && !tools.includes(event.tool_name)) {
        return [];
      }
      if (event.tool_name === "AskUserQuestion" && event.askUserQuestion?.questions.length) {
        return [mapAskUserQuestion(event)];
      }
      return [mapPreToolUse(event, options)];
    case "PermissionRequest":
      return !tools || tools.includes(event.tool_name) ? [mapPermissionRequest(event, options)] : [];
    case "PermissionDenied":
      return !tools || tools.includes(event.tool_name) ? [mapPermissionDenied(event)] : [];
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
    case "SubagentStart":
      return [mapSubagentStart(event)];
    case "SubagentStop":
      return mapSubagentStop(event);
    case "TaskCreated":
      return [mapTaskCreated(event)];
    case "TaskCompleted":
      return [mapTaskCompleted(event)];
    case "UserPromptSubmit":
      return [mapUserPromptSubmit(event)];
    case "StopFailure":
      return [mapStopFailure(event)];
    case "SessionEnd":
      return [mapSessionEnd(event)];
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

export function mapClaudeCodeAskUserQuestionResponse(
  response: AttentionResponse,
  prompt: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>,
): ClaudeCodeHookResponse | null {
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
    case "text_submitted":
    case "form_submitted": {
      const additionalContext = askUserQuestionAdditionalContext(prompt.questions, response.response);
      if (!additionalContext) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
          },
        };
      }

      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Aperture already captured the user's answer.",
          additionalContext,
        },
      };
    }
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
  if (
    toolName === "read"
    || toolName === "search"
    || toolName === "grep"
    || toolName === "glob"
    || toolName === "ls"
  ) {
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

  const contextItems: ContextItem[] = [];
  if (command) {
    contextItems.push(createContextItem("command", "Command", command));
  } else {
    contextItems.push(...toolInputContextItems(event));
  }
  contextItems.push(createContextItem("cwd", "Working Directory", event.cwd));

  const consequence = classifyToolRisk(event, options);
  const request: HumanInputRequest = {
    kind: "approval",
  };

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
    request,
    riskHint: consequence,
    semanticHints: explicitRequestSemanticHints(request, "permission_request", whyNow),
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow,
    },
  };
}

function mapSessionStart(event: ClaudeCodeSessionStartEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    semanticHints: {
      activityClass: "session_status",
      whyNow: sessionStartWhyNow(event.source),
      confidence: "high",
    },
    title: sessionStartTitle(event.source),
    summary: sessionStartSummary(event),
  };
}

function mapAskUserQuestion(
  event: ClaudeCodePreToolUseEvent,
): SourceHumanInputRequestedEvent {
  const prompt = event.askUserQuestion;
  const questions = prompt?.questions ?? [];
  const firstQuestion = questions[0];
  const title = firstQuestion?.question ?? "Claude requested input";
  const summary = firstQuestion?.header
    ? `Claude asked for input about ${firstQuestion.header}.`
    : `Claude asked ${questions.length === 1 ? "a question" : `${questions.length} questions`} before continuing.`;
  const contextItems: ContextItem[] = [createContextItem("cwd", "Working Directory", event.cwd)];
  const request = buildAskUserQuestionRequest(questions);
  const whyNow = questionRequestWhyNow("Claude");

  if (firstQuestion?.header) {
    contextItems.unshift(createContextItem("header", "Header", firstQuestion.header));
  }

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudeInteractionId(event.session_id, event.tool_use_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    activityClass: "question_request",
    title,
    summary,
    request,
    semanticHints: explicitRequestSemanticHints(request, "question_request", whyNow),
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
  const firstQuestion = event.askUserQuestion?.questions[0];
  const summary = command ?? firstQuestion?.question ?? permissionRequestSummary(event);
  const whyNow =
    readString(event.tool_input.description)
    ?? (firstQuestion
      ? "Claude needs permission before asking the operator a question."
      : `Claude Code is asking for permission before running ${event.tool_name}.`);

  const contextItems: ContextItem[] = [];
  if (command) {
    contextItems.push(createContextItem("command", "Command", command));
  } else {
    contextItems.push(...permissionInputContextItems(event));
  }
  if (firstQuestion?.header) {
    contextItems.unshift(createContextItem("header", "Header", firstQuestion.header));
  }
  contextItems.push(createContextItem("cwd", "Working Directory", event.cwd));
  if (event.permission_suggestions?.length) {
    contextItems.push(createContextItem(
      "nativeSuggestions",
      "Native Suggestions",
      `${event.permission_suggestions.length} native permission suggestion${event.permission_suggestions.length === 1 ? "" : "s"}`,
    ));
  }

  const consequence = classifyPermissionRequestRisk(event, options);
  const request: HumanInputRequest = {
    kind: "approval",
  };

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
    request,
    riskHint: consequence,
    semanticHints: explicitRequestSemanticHints(request, "permission_request", whyNow),
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow,
    },
  };
}

function mapPermissionDenied(event: ClaudeCodePermissionDeniedEvent): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const whyNow = "Claude Code auto mode denied a tool call and may need different guidance before it can continue.";

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    semanticHints: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow,
      confidence: "high",
    },
    title: permissionDeniedTitle(event),
    summary: permissionDeniedSummary(event),
    status: "blocked",
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
  const answerSummary = summarizeAskUserQuestionAnswers(event.askUserQuestion?.answers);
  const summary =
    answerSummary
    ?? readString(event.tool_response?.message)
    ?? `${event.tool_name} completed successfully.`;

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "tool_completion",
    semanticHints: taskActivitySemanticHints("tool_completion"),
    title: `${event.tool_name} completed`,
    summary,
    status: "running",
  };
}

function mapElicitation(event: ClaudeCodeElicitationEvent): SourceHumanInputRequestedEvent {
  const request = buildElicitationRequest(event);
  const whyNow = `Claude is waiting for input from ${event.mcp_server_name}.`;
  const contextItems: ContextItem[] = [
    createContextItem("serverName", "Server", event.mcp_server_name),
  ];

  if (event.mode) {
    contextItems.push(createContextItem("mode", "Mode", event.mode));
  }
  if (event.url) {
    contextItems.push(createContextItem("url", "URL", event.url));
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
    activityClass: "question_request",
    title: event.message,
    summary: elicitationSummary(event, request),
    request,
    semanticHints: explicitRequestSemanticHints(request, "question_request", whyNow),
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow,
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
  const whyNow = event.notification_type === "elicitation_dialog"
    ? "Claude surfaced an input dialog and is waiting for operator input."
    : "Claude paused and is waiting for follow-up input before continuing.";

  return [
    {
      id: claudeEventId(event, "task.updated"),
      type: "task.updated",
      taskId: claudeTaskId(event.session_id),
      timestamp: new Date().toISOString(),
      source: claudeSource(event),
      activityClass: "follow_up",
      semanticHints: followUpTaskSemanticHints(whyNow),
      title,
      summary: event.title ? `${event.title}: ${event.message}` : event.message,
      status: "blocked",
    },
  ];
}

function mapSubagentStart(event: ClaudeCodeSubagentStartEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeSubagentTaskId(event.session_id, event.agent_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    semanticHints: {
      activityClass: "session_status",
      whyNow: `Claude started a ${event.agent_type} subagent.`,
      confidence: "high",
    },
    title: `Claude started ${event.agent_type} subagent`,
    summary: `${event.agent_type} subagent is now running.`,
  };
}

function mapSubagentStop(event: ClaudeCodeSubagentStopEvent): SourceEvent[] {
  if (event.stop_hook_now) {
    return [];
  }

  return [
    {
      id: claudeEventId(event, "task.completed"),
      type: "task.completed",
      taskId: claudeSubagentTaskId(event.session_id, event.agent_id),
      timestamp: new Date().toISOString(),
      source: claudeSource(event),
      summary: subagentStopSummary(event),
    },
  ];
}

function mapTaskCreated(event: ClaudeCodeTaskCreatedEvent): SourceEvent {
  return {
    id: claudeEventId(event, "task.started"),
    type: "task.started",
    taskId: claudeAgentTaskId(event.session_id, event.task_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    semanticHints: {
      activityClass: "session_status",
      whyNow: "Claude created a teammate task.",
      confidence: "high",
    },
    title: event.task_subject,
    summary: taskLifecycleSummary(event, "created"),
  };
}

function mapTaskCompleted(event: ClaudeCodeTaskCompletedEvent): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeAgentTaskId(event.session_id, event.task_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    summary: taskLifecycleSummary(event, "completed"),
  };
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

function mapStopFailure(
  event: ClaudeCodeStopFailureEvent,
): SourceTaskUpdatedEvent {
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    activityClass: "session_status",
    semanticHints: {
      activityClass: "session_status",
      whyNow: "Claude could not finish the turn because the API returned an error.",
      confidence: "high",
    },
    title: "Claude hit an API error",
    summary: stopFailureSummary(event),
    status: "failed",
  };
}

function mapSessionEnd(event: ClaudeCodeSessionEndEvent): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    summary: sessionEndSummary(event.reason),
  };
}

function mapStop(event: ClaudeCodeStopEvent): SourceEvent[] {
  if (event.stop_hook_now) {
    return [];
  }

  const message = stopSummary(event);
  if (message && looksLikeFollowUpQuestion(message)) {
    const whyNow = followUpWhyNow("Claude");
    return [
      {
        id: claudeEventId(event, "task.updated"),
        type: "task.updated",
        taskId: claudeTaskId(event.session_id),
        timestamp: new Date().toISOString(),
        source: claudeSource(event),
        activityClass: "follow_up",
        semanticHints: followUpTaskSemanticHints(whyNow),
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

function claudeSubagentTaskId(sessionId: string, agentId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}:subagent:${encodeURIComponent(agentId)}`;
}

function claudeAgentTaskId(sessionId: string, taskId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}:task:${encodeURIComponent(taskId)}`;
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

function sessionStartTitle(source: ClaudeCodeSessionStartSource): string {
  switch (source) {
    case "startup":
      return "Claude Code session started";
    case "resume":
      return "Claude Code session resumed";
    case "clear":
      return "Claude Code session cleared";
    case "compact":
      return "Claude Code session resumed after compaction";
  }
}

function sessionStartWhyNow(source: ClaudeCodeSessionStartSource): string {
  switch (source) {
    case "startup":
      return "Claude started a new session.";
    case "resume":
      return "Claude resumed an existing session.";
    case "clear":
      return "Claude cleared the current session and is ready to continue.";
    case "compact":
      return "Claude resumed after a compaction cycle.";
  }
}

function sessionStartSummary(event: ClaudeCodeSessionStartEvent): string {
  const details = [`model ${event.model}`];
  if (event.agent_type) {
    details.push(`agent ${event.agent_type}`);
  }

  return `${sessionStartTitle(event.source)} with ${details.join(", ")}.`;
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

function permissionDeniedTitle(event: ClaudeCodePermissionDeniedEvent): string {
  const action = permissionActionLabel(event.tool_name);
  const detail = permissionDeniedTitleDetail(event);
  return detail
    ? `Claude Code auto mode denied permission to ${action} ${detail}`
    : `Claude Code auto mode denied permission to ${action}`;
}

function permissionDeniedSummary(event: ClaudeCodePermissionDeniedEvent): string {
  const input = event.tool_input;
  if (input) {
    const summary =
      readString(input.command)
      ?? readString(input.file_path)
      ?? readString(input.path)
      ?? readSearchQuery(input)
      ?? readString(input.url);
    if (summary) {
      return summary;
    }
  }

  return `${event.tool_name} was denied by Claude Code auto mode.`;
}

function permissionDeniedTitleDetail(event: ClaudeCodePermissionDeniedEvent): string | null {
  const input = event.tool_input;
  if (!input) {
    return null;
  }

  const toolName = event.tool_name.toLowerCase();
  if (toolName === "bash") {
    return "a shell command";
  }

  if (toolName === "search" || toolName === "grep" || toolName === "glob") {
    const pattern = readString(input.pattern);
    if (pattern) return pattern;
  }

  if (toolName === "websearch" || toolName === "toolsearch") {
    const query = readSearchQuery(input);
    if (query) return query;
  }

  const filePath = readString(input.file_path) ?? readString(input.path);
  if (filePath) {
    return basename(filePath);
  }

  return null;
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

function buildAskUserQuestionRequest(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
): HumanInputRequest {
  if (questions.length <= 1) {
    const question = questions[0];
    if (!question) {
      return {
        kind: "choice",
        selectionMode: "single",
        allowTextResponse: true,
        options: [],
      };
    }

    if (question.options.length === 0) {
      return {
        kind: "choice",
        selectionMode: question.multiSelect ? "multiple" : "single",
        allowTextResponse: true,
        options: [],
      };
    }

    return {
      kind: "choice",
      selectionMode: question.multiSelect ? "multiple" : "single",
      options: question.options.map((option, optionIndex) => ({
        id: askUserQuestionOptionId(0, optionIndex, option.label),
        label: option.label,
        ...(option.description ? { summary: option.description } : {}),
      })),
    };
  }

  return {
    kind: "form",
    fields: questions.flatMap((question, index): HumanInputFormField[] => {
      if (question.options.length > 0 && !question.multiSelect) {
        return [{
          id: askUserQuestionFieldId(index),
          label: question.question,
          type: "select" as const,
          required: true,
          options: question.options.map((option) => ({
            value: option.label,
            label: option.label,
          })),
        }];
      }

      if (question.options.length > 0 && question.multiSelect) {
        return question.options.map((option, optionIndex) => ({
          id: askUserQuestionBooleanFieldId(index, optionIndex),
          label: `${question.question}: ${option.label}`,
          type: "boolean" as const,
        }));
      }

      return [{
        id: askUserQuestionFieldId(index),
        label: question.question,
        type: "text" as const,
        required: true,
      }];
    }),
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

function askUserQuestionOptionId(questionIndex: number, optionIndex: number, label: string): string {
  return `q${questionIndex}:o${optionIndex}:${encodeURIComponent(label)}`;
}

function askUserQuestionFieldId(questionIndex: number): string {
  return `q${questionIndex}`;
}

function askUserQuestionBooleanFieldId(questionIndex: number, optionIndex: number): string {
  return `q${questionIndex}:o${optionIndex}`;
}

function askUserQuestionAdditionalContext(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
  response:
    | Extract<AttentionResponse["response"], { kind: "option_selected" }>
    | Extract<AttentionResponse["response"], { kind: "text_submitted" }>
    | Extract<AttentionResponse["response"], { kind: "form_submitted" }>,
): string | null {
  const answers = askUserQuestionAnswersFromResponse(questions, response);
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return null;
  }

  const rendered = entries
    .map(([question, value]) => `${JSON.stringify(question)}=${JSON.stringify(formatAskUserQuestionAnswer(value))}`)
    .join(", ");

  return `The user already answered this AskUserQuestion in Aperture. Do not ask again. Treat these answers as authoritative: ${rendered}. Continue from them directly.`;
}

function askUserQuestionAnswersFromResponse(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
  response:
    | Extract<AttentionResponse["response"], { kind: "option_selected" }>
    | Extract<AttentionResponse["response"], { kind: "text_submitted" }>
    | Extract<AttentionResponse["response"], { kind: "form_submitted" }>,
): Record<string, unknown> {
  if (questions.length === 0) {
    return {};
  }

  switch (response.kind) {
    case "option_selected": {
      const question = questions[0];
      if (!question) {
        return {};
      }

      const values = response.optionIds
        .map((optionId) => askUserQuestionAnswerFromOptionId(question, optionId))
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      if (values.length === 0) {
        return {};
      }

      return {
        [question.question]: question.multiSelect ? values : values[0]!,
      };
    }
    case "text_submitted":
      return {
        [questions[0]!.question]: response.text,
      };
    case "form_submitted":
      return Object.fromEntries(
        questions.flatMap((question, index) => {
          if (question.options.length > 0 && question.multiSelect) {
            const selectedOptions = question.options.flatMap((option, optionIndex) => {
              const value = response.values[askUserQuestionBooleanFieldId(index, optionIndex)];
              return isTrueLike(value) ? [option.label] : [];
            });
            return selectedOptions.length > 0 ? [[question.question, selectedOptions]] : [];
          }

          const value = response.values[askUserQuestionFieldId(index)];
          return value === undefined ? [] : [[question.question, value]];
        }),
      );
  }
}

function askUserQuestionAnswerFromOptionId(
  question: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"][number],
  optionId: string,
): string | null {
  const matched = /^q\d+:o(\d+):(.*)$/.exec(optionId);
  if (matched) {
    const optionIndex = Number.parseInt(matched[1] ?? "", 10);
    const fromQuestion = Number.isInteger(optionIndex) ? question.options[optionIndex]?.label : undefined;
    if (fromQuestion) {
      return fromQuestion;
    }

    return safeDecode(matched[2] ?? "");
  }

  return safeDecode(optionId);
}

function summarizeAskUserQuestionAnswers(
  answers: Record<string, unknown> | undefined,
): string | undefined {
  if (!answers) {
    return undefined;
  }

  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return "Claude received answers to a user question.";
  }

  return entries
    .map(([question, value]) => `${question} -> ${formatAskUserQuestionAnswer(value)}`)
    .join("; ");
}

function formatAskUserQuestionAnswer(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatAskUserQuestionAnswer(item)).join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isTrueLike(value: unknown): boolean {
  return value === true || value === "true";
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

  if ("tool_name" in event && event.hook_event_name === "PermissionDenied") {
    return permissionRequestToken(event.tool_name, event.tool_input ?? {});
  }

  if ("agent_id" in event && typeof event.agent_id === "string" && event.agent_id.length > 0) {
    return event.agent_id;
  }

  if ("task_id" in event && typeof event.task_id === "string" && event.task_id.length > 0) {
    return event.task_id;
  }

  if ("elicitation_id" in event) {
    return event.elicitation_id ?? ("message" in event ? event.message : "none");
  }

  if ("reason" in event && typeof event.reason === "string" && event.reason.length > 0) {
    return event.reason;
  }

  if ("source" in event && typeof event.source === "string" && event.source.length > 0) {
    return event.source;
  }

  if ("error" in event && typeof event.error === "string" && event.error.length > 0) {
    return event.error;
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
    case "search":
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

  if (toolName === "search" || toolName === "grep" || toolName === "glob") {
    const pattern = readString(input.pattern);
    if (pattern) return pattern;
  }

  if (toolName === "websearch" || toolName === "toolsearch") {
    const query = readSearchQuery(input);
    if (query) return query;
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
    case "search":
      return "search code for";
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
    case "askuserquestion":
      return "ask";
    default:
      return `use ${event.tool_name}`;
  }
}

function permissionActionLabel(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "read":
      return "read";
    case "search":
      return "search code for";
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
    case "askuserquestion":
      return "ask";
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
  if (
    toolName === "read"
    || toolName === "search"
    || toolName === "grep"
    || toolName === "glob"
    || toolName === "ls"
  ) {
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

function subagentStopSummary(event: ClaudeCodeSubagentStopEvent): string {
  const direct = readString(event.last_assistant_message);
  if (direct) {
    const firstLine = direct
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine) {
      return `${event.agent_type} subagent finished: ${firstLine}`;
    }
  }

  return `${event.agent_type} subagent finished.`;
}

function stopFailureSummary(event: ClaudeCodeStopFailureEvent): string {
  return (
    readString(event.last_assistant_message)
    ?? readString(event.error_details)
    ?? `Claude Code API error: ${event.error}.`
  );
}

function sessionEndSummary(reason: ClaudeCodeSessionEndReason): string {
  switch (reason) {
    case "clear":
      return "Claude Code session ended after /clear.";
    case "resume":
      return "Claude Code session ended because another session was resumed.";
    case "logout":
      return "Claude Code session ended after logout.";
    case "prompt_input_exit":
      return "Claude Code session ended while prompt input was open.";
    case "bypass_permissions_disabled":
      return "Claude Code session ended after bypass permissions mode was disabled.";
    case "other":
      return "Claude Code session ended.";
  }
}

function taskLifecycleSummary(
  event: ClaudeCodeTaskCreatedEvent | ClaudeCodeTaskCompletedEvent,
  action: "created" | "completed",
): string {
  const details: string[] = [];
  if (event.task_description) {
    details.push(event.task_description);
  }
  if (event.teammate_name) {
    details.push(`${event.teammate_name} teammate`);
  }
  if (event.team_name) {
    details.push(`team ${event.team_name}`);
  }

  if (details.length === 0) {
    return `Task ${action}: ${event.task_subject}.`;
  }

  return `Task ${action}: ${event.task_subject}. ${details.join(" · ")}.`;
}

function looksLikeFollowUpQuestion(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? value.trim();
  const normalized = lastLine.replace(/[\s)\]}'"”]+$/, "");
  return /\?$/.test(normalized);
}

function toolInputContextItems(
  event: ClaudeCodePreToolUseEvent,
): ContextItem[] {
  const items: ContextItem[] = [];
  const input = event.tool_input;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 500) {
      items.push(createContextItem(key, contextLabel(key), value));
    }
  }
  return items;
}

function permissionInputContextItems(
  event: ClaudeCodePermissionRequestEvent,
): ContextItem[] {
  const items: ContextItem[] = [];
  for (const [key, value] of Object.entries(event.tool_input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 500) {
      items.push(createContextItem(key, contextLabel(key), value));
    }
  }
  return items;
}

function createContextItem(id: string, label: string, value: string): ContextItem {
  return { id, label, value };
}

function contextLabel(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0] ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function explicitRequestSemanticHints(
  request: HumanInputRequest,
  activityClass: SourceHumanInputRequestedEvent["activityClass"],
  whyNow: string,
): HumanInputSemanticHints {
  return {
    intentFrame: requestIntentFrame(request.kind),
    ...(activityClass !== undefined ? { activityClass } : {}),
    whyNow,
    confidence: "high",
  };
}

function followUpTaskSemanticHints(whyNow: string): TaskUpdateSemanticHints {
  return {
    intentFrame: "question_request",
    activityClass: "follow_up",
    whyNow,
    confidence: "high",
  };
}

function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    confidence: "high",
  };
}

function requestIntentFrame(
  kind: HumanInputRequest["kind"],
): "approval_request" | "question_request" | "form_request" {
  switch (kind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
}

function questionRequestWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked for input before continuing.`;
}

function followUpWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked a follow-up question and is waiting for a reply.`;
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

  if (toolName === "search" || toolName === "grep" || toolName === "glob") {
    const pattern = readString(input.pattern);
    if (pattern) return pattern;
  }

  if (toolName === "websearch" || toolName === "toolsearch") {
    const query = readSearchQuery(input);
    if (query) return query;
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
