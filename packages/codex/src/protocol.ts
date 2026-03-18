export type JsonRpcId = string | number;

export type CodexClientInfo = {
  name: string;
  title?: string;
  version: string;
};

export type CodexInputItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    }
  | {
      type: "mention";
      name: string;
      path: string;
    };

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type CodexTurnStartParams = {
  threadId: string;
  input: CodexInputItem[];
  cwd?: string;
  approvalPolicy?: string;
  sandboxPolicy?: Record<string, unknown>;
  model?: string;
  effort?: CodexReasoningEffort;
  summary?: string;
  personality?: string;
  outputSchema?: Record<string, unknown>;
};

export type CodexTurnSteerParams = {
  threadId: string;
  input: CodexInputItem[];
};

export type CodexTurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type CodexReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string };

export type CodexReviewDelivery = "inline" | "detached";

export type CodexReviewStartParams = {
  threadId: string;
  target: CodexReviewTarget;
  delivery?: CodexReviewDelivery;
};

export type CodexThreadStartParams = {
  cwd?: string;
  model?: string;
};

export type CodexThreadResumeParams = {
  threadId: string;
};

export type CodexInitializeParams = {
  clientInfo: CodexClientInfo;
};

export type CodexInitializeResult = {
  userAgent: string;
};

export type CodexTurn = {
  id: string;
  status: string;
  items: Array<Record<string, unknown>>;
  error: Record<string, unknown> | null;
};

export type CodexThread = {
  id: string;
  preview: string;
  status: { type: string; activeFlags?: string[] };
  cwd: string;
  path?: string | null;
  name?: string | null;
  turns: CodexTurn[];
};

export type CodexThreadStartResult = {
  thread: CodexThread;
};

export type CodexThreadResumeResult = {
  thread: CodexThread;
};

export type CodexTurnStartResult = {
  turn: CodexTurn;
};

export type CodexTurnSteerResult = {
  turnId: string;
};

export type CodexReviewStartResult = {
  turn: CodexTurn;
  reviewThreadId: string;
};

export type CodexCommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: string[];
      };
    }
  | {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: Record<string, unknown>;
      };
    };

export type CodexFileChangeApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type CodexToolRequestUserInputOption = {
  label: string;
  description: string;
};

export type CodexToolRequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: CodexToolRequestUserInputOption[] | null;
};

export type CodexCommandExecutionRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  networkApprovalContext?: Record<string, unknown> | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: Array<Record<string, unknown>> | null;
  additionalPermissions?: Record<string, unknown> | null;
  skillMetadata?: Record<string, unknown> | null;
  proposedExecpolicyAmendment?: string[] | null;
  proposedNetworkPolicyAmendments?: Array<Record<string, unknown>> | null;
  availableDecisions?: CodexCommandExecutionApprovalDecision[] | null;
};

export type CodexFileChangeRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
};

export type CodexToolRequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexToolRequestUserInputQuestion[];
};

export type CodexServerRequest =
  | {
      method: "item/commandExecution/requestApproval";
      id: JsonRpcId;
      params: CodexCommandExecutionRequestApprovalParams;
    }
  | {
      method: "item/fileChange/requestApproval";
      id: JsonRpcId;
      params: CodexFileChangeRequestApprovalParams;
    }
  | {
      method: "item/tool/requestUserInput";
      id: JsonRpcId;
      params: CodexToolRequestUserInputParams;
    };

export type CodexThreadStartedNotification = {
  thread: CodexThread;
};

export type CodexThreadStatusChangedNotification = {
  threadId: string;
  status: { type: string; activeFlags?: string[] };
};

export type CodexTurnStartedNotification = {
  threadId: string;
  turn: CodexTurn;
};

export type CodexTurnCompletedNotification = {
  threadId: string;
  turn: CodexTurn;
};

export type CodexThreadItem =
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: Array<Record<string, unknown>>;
      status: string;
    }
  | {
      type: "enteredReviewMode";
      id: string;
      review: string;
    }
  | {
      type: "exitedReviewMode";
      id: string;
      review: string;
    }
  | {
      type: string;
      id: string;
      [key: string]: unknown;
    };

export type CodexItemStartedNotification = {
  threadId: string;
  turnId: string;
  item: CodexThreadItem;
};

export type CodexItemCompletedNotification = {
  threadId: string;
  turnId: string;
  item: CodexThreadItem;
};

export type CodexServerRequestResolvedNotification = {
  threadId: string;
  requestId: JsonRpcId;
};

export type CodexServerNotification =
  | {
      method: "thread/started";
      params: CodexThreadStartedNotification;
    }
  | {
      method: "thread/status/changed";
      params: CodexThreadStatusChangedNotification;
    }
  | {
      method: "turn/started";
      params: CodexTurnStartedNotification;
    }
  | {
      method: "turn/completed";
      params: CodexTurnCompletedNotification;
    }
  | {
      method: "item/started";
      params: CodexItemStartedNotification;
    }
  | {
      method: "item/completed";
      params: CodexItemCompletedNotification;
    }
  | {
      method: "serverRequest/resolved";
      params: CodexServerRequestResolvedNotification;
    };

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

export type CodexClientNotification = {
  method: "initialized";
};

export type CodexJsonRpcEnvelope =
  | CodexJsonRpcSuccess
  | CodexJsonRpcError
  | CodexServerRequest
  | CodexServerNotification
  | CodexClientNotification
  | CodexJsonRpcRequest;

export function isCodexServerRequest(value: unknown): value is CodexServerRequest {
  if (!isObject(value) || typeof value.method !== "string" || !("id" in value)) {
    return false;
  }
  return (
    value.method === "item/commandExecution/requestApproval"
    || value.method === "item/fileChange/requestApproval"
    || value.method === "item/tool/requestUserInput"
  );
}

export function isCodexServerNotification(value: unknown): value is CodexServerNotification {
  if (!isObject(value) || typeof value.method !== "string" || ("id" in value)) {
    return false;
  }
  return (
    value.method === "thread/started"
    || value.method === "thread/status/changed"
    || value.method === "turn/started"
    || value.method === "turn/completed"
    || value.method === "item/started"
    || value.method === "item/completed"
    || value.method === "serverRequest/resolved"
  );
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

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
