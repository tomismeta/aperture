import type {
  AttentionConsequenceLevel as ConsequenceLevel,
  SourceEvent,
  SourceHumanInputRequestedEvent,
} from "@tomismeta/aperture-core";
import {
  mapAskUserQuestion,
  mapElicitation,
  mapElicitationResult,
  mapPermissionDenied,
  mapPermissionRequest,
  mapPostToolUse,
  mapPostToolUseFailure,
  mapPreToolUse,
} from "./mapping-requests.js";
import {
  mapConfigChange,
  mapCwdChanged,
  mapInstructionsLoaded,
  mapNotification,
  mapPostCompact,
  mapPreCompact,
  mapSessionEnd,
  mapSessionStart,
  mapStop,
  mapStopFailure,
  mapSubagentStart,
  mapSubagentStop,
  mapTaskCompleted,
  mapTaskCreated,
  mapTeammateIdle,
  mapUserPromptSubmit,
} from "./mapping-lifecycle.js";
import type { ClaudeCodeAskUserQuestionTranscriptPayload } from "./transcript.js";
export {
  mapClaudeCodeAskUserQuestionResponse,
  mapClaudeCodeFrameResponse,
} from "./mapping-response.js";
export { bashConsequence, classifyToolRisk } from "./mapping-shared.js";

export type ClaudeCodeHookEvent =
  | ClaudeCodeSessionStartEvent
  | ClaudeCodeInstructionsLoadedEvent
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
  | ClaudeCodeTeammateIdleEvent
  | ClaudeCodeConfigChangeEvent
  | ClaudeCodeCwdChangedEvent
  | ClaudeCodePreCompactEvent
  | ClaudeCodePostCompactEvent
  | ClaudeCodeSessionEndEvent
  | ClaudeCodeStopEvent;

export type ClaudeCodeHookEventName =
  | "SessionStart"
  | "InstructionsLoaded"
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
  | "TeammateIdle"
  | "ConfigChange"
  | "CwdChanged"
  | "PreCompact"
  | "PostCompact"
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

export type ClaudeCodeInstructionsMemoryType = "User" | "Project" | "Local" | "Managed";

export type ClaudeCodeInstructionsLoadReason =
  | "session_start"
  | "nested_traversal"
  | "path_glob_match"
  | "include"
  | "compact";

export type ClaudeCodeInstructionsLoadedEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "InstructionsLoaded";
  file_path: string;
  memory_type: ClaudeCodeInstructionsMemoryType;
  load_reason: ClaudeCodeInstructionsLoadReason;
  globs?: string[];
  trigger_file_path?: string;
  parent_file_path?: string;
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

export type ClaudeCodeTeammateIdleEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "TeammateIdle";
  teammate_name: string;
  team_name: string;
};

export type ClaudeCodeConfigSource =
  | "user_settings"
  | "project_settings"
  | "local_settings"
  | "policy_settings"
  | "skills";

export type ClaudeCodeConfigChangeEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "ConfigChange";
  source: ClaudeCodeConfigSource;
  file_path?: string;
};

export type ClaudeCodeCwdChangedEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "CwdChanged";
  old_cwd: string;
  new_cwd: string;
};

export type ClaudeCodeCompactTrigger = "manual" | "auto";

export type ClaudeCodePreCompactEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PreCompact";
  trigger: ClaudeCodeCompactTrigger;
  custom_instructions: string;
};

export type ClaudeCodePostCompactEvent = ClaudeCodeHookBaseEvent & {
  hook_event_name: "PostCompact";
  trigger: ClaudeCodeCompactTrigger;
  compact_summary: string;
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

const DEFAULT_TOOLS: string[] | undefined = undefined;

export function mapClaudeCodeHookEvent(
  event: ClaudeCodeHookEvent,
  options: ClaudeCodeMappingOptions = {},
): SourceEvent[] {
  const tools = options.tools ?? DEFAULT_TOOLS;

  switch (event.hook_event_name) {
    case "SessionStart":
      return [mapSessionStart(event)];
    case "InstructionsLoaded":
      return [mapInstructionsLoaded(event)];
    case "PreToolUse":
      if (tools && !tools.includes(event.tool_name)) {
        return [];
      }
      if (event.tool_name === "AskUserQuestion" && event.askUserQuestion?.questions.length) {
        return [mapAskUserQuestion(event)];
      }
      return [mapPreToolUse(event, options)];
    case "PermissionRequest":
      return !tools || tools.includes(event.tool_name)
        ? [mapPermissionRequest(event, options)]
        : [];
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
    case "TeammateIdle":
      return [mapTeammateIdle(event)];
    case "ConfigChange":
      return [mapConfigChange(event)];
    case "CwdChanged":
      return [mapCwdChanged(event)];
    case "PreCompact":
      return [mapPreCompact(event)];
    case "PostCompact":
      return [mapPostCompact(event)];
    case "SessionEnd":
      return [mapSessionEnd(event)];
    case "Stop":
      return mapStop(event);
  }
}
