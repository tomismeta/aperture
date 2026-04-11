import type { AttentionResponse } from "@tomismeta/aperture-core";

import type {
  CodexCommandExecutionRequestApprovalParams,
  CodexFileChangeRequestApprovalParams,
  CodexPermissionsRequestApprovalParams,
  CodexRawServerRequest,
  CodexToolRequestUserInputParams,
} from "./protocol.js";
import { mapCodexServerRequest as mapCodexServerRequestImpl } from "./mapping-requests.js";
import { mapCodexNotification as mapCodexNotificationImpl } from "./mapping-notifications.js";
import {
  mapCommandApprovalDecision,
  mapFileChangeApprovalDecision,
  mapPermissionsApprovalResponse,
  mapReviewDecision,
  mapToolRequestAnswers,
  type CodexResponsePayload,
} from "./mapping-response.js";

export { parseCodexInteractionId, type CodexResponsePayload } from "./mapping-response.js";
export type { CodexMappedRequest, CodexMappingContext } from "./mapping-shared.js";

export const mapCodexServerRequest = mapCodexServerRequestImpl;
export const mapCodexNotification = mapCodexNotificationImpl;

export function mapCodexResponse(
  response: AttentionResponse,
  request: CodexRawServerRequest,
): CodexResponsePayload | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      if (!isCommandExecutionApprovalParams(request.params)) {
        return null;
      }
      return {
        decision: mapCommandApprovalDecision(response),
      };
    case "item/fileChange/requestApproval":
      if (!isFileChangeApprovalParams(request.params)) {
        return null;
      }
      return {
        decision: mapFileChangeApprovalDecision(response),
      };
    case "item/tool/requestUserInput":
      if (!isToolRequestUserInputParams(request.params)) {
        return null;
      }
      return {
        answers: mapToolRequestAnswers(response, request.params),
      };
    case "item/permissions/requestApproval":
      if (!isPermissionsRequestApprovalParams(request.params)) {
        return null;
      }
      return mapPermissionsApprovalResponse(response, request.params);
    case "execCommandApproval":
      return {
        decision: mapReviewDecision(response),
      };
    case "applyPatchApproval":
      return {
        decision: mapReviewDecision(response),
      };
    default:
      return null;
  }
}

function isCommandExecutionApprovalParams(
  params: unknown,
): params is CodexCommandExecutionRequestApprovalParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
  );
}

function isFileChangeApprovalParams(
  params: unknown,
): params is CodexFileChangeRequestApprovalParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
  );
}

function isToolRequestUserInputParams(
  params: unknown,
): params is CodexToolRequestUserInputParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
    && Array.isArray(params.questions)
  );
}

function isPermissionsRequestApprovalParams(
  params: unknown,
): params is CodexPermissionsRequestApprovalParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
    && isRecord(params.permissions)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
