import type {
  AttentionResponse,
  SourceEvent,
  SourceHumanInputRequestedEvent,
} from "@tomismeta/aperture-core";

import type {
  CodexCommandExecutionApprovalDecision,
  CodexCommandExecutionRequestApprovalParams,
  CodexFileChangeApprovalDecision,
  CodexFileChangeRequestApprovalParams,
  CodexItemCompletedNotification,
  CodexItemStartedNotification,
  CodexServerNotification,
  CodexServerRequest,
  CodexThreadStartedNotification,
  CodexThreadStatusChangedNotification,
  CodexToolRequestUserInputParams,
  CodexTurnCompletedNotification,
  CodexTurnStartedNotification,
  JsonRpcId,
} from "./protocol.js";

export type CodexMappingContext = {
  sourceLabel?: string;
};

export type CodexMappedRequest = {
  interactionId: string;
  taskId: string;
  events: SourceEvent[];
};

export type CodexResponsePayload =
  | {
      decision: CodexCommandExecutionApprovalDecision | CodexFileChangeApprovalDecision;
    }
  | {
      answers: Record<string, { answers: string[] }>;
    };

type ParsedInteractionId =
  | {
      kind: "commandApproval";
      requestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      approvalId?: string;
    }
  | {
      kind: "fileChangeApproval";
      requestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
    }
  | {
      kind: "userInput";
      requestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
    };

export function mapCodexServerRequest(
  request: CodexServerRequest,
  context: CodexMappingContext = {},
): CodexMappedRequest | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return mapCommandApprovalRequest(request.id, request.params, context);
    case "item/fileChange/requestApproval":
      return mapFileChangeApprovalRequest(request.id, request.params, context);
    case "item/tool/requestUserInput":
      return mapToolRequestUserInputRequest(request.id, request.params, context);
  }
}

export function mapCodexNotification(
  notification: CodexServerNotification,
  context: CodexMappingContext = {},
): SourceEvent[] {
  switch (notification.method) {
    case "thread/started":
      return [mapThreadStarted(notification.params, context)];
    case "thread/status/changed":
      return [mapThreadStatusChanged(notification.params, context)];
    case "turn/started":
      return [mapTurnStarted(notification.params, context)];
    case "turn/completed":
      return [mapTurnCompleted(notification.params, context)];
    case "item/started":
      return mapItemStarted(notification.params, context);
    case "item/completed":
      return mapItemCompleted(notification.params, context);
    default:
      return [];
  }
}

export function mapCodexResponse(
  response: AttentionResponse,
  request: CodexServerRequest,
): CodexResponsePayload | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        decision: mapCommandApprovalDecision(response),
      };
    case "item/fileChange/requestApproval":
      return {
        decision: mapFileChangeApprovalDecision(response),
      };
    case "item/tool/requestUserInput":
      return {
        answers: mapToolRequestAnswers(response, request.params),
      };
  }
}

export function parseCodexInteractionId(interactionId: string): ParsedInteractionId | null {
  const parts = interactionId.split(":");
  if (parts.length < 6 || parts[0] !== "codex") {
    return null;
  }
  const [_, kind, requestId, threadId, turnId, itemId, extra] = parts;
  if (!kind || !requestId || !threadId || !turnId || !itemId) {
    return null;
  }
  switch (kind) {
    case "commandApproval":
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(turnId),
        itemId: decodeURIComponent(itemId),
        ...(extra ? { approvalId: decodeURIComponent(extra) } : {}),
      };
    case "fileChangeApproval":
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(turnId),
        itemId: decodeURIComponent(itemId),
      };
    case "userInput":
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(turnId),
        itemId: decodeURIComponent(itemId),
      };
    default:
      return null;
  }
}

