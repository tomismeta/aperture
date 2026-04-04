import type {
  AttentionResponse,
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  OpencodeDirectoryScope,
  OpencodeMessageRole,
  OpencodeMessagePartUpdatedEvent,
  OpencodePermissionAskedEvent,
  OpencodePermissionDecision,
  OpencodeQuestionAskedEvent,
  OpencodeQuestionPrompt,
  OpencodeSseMessage,
  OpencodeToolCallPattern,
} from "./types.js";

export type OpencodeMappingContext = {
  baseUrl: string;
  scope?: OpencodeDirectoryScope;
  sourceLabel?: string;
  messageRole?: OpencodeMessageRole;
};

export type OpencodeResponseAction =
  | {
      kind: "permission.reply";
      requestId: string;
      body: {
        reply: "once" | "reject";
        message?: string;
      };
    }
  | {
      kind: "question.reply";
      requestId: string;
      body: {
        answers: string[][];
      };
    }
  | {
      kind: "question.reject";
      requestId: string;
      body: {
        message?: string;
      };
    }
  | {
      kind: "session.prompt";
      sessionId: string;
      body: {
        parts: Array<{
          type: "text";
          text: string;
          metadata?: Record<string, unknown>;
        }>;
      };
    };

export type OpencodeNativeResolution = {
  response: AttentionResponse;
};

type ContextItem = NonNullable<NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]>[number];
type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

type ParsedInteractionId =
  | {
      kind: "permission";
      instanceKey: string;
      requestId: string;
    }
  | {
      kind: "question";
      instanceKey: string;
      requestId: string;
    }
  | {
      kind: "followup";
      instanceKey: string;
      sessionId: string;
      partId: string;
    };

export function mapOpencodeEvent(
  event: OpencodeSseMessage,
  context: OpencodeMappingContext,
): SourceEvent[] {
  switch (event.type) {
    case "permission.asked":
      return [mapPermissionAsked(event as Extract<OpencodeSseMessage, { type: "permission.asked" }>, context)];
    case "question.asked":
      return [mapQuestionAsked(event as Extract<OpencodeSseMessage, { type: "question.asked" }>, context)];
    case "session.status":
      return mapSessionStatus(event as Extract<OpencodeSseMessage, { type: "session.status" }>, context);
    case "message.part.updated":
      return mapMessagePartUpdated(event as Extract<OpencodeSseMessage, { type: "message.part.updated" }>, context);
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
    case "server.connected":
    case "server.heartbeat":
      return [];
    default:
      return [];
  }
}

export function mapOpencodeNativeResolution(
  event: OpencodeSseMessage,
  context: OpencodeMappingContext,
): OpencodeNativeResolution | null {
  const instanceKey = createOpencodeInstanceKey(context);
  switch (event.type) {
    case "permission.replied": {
      const requestId = readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(instanceKey, readString(event.properties.sessionID), requestId);
      const interactionId = opencodeInteractionId(instanceKey, "permission", requestId);
      const reply = normalizePermissionDecision(event.properties.reply);
      return {
        response: {
          taskId,
          interactionId,
          response: reply === "reject"
            ? rejectedResponse(readString(event.properties.message))
            : { kind: "approved" },
        },
      };
    }
    case "question.replied": {
      const requestId = readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(instanceKey, readString(event.properties.sessionID), requestId);
      const interactionId = opencodeInteractionId(instanceKey, "question", requestId);
      return {
        response: {
          taskId,
          interactionId,
          response: { kind: "acknowledged" },
        },
      };
    }
    case "question.rejected": {
      const requestId = readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(instanceKey, readString(event.properties.sessionID), requestId);
      const interactionId = opencodeInteractionId(instanceKey, "question", requestId);
      return {
        response: {
          taskId,
          interactionId,
          response: rejectedResponse(readString(event.properties.message)),
        },
      };
    }
    default:
      return null;
  }
}

