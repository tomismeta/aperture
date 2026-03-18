import type { ClientInfo as GeneratedClientInfo } from "./generated/app-server/ClientInfo.js";
import type { ClientNotification as GeneratedClientNotification } from "./generated/app-server/ClientNotification.js";
import type { InitializeParams as GeneratedInitializeParams } from "./generated/app-server/InitializeParams.js";
import type { InitializeResponse as GeneratedInitializeResponse } from "./generated/app-server/InitializeResponse.js";
import type { JsonValue } from "./generated/app-server/serde_json/JsonValue.js";
import type { Personality as GeneratedPersonality } from "./generated/app-server/Personality.js";
import type { ReasoningEffort as GeneratedReasoningEffort } from "./generated/app-server/ReasoningEffort.js";
import type { ReasoningSummary as GeneratedReasoningSummary } from "./generated/app-server/ReasoningSummary.js";
import type { RequestId as GeneratedRequestId } from "./generated/app-server/RequestId.js";
import type { ServerNotification as GeneratedServerNotification } from "./generated/app-server/ServerNotification.js";
import type { ServerRequest as GeneratedServerRequest } from "./generated/app-server/ServerRequest.js";
import type { AskForApproval } from "./generated/app-server/v2/AskForApproval.js";
import type { CommandExecutionApprovalDecision as GeneratedCommandExecutionApprovalDecision } from "./generated/app-server/v2/CommandExecutionApprovalDecision.js";
import type { CommandExecutionRequestApprovalParams as GeneratedCommandExecutionRequestApprovalParams } from "./generated/app-server/v2/CommandExecutionRequestApprovalParams.js";
import type { FileChangeApprovalDecision as GeneratedFileChangeApprovalDecision } from "./generated/app-server/v2/FileChangeApprovalDecision.js";
import type { FileChangeRequestApprovalParams as GeneratedFileChangeRequestApprovalParams } from "./generated/app-server/v2/FileChangeRequestApprovalParams.js";
import type { ItemCompletedNotification as GeneratedItemCompletedNotification } from "./generated/app-server/v2/ItemCompletedNotification.js";
import type { ItemStartedNotification as GeneratedItemStartedNotification } from "./generated/app-server/v2/ItemStartedNotification.js";
import type { ReviewDelivery as GeneratedReviewDelivery } from "./generated/app-server/v2/ReviewDelivery.js";
import type { ReviewStartParams as GeneratedReviewStartParams } from "./generated/app-server/v2/ReviewStartParams.js";
import type { ReviewStartResponse as GeneratedReviewStartResponse } from "./generated/app-server/v2/ReviewStartResponse.js";
import type { ReviewTarget as GeneratedReviewTarget } from "./generated/app-server/v2/ReviewTarget.js";
import type { SandboxMode } from "./generated/app-server/v2/SandboxMode.js";
import type { SandboxPolicy } from "./generated/app-server/v2/SandboxPolicy.js";
import type { ServerRequestResolvedNotification as GeneratedServerRequestResolvedNotification } from "./generated/app-server/v2/ServerRequestResolvedNotification.js";
import type { Thread as GeneratedThread } from "./generated/app-server/v2/Thread.js";
import type { ThreadItem as GeneratedThreadItem } from "./generated/app-server/v2/ThreadItem.js";
import type { ThreadResumeParams as GeneratedThreadResumeParams } from "./generated/app-server/v2/ThreadResumeParams.js";
import type { ThreadResumeResponse as GeneratedThreadResumeResponse } from "./generated/app-server/v2/ThreadResumeResponse.js";
import type { ThreadStartedNotification as GeneratedThreadStartedNotification } from "./generated/app-server/v2/ThreadStartedNotification.js";
import type { ThreadStartResponse as GeneratedThreadStartResponse } from "./generated/app-server/v2/ThreadStartResponse.js";
import type { ThreadStatusChangedNotification as GeneratedThreadStatusChangedNotification } from "./generated/app-server/v2/ThreadStatusChangedNotification.js";
import type { ToolRequestUserInputParams as GeneratedToolRequestUserInputParams } from "./generated/app-server/v2/ToolRequestUserInputParams.js";
import type { ToolRequestUserInputQuestion as GeneratedToolRequestUserInputQuestion } from "./generated/app-server/v2/ToolRequestUserInputQuestion.js";
import type { ToolRequestUserInputOption as GeneratedToolRequestUserInputOption } from "./generated/app-server/v2/ToolRequestUserInputOption.js";
import type { Turn as GeneratedTurn } from "./generated/app-server/v2/Turn.js";
import type { TurnCompletedNotification as GeneratedTurnCompletedNotification } from "./generated/app-server/v2/TurnCompletedNotification.js";
import type { TurnInterruptParams as GeneratedTurnInterruptParams } from "./generated/app-server/v2/TurnInterruptParams.js";
import type { TurnStartResponse as GeneratedTurnStartResponse } from "./generated/app-server/v2/TurnStartResponse.js";
import type { TurnStartedNotification as GeneratedTurnStartedNotification } from "./generated/app-server/v2/TurnStartedNotification.js";
import type { TurnSteerResponse as GeneratedTurnSteerResponse } from "./generated/app-server/v2/TurnSteerResponse.js";
import type { UserInput as GeneratedUserInput } from "./generated/app-server/v2/UserInput.js";

export type JsonRpcId = GeneratedRequestId;

