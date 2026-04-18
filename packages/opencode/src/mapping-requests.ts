import type { SourceHumanInputRequestedEvent } from "@tomismeta/aperture-core";

import type {
  OpencodePermissionAskedEvent,
  OpencodeQuestionAskedEvent,
  OpencodeQuestionPrompt,
  OpencodeToolCallPattern,
} from "./types.js";
import {
  createOpencodeInstanceKey,
  opencodeInteractionId,
  opencodeSource,
  opencodeTaskId,
  readString,
  type OpencodeMappingContext,
} from "./mapping-shared.js";

type ContextItem =
  NonNullable<NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]>[number];
type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;

export function mapPermissionAsked(
  event: OpencodePermissionAskedEvent,
  context: OpencodeMappingContext,
): SourceHumanInputRequestedEvent {
  const instanceKey = createOpencodeInstanceKey(context);
  const requestId = event.properties.id;
  const sessionId =
    readString(event.properties.sessionID) ?? readString(event.properties.metadata?.sessionID);
  const tool =
    readString(event.properties.permission) ?? readString(event.properties.metadata?.tool);
  const declaredTitle =
    readString(event.properties.title) ?? readString(event.properties.metadata?.title);
  const description = readString(event.properties.metadata?.description);
  const patternText = patternSummary(
    event.properties.patterns ?? event.properties.metadata?.patterns,
  );
  const summary =
    inferPermissionSummary({
      tool,
      message: readString(event.properties.message),
      description,
      patternText,
    }) ?? "OpenCode requested approval before continuing.";
  const title = approvalTitle(tool, summary, declaredTitle);
  const whyNow = description ?? "OpenCode paused and needs a human approval decision.";

  const contextItems = [
    contextItem(
      detailFieldId(tool),
      detailFieldLabel(tool),
      preferredContextValue(tool, patternText, summary),
    ),
    contextItem("cwd", "Working Directory", context.scope?.directory),
    contextItem(
      "callId",
      "Call ID",
      readString(event.properties.tool?.callID) ?? readString(event.properties.metadata?.callID),
    ),
  ].filter((item): item is ContextItem => item !== null);

  const result: SourceHumanInputRequestedEvent = {
    id: `opencode:${instanceKey}:event:permission.asked:${encodeURIComponent(requestId)}`,
    type: "human.input.requested",
    taskId: opencodeTaskId(instanceKey, sessionId, requestId),
    interactionId: opencodeInteractionId(instanceKey, "permission", requestId),
    timestamp: event.properties.createdAt ?? new Date().toISOString(),
    source: opencodeSource(context),
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

export function mapQuestionAsked(
  event: OpencodeQuestionAskedEvent,
  context: OpencodeMappingContext,
): SourceHumanInputRequestedEvent {
  const instanceKey = createOpencodeInstanceKey(context);
  const requestId = event.properties.id;
  const sessionId = readString(event.properties.sessionID);
  const prompts = event.properties.questions ?? [];
  const title =
    readString(event.properties.title) ??
    prompts[0]?.header ??
    prompts[0]?.label ??
    "OpenCode needs input";
  const derivedSummary = prompts
    .map((prompt) => prompt.question ?? prompt.prompt ?? prompt.label ?? prompt.header)
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const summary =
    readString(event.properties.message) ??
    (derivedSummary !== "" ? derivedSummary : undefined) ??
    "OpenCode asked a question before continuing.";
  const whyNow = questionRequestWhyNow("OpenCode");
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
    source: opencodeSource(context),
    activityClass: "question_request",
    title,
    summary,
    request,
    semanticHints: explicitRequestSemanticHints(request.kind, "question_request", whyNow),
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

function promptsToRequest(prompts: OpencodeQuestionPrompt[]) {
  if (prompts.length === 1 && prompts[0]?.options?.length) {
    const prompt = prompts[0];
    const options = prompt.options ?? [];
    const allowTextResponse = prompt.custom === true || prompt.allowCustomInput === true;
    return {
      kind: "choice" as const,
      selectionMode:
        prompt.multiple || prompt.multiSelect ? ("multiple" as const) : ("single" as const),
      ...(allowTextResponse
        ? {
            allowTextResponse: true,
          }
        : {}),
      options: options.map((option, index) => ({
        id: option.label ?? option.value ?? `option-${index}`,
        label: option.label ?? option.value ?? `Option ${index + 1}`,
        ...(option.description ? { summary: option.description } : {}),
      })),
    };
  }

  return {
    kind: "form" as const,
    fields: prompts.map((prompt, index) => ({
      id: prompt.id ?? `field-${index}`,
      label: primaryPromptLabel(prompt, index),
      type: prompt.options?.length ? ("select" as const) : ("textarea" as const),
      required: true,
      ...(secondaryPromptText(prompt, index)
        ? {
            helpText: secondaryPromptText(prompt, index),
          }
        : {}),
      ...(prompt.options?.length
        ? {
            options: prompt.options.map((option, optionIndex) => ({
              value: option.label ?? option.value ?? `option-${optionIndex}`,
              label: option.label ?? option.value ?? `Option ${optionIndex + 1}`,
            })),
          }
        : {}),
    })),
  };
}

function primaryPromptLabel(prompt: OpencodeQuestionPrompt, index: number): string {
  return (
    prompt.header ??
    prompt.label ??
    prompt.question ??
    prompt.prompt ??
    `Field ${index + 1}`
  );
}

function secondaryPromptText(prompt: OpencodeQuestionPrompt, index: number): string | undefined {
  const primary = primaryPromptLabel(prompt, index);
  return [prompt.question, prompt.prompt, prompt.label, prompt.header]
    .find((candidate) => typeof candidate === "string" && candidate.trim() !== "" && candidate !== primary);
}

function patternSummary(patterns: OpencodeToolCallPattern[] | undefined): string | undefined {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return undefined;
  }
  return patterns
    .map((pattern) =>
      typeof pattern === "string" ? pattern : pattern.value ?? pattern.source,
    )
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function inferPermissionSummary(input: {
  tool: string | undefined;
  message: string | undefined;
  description: string | undefined;
  patternText: string | undefined;
}): string | undefined {
  const preferredText = firstSpecificText(
    input.patternText,
    input.description,
    input.message,
  );
  if (!preferredText) {
    return undefined;
  }
  if (input.tool === "bash" || input.tool === "edit" || input.tool === "webfetch") {
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
    if (!value || isGenericPermissionText(value)) {
      continue;
    }
    return value;
  }
  return undefined;
}

function isGenericPermissionText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "permission required" ||
    normalized === "opencode needs approval" ||
    normalized === "opencode requested approval before continuing." ||
    normalized === "run bash tool"
  );
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

function contextItem(
  id: string,
  label: string,
  value: string | undefined | null,
): ContextItem | null {
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

function questionRequestWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked for input before continuing.`;
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