export function mapOpencodeResponse(response: AttentionResponse): OpencodeResponseAction | null {
  const parsed = parseOpencodeInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "permission") {
    switch (response.response.kind) {
      case "approved":
        // V1 intentionally uses the safer session-local approval path.
        // OpenCode also supports reply: "always", but Aperture should only
        // expose that once it has an explicit surface-level policy choice.
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          body: { reply: "once" },
        };
      case "rejected":
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          body: {
            reply: "reject",
            message: response.response.reason ?? "Rejected in Aperture.",
          },
        };
      case "dismissed":
      case "acknowledged":
        // OpenCode permissions are blocking and require a concrete decision.
        // Treat non-decisive responses conservatively so the request does not
        // stay pending while Aperture makes it look resolved.
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          body: {
            reply: "reject",
            message: "Dismissed in Aperture.",
          },
        };
      case "option_selected":
      case "form_submitted":
        return null;
    }
  }

  if (parsed.kind === "followup") {
    switch (response.response.kind) {
      case "text_submitted": {
        const text = response.response.text.trim();
        if (text.length === 0) {
          return null;
        }
        return followUpSessionPrompt(parsed.sessionId, text);
      }
      case "form_submitted": {
        const text = extractFollowUpReplyText(response.response.values);
        return text ? followUpSessionPrompt(parsed.sessionId, text) : null;
      }
      case "approved":
      case "acknowledged":
      case "rejected":
      case "dismissed":
      case "option_selected":
        return null;
    }
  }

  switch (response.response.kind) {
    case "option_selected":
      // V1 ingress only produces choice-mode questions for a single prompt,
      // so the selected options intentionally occupy a single answer group.
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: [response.response.optionIds],
        },
      };
    case "text_submitted":
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: [[response.response.text]],
        },
      };
    case "form_submitted":
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: Object.values(response.response.values).map((value) => normalizeAnswerGroup(value)),
        },
      };
    case "rejected":
    case "dismissed":
      return {
        kind: "question.reject",
        requestId: parsed.requestId,
        body: {
          ...(response.response.kind === "rejected" && response.response.reason
            ? { message: response.response.reason }
            : {}),
        },
      };
    case "approved":
    case "acknowledged":
      return null;
  }
}

export function createOpencodeInstanceKey(context: Pick<OpencodeMappingContext, "baseUrl" | "scope">): string {
  const base = new URL(context.baseUrl);
  const scope = context.scope?.directory?.trim() ?? "";
  return encodeURIComponent(`${base.origin}${base.pathname.replace(/\/+$/, "")}|${scope}`);
}

export function opencodeTaskId(instanceKey: string, sessionId?: string, fallbackId?: string): string {
  const anchor = sessionId?.trim() || fallbackId?.trim() || "unknown";
  return `opencode:${instanceKey}:session:${encodeURIComponent(anchor)}`;
}

export function opencodeInteractionId(
  instanceKey: string,
  kind: "permission" | "question",
  requestId: string,
): string {
  return `opencode:${instanceKey}:${kind}:${encodeURIComponent(requestId)}`;
}

export function parseOpencodeInteractionId(interactionId: string): ParsedInteractionId | null {
  const match = interactionId.match(/^opencode:([^:]+):(permission|question|followup):(.+)$/);
  if (!match) {
    return null;
  }
  const [, instanceKey, kind, requestId] = match;
  if (!instanceKey || !requestId) {
    return null;
  }
  if (kind === "permission") {
    return { kind, instanceKey, requestId: decodeURIComponent(requestId) };
  }
  if (kind === "question") {
    return { kind: "question", instanceKey, requestId: decodeURIComponent(requestId) };
  }
  const [encodedSessionId, encodedPartId = "latest"] = requestId.split("|", 2);
  if (!encodedSessionId) {
    return null;
  }
  return {
    kind: "followup",
    instanceKey,
    sessionId: decodeURIComponent(encodedSessionId),
    partId: decodeURIComponent(encodedPartId),
  };
}

