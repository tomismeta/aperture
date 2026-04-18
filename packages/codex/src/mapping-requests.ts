import type { SourceHumanInputRequestedEvent } from "@tomismeta/aperture-core";

import type {
  CodexApplyPatchApprovalParams,
  CodexCommandExecutionRequestApprovalParams,
  CodexExecCommandApprovalParams,
  CodexFileChangeRequestApprovalParams,
  CodexMcpServerElicitationRequestParams,
  CodexPermissionsRequestApprovalParams,
  CodexRawServerRequest,
  CodexToolRequestUserInputParams,
  JsonRpcId,
} from "./protocol.js";
import {
  buildCodexElicitationRequest,
  codexElicitationSummary,
} from "./mapping-human-input.js";
import {
  codexMcpApprovalKind,
  codexMcpPersistOptions,
  isApplyPatchApprovalParams,
  isCommandExecutionApprovalParams,
  isExecCommandApprovalParams,
  isFileChangeApprovalParams,
  isMcpServerElicitationRequestParams,
  isPermissionsRequestApprovalParams,
  isToolRequestUserInputParams,
} from "./mapping-request-guards.js";
import {
  codexEventId,
  codexMcpElicitationInteractionId,
  codexInteractionId,
  codexTaskId,
  codexSource,
  codexThreadTaskId,
  codexTurnTaskId,
  contextItem,
  createContextItem,
  describeAdditionalPermissions,
  explicitRequestSemanticHints,
  questionRequestWhyNow,
  slugifyOption,
  type CodexMappedRequest,
  type CodexMappingContext,
  type ContextItem,
} from "./mapping-shared.js";