function mapCommandApprovalRequest(
  requestId: JsonRpcId,
  params: CodexCommandExecutionRequestApprovalParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexTurnTaskId(params.threadId, params.turnId);
  const interactionId = codexInteractionId(
    "commandApproval",
    requestId,
    params.threadId,
    params.turnId,
    params.itemId,
    params.approvalId ?? undefined,
  );
  const contextItems = [
    params.command ? { id: "command", label: "Command", value: params.command } : null,
    params.cwd ? { id: "cwd", label: "Working directory", value: params.cwd } : null,
    params.reason ? { id: "reason", label: "Reason", value: params.reason } : null,
    params.networkApprovalContext
      ? {
          id: "networkApprovalContext",
          label: "Network approval context",
          value: JSON.stringify(params.networkApprovalContext),
        }
      : null,
  ].filter((item): item is { id: string; label: string; value: string } => item !== null);

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.itemId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    toolFamily: "bash",
    activityClass: "permission_request",
    title: "Approve Codex command",
    summary: params.reason ?? "Codex requested approval before running a command.",
    request: {
      kind: "approval",
    },
    ...(contextItems.length > 0 ? { context: { items: contextItems } } : {}),
    ...(params.reason ? { provenance: { whyNow: params.reason } } : {}),
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapFileChangeApprovalRequest(
  requestId: JsonRpcId,
  params: CodexFileChangeRequestApprovalParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexTurnTaskId(params.threadId, params.turnId);
  const interactionId = codexInteractionId(
    "fileChangeApproval",
    requestId,
    params.threadId,
    params.turnId,
    params.itemId,
  );
  const contextItems = [
    params.grantRoot ? { id: "grantRoot", label: "Grant root", value: params.grantRoot } : null,
  ].filter((item): item is { id: string; label: string; value: string } => item !== null);

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.itemId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    toolFamily: "write",
    activityClass: "permission_request",
    title: "Approve Codex file changes",
    summary: params.reason ?? "Codex requested approval before applying file changes.",
    request: {
      kind: "approval",
    },
    ...(contextItems.length > 0 ? { context: { items: contextItems } } : {}),
    ...(params.reason ? { provenance: { whyNow: params.reason } } : {}),
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapToolRequestUserInputRequest(
  requestId: JsonRpcId,
  params: CodexToolRequestUserInputParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexTurnTaskId(params.threadId, params.turnId);
  const interactionId = codexInteractionId(
    "userInput",
    requestId,
    params.threadId,
    params.turnId,
    params.itemId,
  );

  const singleQuestion = params.questions.length === 1 ? params.questions[0] : null;
  const isSingleChoice = !!singleQuestion && Array.isArray(singleQuestion.options) && singleQuestion.options.length > 0;

  if (singleQuestion && isSingleChoice) {
    const event: SourceHumanInputRequestedEvent = {
      id: codexEventId(requestId, "human.input.requested", params.itemId),
      type: "human.input.requested",
      taskId,
      interactionId,
      timestamp: new Date().toISOString(),
      source: codexSource(params.threadId, context),
      activityClass: "question_request",
      title: singleQuestion.header || "Codex needs input",
      summary: singleQuestion.question,
      request: {
        kind: "choice",
        selectionMode: "single",
        allowTextResponse: singleQuestion.isOther,
        options: (singleQuestion.options ?? []).map((option) => ({
          id: slugifyOption(option.label),
          label: option.label,
          ...(option.description ? { summary: option.description } : {}),
        })),
      },
    };
    return {
      interactionId,
      taskId,
      events: [event],
    };
  }

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.itemId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    activityClass: "question_request",
    title: singleQuestion?.header || "Codex needs input",
    summary: singleQuestion?.question ?? "Codex requested additional information before continuing.",
    request: {
      kind: "form",
      fields: params.questions.map((question) => ({
        id: question.id,
        label: question.header || question.question,
        type: question.options && question.options.length > 0 ? "select" : question.isSecret ? "textarea" : "text",
        required: true,
        ...(question.options && question.options.length > 0
          ? {
              options: question.options.map((option) => ({
                value: option.label,
                label: option.label,
              })),
            }
          : {}),
      })),
    },
  };
  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapThreadStarted(
  notification: CodexThreadStartedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.thread.id)}:task.started`,
    type: "task.started",
    taskId: codexThreadTaskId(notification.thread.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.thread.id, context),
    title: notification.thread.name ?? "Codex thread started",
    ...withOptionalSummary(notification.thread.preview || undefined),
  };
}

function mapThreadStatusChanged(
  notification: CodexThreadStatusChangedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:task.updated:thread-status`,
    type: "task.updated",
    taskId: codexThreadTaskId(notification.threadId),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "session_status",
    title: "Codex thread status changed",
    summary: describeThreadStatus(notification.status),
    status: notification.status.type === "active" ? "running" : "waiting",
  };
}