function mapPermissionAsked(
  event: OpencodePermissionAskedEvent,
  context: OpencodeMappingContext,
): SourceHumanInputRequestedEvent {
  const instanceKey = createOpencodeInstanceKey(context);
  const requestId = event.properties.id;
  const sessionId = readString(event.properties.sessionID) ?? readString(event.properties.metadata?.sessionID);
  const tool = readString(event.properties.permission) ?? readString(event.properties.metadata?.tool);
  const declaredTitle =
    readString(event.properties.title)
    ?? readString(event.properties.metadata?.title);
  const description = readString(event.properties.metadata?.description);
  const patternText = patternSummary(event.properties.patterns ?? event.properties.metadata?.patterns);
  const summary =
    inferPermissionSummary({
      tool,
      title: declaredTitle,
      message: readString(event.properties.message),
      description,
      patternText,
    })
    ?? "OpenCode requested approval before continuing.";
  const title = approvalTitle(tool, summary, declaredTitle);
  const whyNow = description
    ?? "OpenCode paused and needs a human approval decision.";

  const contextItems = [
    contextItem(detailFieldId(tool), detailFieldLabel(tool), preferredContextValue(tool, patternText, summary)),
    contextItem("cwd", "Working Directory", context.scope?.directory),
    contextItem("callId", "Call ID", readString(event.properties.tool?.callID) ?? readString(event.properties.metadata?.callID)),
  ].filter((item): item is ContextItem => item !== null);

  const result: SourceHumanInputRequestedEvent = {
    id: `opencode:${instanceKey}:event:permission.asked:${encodeURIComponent(requestId)}`,
    type: "human.input.requested",
    taskId: opencodeTaskId(instanceKey, sessionId, requestId),
    interactionId: opencodeInteractionId(instanceKey, "permission", requestId),
    timestamp: event.properties.createdAt ?? new Date().toISOString(),
    source: {
      id: `opencode:${instanceKey}`,
      kind: "opencode",
      label: context.sourceLabel ?? "OpenCode",
    },
    toolFamily: opencodeToolFamily(tool),
    activityClass: "permission_request",
    title,
    summary,
    request: {
      kind: "approval",
      requireReason: false,
    },
    semanticHints: explicitRequestSemanticHints("approval", "permission_request", whyNow),
    provenance: {
      whyNow,
    },
    riskHint: "medium",
  };
  if (contextItems.length > 0) {
    result.context = { items: contextItems };
  }
  return result;
}

function mapQuestionAsked(
  event: OpencodeQuestionAskedEvent,
  context: OpencodeMappingContext,
): SourceHumanInputRequestedEvent {
  const instanceKey = createOpencodeInstanceKey(context);
  const requestId = event.properties.id;
  const sessionId = readString(event.properties.sessionID);
  const prompts = event.properties.questions ?? [];
  const title =
    readString(event.properties.title)
    ?? prompts[0]?.header
    ?? prompts[0]?.label
    ?? "OpenCode needs input";
  const derivedSummary = prompts
    .map((prompt) => prompt.question ?? prompt.prompt ?? prompt.label ?? prompt.header)
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const summary =
    readString(event.properties.message)
    ?? (derivedSummary !== "" ? derivedSummary : undefined)
    ?? "OpenCode asked a question before continuing.";

  const request = promptsToRequest(prompts);
  const contextItems = [
    contextItem("sessionId", "Session ID", sessionId),
    contextItem("questionCount", "Question Count", String(prompts.length || 1)),
    contextItem("callId", "Call ID", readString(event.properties.tool?.callID)),
  ].filter((item): item is ContextItem => item !== null);

  const result: SourceHumanInputRequestedEvent = {
    id: `opencode:${instanceKey}:event:question.asked:${encodeURIComponent(requestId)}`,
    type: "human.input.requested",
    taskId: opencodeTaskId(instanceKey, sessionId, requestId),
    interactionId: opencodeInteractionId(instanceKey, "question", requestId),
    timestamp: event.properties.createdAt ?? new Date().toISOString(),
    source: {
      id: `opencode:${instanceKey}`,
      kind: "opencode",
      label: context.sourceLabel ?? "OpenCode",
    },
    toolFamily: "opencode",
    activityClass: "question_request",
    title,
    summary,
    request,
    semanticHints: explicitRequestSemanticHints(request.kind, "question_request", "OpenCode paused and needs a human answer before continuing."),
    provenance: {
      whyNow: "OpenCode paused and needs a human answer before continuing.",
    },
    riskHint: "medium",
  };
  if (contextItems.length > 0) {
    result.context = { items: contextItems };
  }
  return result;
}

