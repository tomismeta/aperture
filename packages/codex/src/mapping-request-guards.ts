import type {
  CodexApplyPatchApprovalParams,
  CodexCommandExecutionRequestApprovalParams,
  CodexExecCommandApprovalParams,
  CodexFileChangeRequestApprovalParams,
  CodexMcpServerElicitationRequestParams,
  CodexPermissionsRequestApprovalParams,
  CodexToolRequestUserInputParams,
} from "./protocol.js";
import { isRecord } from "./mapping-shared.js";

export function isCommandExecutionApprovalParams(
  params: unknown,
): params is CodexCommandExecutionRequestApprovalParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
  );
}

export function isFileChangeApprovalParams(
  params: unknown,
): params is CodexFileChangeRequestApprovalParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && typeof params.turnId === "string"
    && typeof params.itemId === "string"
  );
}

export function isToolRequestUserInputParams(
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

export function isPermissionsRequestApprovalParams(
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

export function isMcpServerElicitationRequestParams(
  params: unknown,
): params is CodexMcpServerElicitationRequestParams {
  return (
    isRecord(params)
    && typeof params.threadId === "string"
    && (typeof params.turnId === "string" || params.turnId === null)
    && typeof params.serverName === "string"
    && (params.mode === "form" || params.mode === "url")
  );
}

export function isExecCommandApprovalParams(
  params: unknown,
): params is CodexExecCommandApprovalParams {
  return (
    isRecord(params)
    && typeof params.conversationId === "string"
    && typeof params.callId === "string"
    && Array.isArray(params.command)
    && typeof params.cwd === "string"
  );
}

export function isApplyPatchApprovalParams(
  params: unknown,
): params is CodexApplyPatchApprovalParams {
  return (
    isRecord(params)
    && typeof params.conversationId === "string"
    && typeof params.callId === "string"
    && isRecord(params.fileChanges)
  );
}

export function codexMcpApprovalKind(meta: unknown): string | undefined {
  return isRecord(meta) && typeof meta.codex_approval_kind === "string"
    ? meta.codex_approval_kind
    : undefined;
}

export function codexMcpPersistOptions(meta: unknown): string[] {
  if (!isRecord(meta)) {
    return [];
  }
  if (typeof meta.persist === "string") {
    return [meta.persist];
  }
  if (Array.isArray(meta.persist)) {
    return meta.persist.filter((value): value is string => typeof value === "string");
  }
  return [];
}