function mapTurnStarted(
  notification: CodexTurnStartedNotification,
  context: CodexMappingContext,
): SourceEvent {
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turn.id)}:task.updated:turn-started`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turn.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: "session_status",
    title: "Codex turn started",
    summary: "Codex began working on the current turn.",
    status: "running",
  };
}

function mapTurnCompleted(
  notification: CodexTurnCompletedNotification,
  context: CodexMappingContext,
): SourceEvent {
  const failed = notification.turn.status === "failed";
  return {
    id: `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turn.id)}:task.updated:turn-completed`,
    type: "task.updated",
    taskId: codexTurnTaskId(notification.threadId, notification.turn.id),
    timestamp: new Date().toISOString(),
    source: codexSource(notification.threadId, context),
    activityClass: failed ? "tool_failure" : "tool_completion",
    title: failed ? "Codex turn failed" : "Codex turn completed",
    summary: failed
      ? "Codex ended the turn with an error."
      : "Codex finished the current turn.",
    status: failed ? "failed" : "completed",
  };
}

function mapItemStarted(
  notification: CodexItemStartedNotification,
  context: CodexMappingContext,
): SourceEvent[] {
  if (isEnteredReviewModeItem(notification.item)) {
    return [{
      id: codexItemEventId(notification, "task.updated", "review-entered"),
      type: "task.updated",
      taskId: codexTurnTaskId(notification.threadId, notification.turnId),
      timestamp: new Date().toISOString(),
      source: codexSource(notification.threadId, context),
      activityClass: "session_status",
      title: "Codex review started",
      ...withOptionalSummary(notification.item.review),
      status: "running",
    }];
  }
  return [];
}

function mapItemCompleted(
  notification: CodexItemCompletedNotification,
  context: CodexMappingContext,
): SourceEvent[] {
  if (isCommandExecutionItem(notification.item)) {
    const failed = notification.item.status === "failed";
    const declined = notification.item.status === "declined";
    return [{
      id: codexItemEventId(notification, "task.updated", "command-execution"),
      type: "task.updated",
      taskId: codexTurnTaskId(notification.threadId, notification.turnId),
      timestamp: new Date().toISOString(),
      source: codexSource(notification.threadId, context),
      toolFamily: "bash",
      activityClass: failed ? "tool_failure" : "tool_completion",
      title: failed ? "Codex command failed" : declined ? "Codex command declined" : "Codex command completed",
      ...withOptionalSummary(notification.item.command),
      status: failed ? "failed" : "completed",
    }];
  }

  if (isFileChangeItem(notification.item)) {
    const failed = notification.item.status === "failed";
    const declined = notification.item.status === "declined";
    const summary =
      notification.item.changes.length > 0
        ? `${notification.item.changes.length} file change(s)`
        : undefined;
    return [{
      id: codexItemEventId(notification, "task.updated", "file-change"),
      type: "task.updated",
      taskId: codexTurnTaskId(notification.threadId, notification.turnId),
      timestamp: new Date().toISOString(),
      source: codexSource(notification.threadId, context),
      toolFamily: "write",
      activityClass: failed ? "tool_failure" : "tool_completion",
      title: failed ? "Codex file changes failed" : declined ? "Codex file changes declined" : "Codex file changes completed",
      ...withOptionalSummary(summary),
      status: failed ? "failed" : "completed",
    }];
  }

  if (isExitedReviewModeItem(notification.item)) {
    return [{
      id: codexItemEventId(notification, "task.updated", "review-exited"),
      type: "task.updated",
      taskId: codexTurnTaskId(notification.threadId, notification.turnId),
      timestamp: new Date().toISOString(),
      source: codexSource(notification.threadId, context),
      activityClass: "tool_completion",
      title: "Codex review completed",
      ...withOptionalSummary(notification.item.review),
      status: "completed",
    }];
  }

  return [];
}

function mapCommandApprovalDecision(response: AttentionResponse): CodexCommandExecutionApprovalDecision {
  switch (response.response.kind) {
    case "approved":
      return "accept";
    case "rejected":
      return "decline";
    case "dismissed":
    case "acknowledged":
      return "cancel";
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return "cancel";
  }
}

function mapFileChangeApprovalDecision(response: AttentionResponse): CodexFileChangeApprovalDecision {
  switch (response.response.kind) {
    case "approved":
      return "accept";
    case "rejected":
      return "decline";
    case "dismissed":
    case "acknowledged":
      return "cancel";
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return "cancel";
  }
}

function mapToolRequestAnswers(
  response: AttentionResponse,
  params: CodexToolRequestUserInputParams,
): Record<string, { answers: string[] }> {
  if (response.response.kind === "option_selected") {
    const question = params.questions[0];
    return question ? { [question.id]: { answers: response.response.optionIds } } : {};
  }

  if (response.response.kind === "text_submitted") {
    const question = params.questions[0];
    return question ? { [question.id]: { answers: [response.response.text] } } : {};
  }

  if (response.response.kind === "form_submitted") {
    const answers: Record<string, { answers: string[] }> = {};
    for (const question of params.questions) {
      answers[question.id] = {
        answers: normalizeAnswer(response.response.values[question.id]),
      };
    }
    return answers;
  }

  const answers: Record<string, { answers: string[] }> = {};
  for (const question of params.questions) {
    answers[question.id] = { answers: [] };
  }
  return answers;
}

function codexSource(threadId: string, context: CodexMappingContext) {
  return {
    id: `codex:${encodeURIComponent(threadId)}`,
    kind: "codex",
    ...(context.sourceLabel ? { label: context.sourceLabel } : {}),
  };
}

function withOptionalSummary(summary: string | undefined): { summary?: string } {
  return summary ? { summary } : {};
}

function isCommandExecutionItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "commandExecution" }> {
  return item.type === "commandExecution" && typeof item.command === "string" && typeof item.status === "string";
}

function isFileChangeItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "fileChange" }> {
  return item.type === "fileChange" && Array.isArray(item.changes) && typeof item.status === "string";
}

function isEnteredReviewModeItem(
  item: CodexItemStartedNotification["item"],
): item is Extract<CodexItemStartedNotification["item"], { type: "enteredReviewMode" }> {
  return item.type === "enteredReviewMode" && typeof item.review === "string";
}

function isExitedReviewModeItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "exitedReviewMode" }> {
  return item.type === "exitedReviewMode" && typeof item.review === "string";
}

function codexThreadTaskId(threadId: string): string {
  return `codex:thread:${encodeURIComponent(threadId)}`;
}

function codexTurnTaskId(threadId: string, turnId: string): string {
  return `codex:thread:${encodeURIComponent(threadId)}:turn:${encodeURIComponent(turnId)}`;
}

function codexInteractionId(
  kind: ParsedInteractionId["kind"],
  requestId: JsonRpcId,
  threadId: string,
  turnId: string,
  itemId: string,
  extra?: string,
): string {
  return [
    "codex",
    kind,
    encodeURIComponent(String(requestId)),
    encodeURIComponent(threadId),
    encodeURIComponent(turnId),
    encodeURIComponent(itemId),
    ...(extra ? [encodeURIComponent(extra)] : []),
  ].join(":");
}

function codexEventId(requestId: JsonRpcId, type: SourceEvent["type"], itemId: string): string {
  return `codex:${encodeURIComponent(String(requestId))}:${encodeURIComponent(itemId)}:${type}`;
}

function codexItemEventId(
  notification: CodexItemStartedNotification | CodexItemCompletedNotification,
  type: SourceEvent["type"],
  suffix: string,
): string {
  return `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turnId)}:${encodeURIComponent(notification.item.id)}:${type}:${suffix}`;
}

function describeThreadStatus(status: { type: string; activeFlags?: string[] }): string {
  if (status.type !== "active" || !status.activeFlags || status.activeFlags.length === 0) {
    return status.type;
  }
  return `${status.type}: ${status.activeFlags.join(", ")}`;
}

function normalizeAnswer(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeAnswer(entry));
  }
  if (value == null) {
    return [];
  }
  return [JSON.stringify(value)];
}

function slugifyOption(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "option";
}