function mapSessionStatus(event: Extract<OpencodeSseMessage, { type: "session.status" }>, context: OpencodeMappingContext): SourceEvent[] {
  const instanceKey = createOpencodeInstanceKey(context);
  const sessionId = readString(event.properties.sessionID);
  const status = normalizeTaskStatus(readSessionStatus(event.properties.status));
  if (!sessionId || !status) {
    return [];
  }

  const update: SourceEvent = {
    id: `opencode:${instanceKey}:event:session.status:${encodeURIComponent(sessionId)}:${encodeURIComponent(status)}:${Date.now()}`,
    type: "task.updated",
    taskId: opencodeTaskId(instanceKey, sessionId),
    timestamp: new Date().toISOString(),
    source: {
      id: `opencode:${instanceKey}`,
      kind: "opencode",
      label: context.sourceLabel ?? "OpenCode",
    },
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(reasonText(event)),
    title: `OpenCode session ${status}`,
    status,
  };
  const reason = reasonText(event);
  if (reason) {
    update.summary = reason;
  }
  return [update];
}

function mapMessagePartUpdated(event: OpencodeMessagePartUpdatedEvent, context: OpencodeMappingContext): SourceEvent[] {
  const part = event.properties.part;
  const sessionId = readString(event.properties.sessionID) ?? readString(part?.sessionID);
  const partType = readString(part?.type);
  const state = readPartState(part);
  const instanceKey = createOpencodeInstanceKey(context);
  if (!sessionId || !partType) {
    return [];
  }

  if (partType === "text") {
    const text = readString(part?.text);
    if (text && context.messageRole === "assistant" && looksLikeFollowUpQuestion(text)) {
      const partId = readString(part?.id) ?? readString(event.properties.partID) ?? `${Date.now()}`;
      return [
        {
          id: `opencode:${instanceKey}:event:message.part.updated:${encodeURIComponent(partId)}:follow-up`,
          type: "human.input.requested",
          taskId: opencodeTaskId(instanceKey, sessionId),
          interactionId: opencodeFollowUpInteractionId(instanceKey, sessionId, partId),
          timestamp: new Date().toISOString(),
          source: {
            id: `opencode:${instanceKey}`,
            kind: "opencode",
            label: context.sourceLabel ?? "OpenCode",
          },
          toolFamily: "opencode",
          activityClass: "follow_up",
          title: "OpenCode is waiting for your reply",
          summary: text,
          request: {
            kind: "form",
            fields: [
              {
                id: "reply",
                label: "Reply",
                type: "textarea",
                required: true,
              },
            ],
          },
          semanticHints: followUpRequestSemanticHints(
            "OpenCode asked a follow-up question and needs a reply before continuing.",
          ),
          provenance: {
            whyNow: "OpenCode asked a follow-up question and needs a reply before continuing.",
          },
          riskHint: "medium",
          context: {
            items: [
              { id: "sessionId", label: "Session ID", value: sessionId },
              { id: "partId", label: "Part ID", value: partId },
            ],
          },
        },
      ];
    }
  }

  if (!state) {
    return [];
  }

  if (state === "error" || state === "failed") {
    return [
      {
        id: `opencode:${instanceKey}:event:message.part.updated:${encodeURIComponent(readString(event.properties.partID) ?? `${Date.now()}`)}`,
        type: "task.updated",
        taskId: opencodeTaskId(instanceKey, sessionId),
        timestamp: new Date().toISOString(),
        source: {
          id: `opencode:${instanceKey}`,
          kind: "opencode",
          label: context.sourceLabel ?? "OpenCode",
        },
        activityClass: "tool_failure",
        semanticHints: taskActivitySemanticHints("tool_failure"),
        title: "OpenCode tool step failed",
        summary: `${partType} reported ${state}.`,
        status: "failed",
      },
    ];
  }

  return [];
}

function promptsToRequest(prompts: OpencodeQuestionPrompt[]) {
  if (prompts.length === 1 && prompts[0]?.options?.length) {
    const prompt = prompts[0];
    const options = prompt.options ?? [];
    const allowTextResponse =
      prompt.custom === true
      || prompt.allowCustomInput === true
      // OpenCode's native clients can offer a freeform "type your own answer"
      // path for single-question choice prompts even when the server payload
      // does not include an explicit custom-input flag.
      || (prompt.multiple !== true && prompt.multiSelect !== true);
    return {
      kind: "choice" as const,
      selectionMode: prompt.multiple || prompt.multiSelect ? "multiple" as const : "single" as const,
      ...(allowTextResponse
        ? {
            allowTextResponse: true,
          }
        : {}),
      options: options.map((option, index) => ({
        id: option.value ?? option.label ?? `option-${index}`,
        label: option.label,
        ...(option.description ? { summary: option.description } : {}),
      })),
    };
  }

  return {
    kind: "form" as const,
    fields: prompts.map((prompt, index) => ({
      id: prompt.id ?? `field-${index}`,
      label: prompt.question ?? prompt.label ?? prompt.header ?? prompt.prompt ?? `Field ${index + 1}`,
      type: prompt.options?.length ? "select" as const : "textarea" as const,
      ...(prompt.options?.length
        ? {
            options: prompt.options.map((option) => ({
              value: option.value ?? option.label,
              label: option.label,
            })),
          }
        : {}),
    })),
  };
}

