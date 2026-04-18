import type {
  HumanInputRequest,
  SourceHumanInputRequestedEvent,
  SourceTaskCompletedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import {
  buildAskUserQuestionRequest,
  buildElicitationRequest,
  elicitationSummary,
  singleTextFieldId,
} from "./mapping-human-input.js";
import { summarizeAskUserQuestionAnswers } from "./mapping-response.js";
import type {
  ClaudeCodeElicitationEvent,
  ClaudeCodeElicitationResultEvent,
  ClaudeCodeMappingOptions,
  ClaudeCodePermissionDeniedEvent,
  ClaudeCodePermissionRequestEvent,
  ClaudeCodePostToolUseEvent,
  ClaudeCodePostToolUseFailureEvent,
  ClaudeCodePreToolUseEvent,
} from "./mapping.js";
import {
  approvalTitle,
  claudeElicitationInteractionId,
  claudeEventId,
  claudeInteractionId,
  claudePermissionInteractionId,
  claudeSource,
  claudeTaskId,
  claudeToolFamily,
  classifyPermissionRequestRisk,
  classifyToolRisk,
  createContextItem,
  claudeRuntimeContextItems,
  elicitationToken,
  explicitRequestSemanticHints,
  nowIso,
  permissionDeniedSummary,
  permissionDeniedTitle,
  permissionInputContextItems,
  permissionRequestTitle,
  questionRequestWhyNow,
  readString,
  summarizeToolInput,
  taskActivitySemanticHints,
  toolInputContextItems,
  type ContextItem,
} from "./mapping-shared.js";

export function mapPreToolUse(
  event: ClaudeCodePreToolUseEvent,
  options: ClaudeCodeMappingOptions,
): SourceHumanInputRequestedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const command = readString(event.tool_input.command);
  const summary = command ?? summarizeToolInput(event.tool_name, event.tool_input);
  const whyNow =
    readString(event.tool_input.description) ??
    `Claude Code requested approval before running ${event.tool_name}.`;

  const contextItems: ContextItem[] = command
    ? [createContextItem("command", "Command", command)]
    : toolInputContextItems(event.tool_input);
  contextItems.push(createContextItem("cwd", "Working Directory", event.cwd));
  contextItems.push(...claudeRuntimeContextItems(event));

  const consequence = classifyToolRisk(event, options);
  const request: HumanInputRequest = {
    kind: "approval",
  };

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudeInteractionId(event.session_id, event.tool_use_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    title: approvalTitle(event.tool_name, event.tool_input, summary),
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

export function mapAskUserQuestion(
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
  contextItems.push(...claudeRuntimeContextItems(event));

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudeInteractionId(event.session_id, event.tool_use_id),
    timestamp: nowIso(),
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

export function mapPermissionRequest(
  event: ClaudeCodePermissionRequestEvent,
  options: ClaudeCodeMappingOptions,
): SourceHumanInputRequestedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const command = readString(event.tool_input.command);
  const firstQuestion = event.askUserQuestion?.questions[0];
  const summary =
    command ?? firstQuestion?.question ?? summarizeToolInput(event.tool_name, event.tool_input);
  const whyNow =
    readString(event.tool_input.description) ??
    (firstQuestion
      ? "Claude needs permission before asking the operator a question."
      : `Claude Code is asking for permission before running ${event.tool_name}.`);

  const contextItems: ContextItem[] = command
    ? [createContextItem("command", "Command", command)]
    : permissionInputContextItems(event.tool_input);

  if (firstQuestion?.header) {
    contextItems.unshift(createContextItem("header", "Header", firstQuestion.header));
  }
  contextItems.push(createContextItem("cwd", "Working Directory", event.cwd));
  if (event.permission_suggestions?.length) {
    contextItems.push(
      createContextItem(
        "nativeSuggestions",
        "Native Suggestions",
        `${event.permission_suggestions.length} native permission suggestion${event.permission_suggestions.length === 1 ? "" : "s"}`,
      ),
    );
  }
  contextItems.push(...claudeRuntimeContextItems(event));

  const consequence = classifyPermissionRequestRisk(event, options);
  const request: HumanInputRequest = {
    kind: "approval",
  };

  return {
    id: claudeEventId(event, "human.input.requested"),
    type: "human.input.requested",
    taskId: claudeTaskId(event.session_id),
    interactionId: claudePermissionInteractionId(
      event.session_id,
      event.tool_name,
      event.tool_input,
    ),
    timestamp: nowIso(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    title: permissionRequestTitle(event.tool_name, event.tool_input, summary),
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

export function mapPermissionDenied(
  event: ClaudeCodePermissionDeniedEvent,
): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const whyNow =
    "Claude Code auto mode denied a tool call and may need different guidance before it can continue.";
  const contextItems = claudeRuntimeContextItems(event);

  const update: SourceTaskUpdatedEvent = {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "permission_request",
    semanticHints: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow,
      confidence: "high",
    },
    title: permissionDeniedTitle(event.tool_name, event.tool_input),
    summary: permissionDeniedSummary(event.tool_name, event.tool_input),
    status: "blocked",
  };
  if (contextItems.length > 0) {
    update.context = { items: contextItems };
  }
  return update;
}

export function mapPostToolUseFailure(
  event: ClaudeCodePostToolUseFailureEvent,
): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "tool_failure",
    title: `${event.tool_name} failed`,
    summary: event.error,
    status: "failed",
  };
}

export function mapPostToolUse(event: ClaudeCodePostToolUseEvent): SourceTaskUpdatedEvent {
  const toolFamily = claudeToolFamily(event.tool_name);
  const answerSummary = summarizeAskUserQuestionAnswers(event.askUserQuestion?.answers);
  const summary =
    answerSummary ??
    readString(event.tool_response?.message) ??
    `${event.tool_name} completed successfully.`;

  return {
    id: claudeEventId(event, "task.updated"),
    type: "task.updated",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    activityClass: "tool_completion",
    semanticHints: taskActivitySemanticHints("tool_completion"),
    title: `${event.tool_name} completed`,
    summary,
    status: "running",
  };
}

export function mapElicitation(event: ClaudeCodeElicitationEvent): SourceHumanInputRequestedEvent {
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
    timestamp: nowIso(),
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

export function mapElicitationResult(
  event: ClaudeCodeElicitationResultEvent,
): SourceTaskCompletedEvent {
  return {
    id: claudeEventId(event, "task.completed"),
    type: "task.completed",
    taskId: claudeTaskId(event.session_id),
    timestamp: nowIso(),
    source: claudeSource(event),
    summary: `Claude ${elicitationActionPastTense(event.action)} an input request for ${event.mcp_server_name}.`,
  };
}

function elicitationActionPastTense(action: ClaudeCodeElicitationResultEvent["action"]): string {
  switch (action) {
    case "accept":
      return "accepted";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
  }
}