export type CodexClientInfo = GeneratedClientInfo;
export type CodexInputItem = GeneratedUserInput;
export type CodexReasoningEffort = GeneratedReasoningEffort;
export type CodexReasoningSummary = GeneratedReasoningSummary;
export type CodexPersonality = GeneratedPersonality;

export type CodexTurnStartParams = {
  threadId: string;
  input: CodexInputItem[];
  cwd?: string;
  approvalPolicy?: AskForApproval;
  sandboxPolicy?: SandboxPolicy;
  model?: string;
  effort?: CodexReasoningEffort;
  summary?: CodexReasoningSummary;
  personality?: CodexPersonality;
  outputSchema?: JsonValue;
};

export type CodexTurnSteerParams = {
  threadId: string;
  input: CodexInputItem[];
};

export type CodexTurnInterruptParams = GeneratedTurnInterruptParams;

export type CodexReviewTarget = GeneratedReviewTarget;
export type CodexReviewDelivery = GeneratedReviewDelivery;
export type CodexReviewStartParams = GeneratedReviewStartParams;

export type CodexThreadStartParams = {
  cwd?: string;
  model?: string;
  approvalPolicy?: AskForApproval;
  sandbox?: SandboxMode;
  personality?: CodexPersonality;
  baseInstructions?: string;
  developerInstructions?: string;
  ephemeral?: boolean;
};

export type CodexThreadResumeParams = GeneratedThreadResumeParams;

export type CodexInitializeParams = GeneratedInitializeParams;
export type CodexInitializeResult = GeneratedInitializeResponse;

export type CodexTurn = GeneratedTurn;
export type CodexThread = GeneratedThread;

export type CodexThreadStartResult = Pick<GeneratedThreadStartResponse, "thread">;
export type CodexThreadResumeResult = Pick<GeneratedThreadResumeResponse, "thread">;
export type CodexTurnStartResult = GeneratedTurnStartResponse;
export type CodexTurnSteerResult = GeneratedTurnSteerResponse;
export type CodexReviewStartResult = GeneratedReviewStartResponse;

export type CodexCommandExecutionApprovalDecision = GeneratedCommandExecutionApprovalDecision;
export type CodexFileChangeApprovalDecision = GeneratedFileChangeApprovalDecision;

export type CodexToolRequestUserInputOption = GeneratedToolRequestUserInputOption;
export type CodexToolRequestUserInputQuestion = GeneratedToolRequestUserInputQuestion;

export type CodexCommandExecutionRequestApprovalParams =
  GeneratedCommandExecutionRequestApprovalParams;
export type CodexFileChangeRequestApprovalParams = GeneratedFileChangeRequestApprovalParams;
export type CodexToolRequestUserInputParams = GeneratedToolRequestUserInputParams;

export type CodexRawServerRequest = {
  method: string;
  id: JsonRpcId;
  params?: unknown;
};

export type CodexServerRequest = GeneratedServerRequest;

export type CodexThreadStartedNotification = GeneratedThreadStartedNotification;
export type CodexThreadStatusChangedNotification = GeneratedThreadStatusChangedNotification;
export type CodexTurnStartedNotification = GeneratedTurnStartedNotification;
export type CodexTurnCompletedNotification = GeneratedTurnCompletedNotification;
export type CodexThreadItem = GeneratedThreadItem;
export type CodexItemStartedNotification = GeneratedItemStartedNotification;
export type CodexItemCompletedNotification = GeneratedItemCompletedNotification;
export type CodexServerRequestResolvedNotification =
  GeneratedServerRequestResolvedNotification;

export type CodexRawServerNotification = {
  method: string;
  params?: unknown;
};

export type CodexServerNotification = GeneratedServerNotification;

export type CodexJsonRpcRequest<TMethod extends string = string, TParams = unknown> = {
  method: TMethod;
  id: JsonRpcId;
  params: TParams;
};

export type CodexJsonRpcNotification<TMethod extends string = string, TParams = unknown> = {
  method: TMethod;
  params?: TParams;
};

export type CodexJsonRpcSuccess<TResult = unknown> = {
  id: JsonRpcId;
  result: TResult;
};

export type CodexJsonRpcError = {
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type CodexClientNotification = GeneratedClientNotification;

export type CodexJsonRpcEnvelope =
  | CodexJsonRpcSuccess
  | CodexJsonRpcError
  | CodexRawServerRequest
  | CodexRawServerNotification
  | CodexClientNotification
  | CodexJsonRpcRequest;

export function isCodexServerRequest(value: unknown): value is CodexRawServerRequest {
  if (!isObject(value) || typeof value.method !== "string" || !("id" in value)) {
    return false;
  }
  return typeof value.id === "string" || typeof value.id === "number";
}

export function isCodexServerNotification(value: unknown): value is CodexRawServerNotification {
  if (!isObject(value) || typeof value.method !== "string" || ("id" in value)) {
    return false;
  }
  return true;
}

export function isCodexJsonRpcSuccess<TResult = unknown>(
  value: unknown,
): value is CodexJsonRpcSuccess<TResult> {
  return isObject(value) && "id" in value && "result" in value;
}

export function isCodexJsonRpcError(value: unknown): value is CodexJsonRpcError {
  return (
    isObject(value)
    && "error" in value
    && isObject(value.error)
    && typeof value.error.code === "number"
    && typeof value.error.message === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