function normalizeTaskStatus(status: string | undefined) {
  switch (status) {
    case "busy":
    case "running":
    case "working":
      return "running" as const;
    case "waiting":
    case "blocked":
    case "paused":
      return "waiting" as const;
    case "failed":
    case "error":
      return "failed" as const;
    case "completed":
    case "done":
      return "completed" as const;
    default:
      return null;
  }
}

function reasonText(event: Extract<OpencodeSseMessage, { type: "session.status" }>): string | undefined {
  return readString(event.properties.reason) ?? readStatusReason(event.properties.status);
}

function readSessionStatus(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const status = value as Record<string, unknown>;
    return readString(status.type);
  }
  return undefined;
}

function readStatusReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const status = value as Record<string, unknown>;
  return readString(status.reason) ?? readString(status.message);
}

function readPartState(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const part = value as Record<string, unknown>;
  if (typeof part.state === "string") {
    return part.state;
  }
  if (part.state && typeof part.state === "object") {
    return readString((part.state as Record<string, unknown>).status);
  }
  return readString(part.status);
}

function normalizePermissionDecision(value: unknown): OpencodePermissionDecision | null {
  return value === "once" || value === "always" || value === "reject" ? value : null;
}

function patternSummary(patterns: OpencodeToolCallPattern[] | undefined): string | undefined {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return undefined;
  }
  return patterns
    .map((pattern) => typeof pattern === "string" ? pattern : pattern.value ?? pattern.source)
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function inferPermissionSummary(input: {
  tool: string | undefined;
  title: string | undefined;
  message: string | undefined;
  description: string | undefined;
  patternText: string | undefined;
}): string | undefined {
  const { tool, title, message, description, patternText } = input;
  const preferredText = firstSpecificText(patternText, description, message);
  if (!preferredText) {
    return undefined;
  }

  if (tool === "bash") {
    return preferredText;
  }
  if (tool === "edit") {
    return preferredText;
  }
  if (tool === "webfetch") {
    return preferredText;
  }
  if (preferredText.includes("/")) {
    return preferredText;
  }
  return preferredText;
}

function approvalTitle(
  tool: string | undefined,
  summary: string,
  declaredTitle: string | undefined,
): string {
  const action = approvalActionLabel(tool, summary, declaredTitle);
  const detail = approvalTitleDetail(tool, summary, declaredTitle);
  return detail ? `OpenCode wants to ${action} ${detail}` : `OpenCode wants to ${action}`;
}

function approvalActionLabel(
  tool: string | undefined,
  summary: string,
  declaredTitle: string | undefined,
): string {
  switch (tool?.toLowerCase()) {
    case "bash":
      return bashPermissionIntent(tool, summary, declaredTitle)?.action ?? "run";
    case "edit":
      return "edit";
    case "webfetch":
      return "fetch";
    case "external_directory":
      return "access";
    default:
      return tool ? `use ${tool}` : "continue";
  }
}

function approvalTitleDetail(
  tool: string | undefined,
  summary: string,
  declaredTitle: string | undefined,
): string | null {
  switch (tool?.toLowerCase()) {
    case "bash":
      return bashPermissionIntent(tool, summary, declaredTitle)?.detail ?? "a shell command";
    case "edit":
      return "files";
    case "webfetch":
      return "a URL";
    case "external_directory":
      return "a path";
    default:
      break;
  }

  if (declaredTitle && !isGenericPermissionText(declaredTitle)) {
    return declaredTitle;
  }

  if (summary && !isGenericPermissionText(summary)) {
    return summary;
  }

  return null;
}