export function mapCodexServerRequest(
  request: CodexRawServerRequest,
  context: CodexMappingContext = {},
): CodexMappedRequest | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return isCommandExecutionApprovalParams(request.params)
        ? mapCommandApprovalRequest(request.id, request.params, context)
        : null;
    case "item/fileChange/requestApproval":
      return isFileChangeApprovalParams(request.params)
        ? mapFileChangeApprovalRequest(request.id, request.params, context)
        : null;
    case "item/tool/requestUserInput":
      return isToolRequestUserInputParams(request.params)
        ? mapToolRequestUserInputRequest(request.id, request.params, context)
        : null;
    case "mcpServer/elicitation/request":
      return isMcpServerElicitationRequestParams(request.params)
        ? mapMcpServerElicitationRequest(request.id, request.params, context)
        : null;
    case "item/permissions/requestApproval":
      return isPermissionsRequestApprovalParams(request.params)
        ? mapPermissionsApprovalRequest(request.id, request.params, context)
        : null;
    case "execCommandApproval":
      return isExecCommandApprovalParams(request.params)
        ? mapExecCommandApprovalRequest(request.id, request.params, context)
        : null;
    case "applyPatchApproval":
      return isApplyPatchApprovalParams(request.params)
        ? mapApplyPatchApprovalRequest(request.id, request.params, context)
        : null;
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
    contextItem("command", "Command", params.command),
    contextItem("cwd", "Working Directory", params.cwd),
    contextItem("reason", "Reason", params.reason),
    params.networkApprovalContext
      ? {
          id: "networkContext",
          label: "Network Context",
          value: JSON.stringify(params.networkApprovalContext),
        }
      : null,
  ].filter((item): item is ContextItem => item !== null);

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
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      params.reason ?? "Codex requested approval before running a command.",
    ),
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
  const contextItems = [contextItem("rootPath", "Root Path", params.grantRoot)].filter(
    (item): item is ContextItem => item !== null,
  );

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
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      params.reason ?? "Codex requested approval before applying file changes.",
    ),
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
  const isSingleChoice =
    !!singleQuestion
    && Array.isArray(singleQuestion.options)
    && singleQuestion.options.length > 0;

  if (singleQuestion && isSingleChoice) {
    const request: SourceHumanInputRequestedEvent["request"] = {
      kind: "choice",
      selectionMode: "single",
      allowTextResponse: singleQuestion.isOther,
      options: (singleQuestion.options ?? []).map((option) => ({
        id: slugifyOption(option.label),
        label: option.label,
        ...(option.description ? { summary: option.description } : {}),
      })),
    };
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
      request,
      semanticHints: explicitRequestSemanticHints(
        "choice",
        "question_request",
        questionRequestWhyNow("Codex"),
      ),
    };
    return {
      interactionId,
      taskId,
      events: [event],
    };
  }

  const request: SourceHumanInputRequestedEvent["request"] = {
    kind: "form",
    fields: params.questions.map((question) => ({
      id: question.id,
      label: question.header || question.question,
      type:
        question.options && question.options.length > 0
          ? "select"
          : question.isSecret
            ? "textarea"
            : "text",
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
  };

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.itemId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    activityClass: "question_request",
    title: singleQuestion?.header || "Codex needs input",
    summary:
      singleQuestion?.question
      ?? "Codex requested additional information before continuing.",
    request,
    semanticHints: explicitRequestSemanticHints(
      "form",
      "question_request",
      questionRequestWhyNow("Codex"),
    ),
  };
  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapPermissionsApprovalRequest(
  requestId: JsonRpcId,
  params: CodexPermissionsRequestApprovalParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexTurnTaskId(params.threadId, params.turnId);
  const interactionId = codexInteractionId(
    "permissionsApproval",
    requestId,
    params.threadId,
    params.turnId,
    params.itemId,
  );

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.itemId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    activityClass: "permission_request",
    title: "Approve Codex permissions",
    summary: params.reason ?? describeAdditionalPermissions(params.permissions),
    request: {
      kind: "approval",
    },
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      params.reason ?? "Codex requested additional permissions before continuing.",
    ),
    ...(params.reason ? { provenance: { whyNow: params.reason } } : {}),
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapMcpServerElicitationRequest(
  requestId: JsonRpcId,
  params: CodexMcpServerElicitationRequestParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexTaskId(params.threadId, params.turnId);
  const interactionId = codexMcpElicitationInteractionId(
    requestId,
    params.threadId,
    params.turnId,
    params.serverName,
    params.mode,
    params.mode === "url" ? params.elicitationId : undefined,
  );
  const request = buildCodexElicitationRequest(params);
  const activityClass =
    params.mode === "url" || codexMcpApprovalKind(params._meta)
      ? "permission_request"
      : "question_request";
  const whyNow =
    activityClass === "permission_request"
      ? `Codex is waiting for MCP approval from ${params.serverName}.`
      : `Codex is waiting for input from MCP server ${params.serverName}.`;
  const contextItems = [
    createContextItem("serverName", "Server", params.serverName),
    createContextItem("mode", "Mode", params.mode),
    ...(params.mode === "url" ? [createContextItem("url", "URL", params.url)] : []),
    ...(params.mode === "url"
      ? [createContextItem("elicitationId", "Elicitation", params.elicitationId)]
      : []),
    ...(codexMcpApprovalKind(params._meta)
      ? [
          createContextItem(
            "approvalKind",
            "Approval Kind",
            codexMcpApprovalKind(params._meta)!,
          ),
        ]
      : []),
    ...(codexMcpPersistOptions(params._meta).length > 0
      ? [
          createContextItem(
            "persist",
            "Available Scope",
            codexMcpPersistOptions(params._meta).join(", "),
          ),
        ]
      : []),
  ];

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.serverName),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.threadId, context),
    activityClass,
    title: params.message,
    summary: codexElicitationSummary(params, request),
    request,
    semanticHints: explicitRequestSemanticHints(request.kind, activityClass, whyNow),
    context: {
      items: contextItems,
    },
    provenance: {
      whyNow,
    },
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapExecCommandApprovalRequest(
  requestId: JsonRpcId,
  params: CodexExecCommandApprovalParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexThreadTaskId(params.conversationId);
  const interactionId = codexInteractionId(
    "execCommandApproval",
    requestId,
    params.conversationId,
    params.callId,
    params.approvalId ?? params.callId,
  );

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.callId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.conversationId, context),
    toolFamily: "bash",
    activityClass: "permission_request",
    title: "Approve Codex command",
    summary: params.reason ?? "Codex requested approval before running a command.",
    request: {
      kind: "approval",
    },
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      params.reason ?? "Codex requested approval before running a command.",
    ),
    context: {
      items: [
        createContextItem("command", "Command", params.command.join(" ")),
        createContextItem("cwd", "Working Directory", params.cwd),
        ...(params.reason ? [createContextItem("reason", "Reason", params.reason)] : []),
      ],
    },
    ...(params.reason ? { provenance: { whyNow: params.reason } } : {}),
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}

function mapApplyPatchApprovalRequest(
  requestId: JsonRpcId,
  params: CodexApplyPatchApprovalParams,
  context: CodexMappingContext,
): CodexMappedRequest {
  const taskId = codexThreadTaskId(params.conversationId);
  const interactionId = codexInteractionId(
    "applyPatchApproval",
    requestId,
    params.conversationId,
    params.callId,
    "patch",
  );
  const changedFiles = Object.keys(params.fileChanges ?? {});

  const event: SourceHumanInputRequestedEvent = {
    id: codexEventId(requestId, "human.input.requested", params.callId),
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: codexSource(params.conversationId, context),
    toolFamily: "write",
    activityClass: "permission_request",
    title: "Approve Codex file changes",
    summary: params.reason ?? "Codex requested approval before applying file changes.",
    request: {
      kind: "approval",
    },
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      params.reason ?? "Codex requested approval before applying file changes.",
    ),
    ...(changedFiles.length > 0 || params.grantRoot
      ? {
          context: {
            items: [
              ...(params.grantRoot
                ? [createContextItem("rootPath", "Root Path", params.grantRoot)]
                : []),
              ...(changedFiles.length > 0
                ? [createContextItem("files", "Files", changedFiles.join(", "))]
                : []),
            ],
          },
        }
      : {}),
    ...(params.reason ? { provenance: { whyNow: params.reason } } : {}),
  };

  return {
    interactionId,
    taskId,
    events: [event],
  };
}
