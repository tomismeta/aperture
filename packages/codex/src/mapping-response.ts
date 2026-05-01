import type { AttentionResponse } from "@tomismeta/aperture-core";

import type {
  CodexApplyPatchApprovalResponse,
  CodexCommandExecutionApprovalDecision,
  CodexExecCommandApprovalResponse,
  CodexFileChangeApprovalDecision,
  CodexMcpServerElicitationRequestParams,
  CodexMcpServerElicitationRequestResponse,
  CodexPermissionsRequestApprovalParams,
  CodexPermissionsRequestApprovalResponse,
  CodexReviewDecision,
  CodexToolRequestUserInputParams,
} from "./protocol.js";
import { mapCodexElicitationAcceptedContent } from "./mapping-human-input.js";

export type CodexResponsePayload =
  | {
      decision: CodexCommandExecutionApprovalDecision | CodexFileChangeApprovalDecision;
    }
  | CodexExecCommandApprovalResponse
  | CodexApplyPatchApprovalResponse
  | CodexPermissionsRequestApprovalResponse
  | CodexMcpServerElicitationRequestResponse
  | {
      answers: Record<string, { answers: string[] }>;
    };

export type ParsedInteractionId =
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
    }
  | {
      kind: "mcpElicitation";
      requestId: string;
      threadId: string;
      turnId: string | null;
      serverName: string;
      mode: "form" | "url";
      elicitationId?: string;
    }
  | {
      kind: "execCommandApproval";
      requestId: string;
      threadId: string;
      itemId: string;
      approvalId?: string;
    }
  | {
      kind: "applyPatchApproval";
      requestId: string;
      threadId: string;
      itemId: string;
    }
  | {
      kind: "permissionsApproval";
      requestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
    };

export function parseCodexInteractionId(interactionId: string): ParsedInteractionId | null {
  const parts = interactionId.split(":");
  if (parts[0] !== "codex") {
    return null;
  }
  const [, kind, requestId, threadId, firstSegment, secondSegment, thirdSegment] = parts;
  if (!kind || !requestId || !threadId) {
    return null;
  }
  switch (kind) {
    case "commandApproval":
      if (!firstSegment || !secondSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(firstSegment),
        itemId: decodeURIComponent(secondSegment),
        ...(thirdSegment ? { approvalId: decodeURIComponent(thirdSegment) } : {}),
      };
    case "fileChangeApproval":
      if (!firstSegment || !secondSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(firstSegment),
        itemId: decodeURIComponent(secondSegment),
      };
    case "userInput":
      if (!firstSegment || !secondSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(firstSegment),
        itemId: decodeURIComponent(secondSegment),
      };
    case "mcpElicitation":
      if (!firstSegment || !secondSegment || !thirdSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(firstSegment) === "_" ? null : decodeURIComponent(firstSegment),
        serverName: decodeURIComponent(secondSegment),
        mode: decodeURIComponent(thirdSegment) === "url" ? "url" : "form",
        ...(parts[7] ? { elicitationId: decodeURIComponent(parts[7]!) } : {}),
      };
    case "execCommandApproval":
      if (!firstSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        itemId: decodeURIComponent(firstSegment),
        ...(secondSegment ? { approvalId: decodeURIComponent(secondSegment) } : {}),
      };
    case "applyPatchApproval":
      if (!firstSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        itemId: decodeURIComponent(firstSegment),
      };
    case "permissionsApproval":
      if (!firstSegment || !secondSegment) {
        return null;
      }
      return {
        kind,
        requestId: decodeURIComponent(requestId),
        threadId: decodeURIComponent(threadId),
        turnId: decodeURIComponent(firstSegment),
        itemId: decodeURIComponent(secondSegment),
      };
    default:
      return null;
  }
}

export function mapCommandApprovalDecision(response: AttentionResponse): CodexCommandExecutionApprovalDecision {
  return mapApprovalDecision(response);
}

export function mapFileChangeApprovalDecision(response: AttentionResponse): CodexFileChangeApprovalDecision {
  return mapApprovalDecision(response);
}

export function mapReviewDecision(response: AttentionResponse): CodexReviewDecision {
  switch (response.response.kind) {
    case "approved":
      return "approved";
    case "rejected":
      return "denied";
    case "dismissed":
    case "acknowledged":
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return "abort";
  }
}

export function mapToolRequestAnswers(
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

export function mapPermissionsApprovalResponse(
  response: AttentionResponse,
  params: CodexPermissionsRequestApprovalParams,
): CodexPermissionsRequestApprovalResponse {
  switch (response.response.kind) {
    case "approved":
      return {
        permissions: grantAdditionalPermissions(params.permissions),
        scope: "turn",
      };
    case "rejected":
    case "dismissed":
    case "acknowledged":
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return {
        permissions: {},
        scope: "turn",
      };
  }
}

export function mapMcpServerElicitationResponse(
  response: AttentionResponse,
  params: CodexMcpServerElicitationRequestParams,
): CodexMcpServerElicitationRequestResponse {
  if (params.mode === "url") {
    switch (response.response.kind) {
      case "approved":
        return { action: "accept", content: null, _meta: null };
      case "rejected":
        return { action: "decline", content: null, _meta: null };
      case "dismissed":
      case "acknowledged":
      case "option_selected":
      case "text_submitted":
      case "form_submitted":
        return { action: "cancel", content: null, _meta: null };
    }
  }

  switch (response.response.kind) {
    case "option_selected":
    case "text_submitted":
    case "form_submitted": {
      const content = mapCodexElicitationAcceptedContent(response, params);
      return { action: "accept", content, _meta: null };
    }
    case "rejected":
      return { action: "decline", content: null, _meta: null };
    case "approved":
    case "dismissed":
    case "acknowledged":
      return { action: "cancel", content: null, _meta: null };
  }
}

function mapApprovalDecision(
  response: AttentionResponse,
): "accept" | "decline" | "cancel" {
  switch (response.response.kind) {
    case "approved":
      return "accept";
    case "rejected":
      return "decline";
    case "dismissed":
    case "acknowledged":
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return "cancel";
  }
}

function grantAdditionalPermissions(
  permissions: CodexPermissionsRequestApprovalParams["permissions"],
): CodexPermissionsRequestApprovalResponse["permissions"] {
  return {
    ...(permissions.network ? { network: permissions.network } : {}),
    ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
  };
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