function bashPermissionIntent(
  tool: string | undefined,
  summary?: string,
  declaredTitle?: string,
): { action: string; detail: string } | null {
  if (tool?.toLowerCase() !== "bash") {
    return null;
  }

  const text = `${declaredTitle ?? ""} ${summary ?? ""}`.toLowerCase();
  if (/\bmkdir\b/.test(text) || /\bcreate (?:a )?new directory\b/.test(text)) {
    return {
      action: "create",
      detail: "a new directory",
    };
  }

  return null;
}

function firstSpecificText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (isGenericPermissionText(value)) {
      continue;
    }
    return value;
  }
  return undefined;
}

function isGenericPermissionText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "permission required"
    || normalized === "opencode needs approval"
    || normalized === "opencode requested approval before continuing."
    || normalized === "run bash tool";
}

function detailFieldId(tool: string | undefined): string {
  switch (tool) {
    case "bash":
      return "command";
    case "edit":
      return "target";
    case "webfetch":
      return "url";
    case "external_directory":
      return "path";
    default:
      return "pattern";
  }
}

function detailFieldLabel(tool: string | undefined): string {
  switch (tool) {
    case "bash":
      return "Command";
    case "edit":
      return "Target";
    case "webfetch":
      return "URL";
    case "external_directory":
      return "Path";
    default:
      return "Pattern";
  }
}

function preferredContextValue(
  tool: string | undefined,
  patternText: string | undefined,
  summary: string,
): string {
  if (patternText) {
    return patternText;
  }
  if (tool === "bash" && summary.startsWith("Run command: ")) {
    return summary.slice("Run command: ".length);
  }
  return summary;
}

function contextItem(id: string, label: string, value: string | undefined | null): ContextItem | null {
  return value ? { id, label, value } : null;
}

function explicitRequestSemanticHints(
  kind: "approval" | "choice" | "form",
  activityClass: SourceHumanInputRequestedEvent["activityClass"],
  whyNow: string,
): HumanInputSemanticHints {
  return {
    intentFrame: requestIntentFrame(kind),
    ...(activityClass !== undefined ? { activityClass } : {}),
    whyNow,
    confidence: "high",
  };
}

function followUpRequestSemanticHints(whyNow: string): HumanInputSemanticHints {
  return {
    intentFrame: "question_request",
    activityClass: "follow_up",
    whyNow,
    confidence: "high",
  };
}

function sessionStatusSemanticHints(whyNow: string | undefined): TaskUpdateSemanticHints {
  return {
    activityClass: "session_status",
    ...(whyNow !== undefined ? { whyNow } : {}),
    confidence: "high",
  };
}

function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
): TaskUpdateSemanticHints {
  return {
    activityClass,
  };
}

function requestIntentFrame(
  kind: "approval" | "choice" | "form",
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

function followUpSessionPrompt(sessionId: string, text: string): OpencodeResponseAction {
  return {
    kind: "session.prompt",
    sessionId,
    body: {
      parts: [
        {
          type: "text",
          text,
          metadata: {
            source: "aperture",
            interaction: "follow_up",
          },
        },
      ],
    },
  };
}

function opencodeFollowUpInteractionId(instanceKey: string, sessionId: string, partId: string): string {
  return `opencode:${instanceKey}:followup:${encodeURIComponent(sessionId)}|${encodeURIComponent(partId)}`;
}

function normalizeAnswerGroup(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

function extractFollowUpReplyText(values: Record<string, unknown>): string | null {
  const preferred = values.reply;
  if (typeof preferred === "string" && preferred.trim() !== "") {
    return preferred.trim();
  }

  for (const value of Object.values(values)) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .join(", ");
      if (joined.length > 0) {
        return joined;
      }
    }
    if (value !== null && value !== undefined && typeof value !== "object") {
      const scalar = String(value).trim();
      if (scalar.length > 0) {
        return scalar;
      }
    }
  }

  return null;
}

function looksLikeFollowUpQuestion(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? value.trim();
  return /\?\s*$/.test(lastLine);
}

function rejectedResponse(reason: string | undefined): AttentionResponse["response"] {
  return reason ? { kind: "rejected", reason } : { kind: "rejected" };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function opencodeToolFamily(tool: string | undefined): string {
  switch (tool?.toLowerCase()) {
    case "bash":
      return "bash";
    case "edit":
      return "edit";
    case "webfetch":
      return "web";
    case "external_directory":
      return "read";
    default:
      return tool?.trim() ? tool.toLowerCase() : "opencode";
  }
}
