import type {
  AttentionField as FrameField,
  AttentionResponse as FrameResponse,
  ConformedEvent,
  ConformedHumanInputRequestedEvent,
  SourceRef,
} from "@aperture/core";

export type JsonRpcId = string | number;

export type CodexServerRequest =
  | CodexCommandApprovalRequest
  | CodexLegacyExecApprovalRequest
  | CodexToolRequestUserInputRequest;

export type CodexCommandApprovalRequest = {
  id: JsonRpcId;
  method: "item/commandExecution/requestApproval";
  params: {
    itemId: string;
    threadId: string;
    turnId: string;
    approvalId?: string | null;
    command?: string | null;
    cwd?: string | null;
    reason?: string | null;
  };
};

export type CodexLegacyExecApprovalRequest = {
  id: JsonRpcId;
  method: "execCommandApproval";
  params: {
    callId: string;
    conversationId: string;
    approvalId?: string | null;
    command: string[];
    cwd: string;
    reason?: string | null;
  };
};

export type CodexToolRequestUserInputRequest = {
  id: JsonRpcId;
  method: "item/tool/requestUserInput";
  params: {
    itemId: string;
    threadId: string;
    turnId: string;
    questions: CodexQuestion[];
  };
};

export type CodexQuestion = {
  header: string;
  id: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: CodexQuestionOption[] | null;
};

export type CodexQuestionOption = {
  label: string;
  description: string;
};

export type CodexClientResponse =
  | {
      id: JsonRpcId;
      result: {
        decision: "approved" | "denied" | "abort";
      };
    }
  | {
      id: JsonRpcId;
      result: {
        answers: Record<string, { answers: string[] }>;
      };
    };

export type CodexEventHost = {
  publishConformed(event: ConformedEvent): void | Promise<void>;
  publishConformedBatch?(events: ConformedEvent[]): void | Promise<void>;
  onResponse(listener: (response: FrameResponse) => void): () => void;
};

export type CodexResponseSink = {
  sendCodexResponse(response: CodexClientResponse): void | Promise<void>;
};

export type CodexAdapter = {
  handleCodexRequest(request: CodexServerRequest): Promise<void>;
  close(): void;
};

export function mapCodexServerRequest(request: CodexServerRequest): ConformedEvent[] {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return [mapCommandApprovalRequest(request)];
    case "execCommandApproval":
      return [mapLegacyExecApprovalRequest(request)];
    case "item/tool/requestUserInput":
      return mapToolRequestUserInputRequest(request);
  }
}

export function mapCodexFrameResponse(response: FrameResponse): CodexClientResponse | null {
  const parsed = parseCodexInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "approval") {
    switch (response.response.kind) {
      case "acknowledged":
        return null;
      case "approved":
        return { id: parsed.requestId, result: { decision: "approved" } };
      case "rejected":
        return { id: parsed.requestId, result: { decision: "denied" } };
      case "dismissed":
        return { id: parsed.requestId, result: { decision: "abort" } };
      case "option_selected":
      case "form_submitted":
        return null;
    }
  }

  if (parsed.kind === "choice" && response.response.kind === "option_selected") {
    return {
      id: parsed.requestId,
      result: {
        answers: {
          [parsed.questionId]: {
            answers: response.response.optionIds,
          },
        },
      },
    };
  }

  if (parsed.kind === "form" && response.response.kind === "form_submitted") {
    const answers: Record<string, { answers: string[] }> = {};
    for (const [questionId, value] of Object.entries(response.response.values)) {
      answers[questionId] = {
        answers: normalizeAnswer(value),
      };
    }
    return {
      id: parsed.requestId,
      result: { answers },
    };
  }

  return null;
}

export function createCodexAdapter(
  host: CodexEventHost,
  sink: CodexResponseSink,
): CodexAdapter {
  const unsubscribe = host.onResponse((response) => {
    const codexResponse = mapCodexFrameResponse(response);
    if (!codexResponse) {
      return;
    }
    void Promise.resolve(sink.sendCodexResponse(codexResponse));
  });

  return {
    async handleCodexRequest(request) {
      const events = mapCodexServerRequest(request);
      if (events.length === 0) {
        return;
      }

      if (host.publishConformedBatch) {
        await host.publishConformedBatch(events);
        return;
      }

      for (const event of events) {
        await host.publishConformed(event);
      }
    },
    close() {
      unsubscribe();
    },
  };
}

function mapCommandApprovalRequest(request: CodexCommandApprovalRequest): ConformedHumanInputRequestedEvent {
  const source = codexSource(request.params.threadId);
  const title = request.params.command ? "Approve Codex command" : "Approve Codex action";
  const contextItems = [
    request.params.command
      ? { id: "command", label: "Command", value: request.params.command }
      : null,
    request.params.cwd ? { id: "cwd", label: "Working directory", value: request.params.cwd } : null,
  ].filter((item): item is { id: string; label: string; value: string } => item !== null);

  return {
    id: codexEventId(request.id, "human.input.requested"),
    type: "human.input.requested",
    taskId: codexTaskId(request.params.threadId, request.params.turnId),
    interactionId: codexApprovalInteractionId(request.id, request.params.itemId),
    timestamp: new Date().toISOString(),
    source,
    title,
    summary: request.params.reason ?? "Codex requested approval before continuing.",
    request: {
      kind: "approval",
    },
    ...(contextItems.length > 0 ? { context: { items: contextItems } } : {}),
    ...(request.params.reason
      ? {
          provenance: {
            whyNow: request.params.reason,
          },
        }
      : {}),
  };
}

function mapLegacyExecApprovalRequest(request: CodexLegacyExecApprovalRequest): ConformedHumanInputRequestedEvent {
  return {
    id: codexEventId(request.id, "human.input.requested"),
    type: "human.input.requested",
    taskId: codexTaskId(request.params.conversationId, request.params.callId),
    interactionId: codexApprovalInteractionId(request.id, request.params.callId),
    timestamp: new Date().toISOString(),
    source: codexSource(request.params.conversationId),
    title: "Approve Codex command",
    summary: request.params.reason ?? "Codex requested approval before executing a command.",
    request: {
      kind: "approval",
    },
    context: {
      items: [
        { id: "command", label: "Command", value: request.params.command.join(" ") },
        { id: "cwd", label: "Working directory", value: request.params.cwd },
      ],
    },
    ...(request.params.reason
      ? {
          provenance: {
            whyNow: request.params.reason,
          },
        }
      : {}),
  };
}

function mapToolRequestUserInputRequest(request: CodexToolRequestUserInputRequest): ConformedEvent[] {
  if (request.params.questions.length === 0) {
    return [];
  }

  const source = codexSource(request.params.threadId);
  const taskId = codexTaskId(request.params.threadId, request.params.turnId);
  const firstQuestion = request.params.questions[0];

  if (firstQuestion && request.params.questions.length === 1 && firstQuestion.options && firstQuestion.options.length > 0) {
    const question = firstQuestion;
    const options = question.options ?? [];
    return [
      {
        id: codexEventId(request.id, "human.input.requested"),
        type: "human.input.requested",
        taskId,
        interactionId: codexChoiceInteractionId(request.id, request.params.itemId, question.id),
        timestamp: new Date().toISOString(),
        source,
        title: question.question || question.header || "Codex needs input",
        summary: question.header ? `${question.header} selection` : "Codex requested a choice before continuing.",
        request: {
          kind: "choice",
          selectionMode: "single",
          options: options.map((option) => ({
            id: option.label,
            label: option.label,
            summary: option.description,
          })),
        },
      },
    ];
  }

  const fields: FrameField[] = request.params.questions.map((question) => ({
    id: question.id,
    label: question.header || question.question,
    type: question.options?.length ? "select" : "text",
    required: true,
    helpText: question.question,
    ...(question.options?.length
      ? {
          options: question.options.map((option) => ({
            value: option.label,
            label: option.label,
          })),
        }
      : {}),
  }));

  return [
    {
      id: codexEventId(request.id, "human.input.requested"),
      type: "human.input.requested",
      taskId,
      interactionId: codexFormInteractionId(request.id, request.params.itemId),
      timestamp: new Date().toISOString(),
      source,
      title:
        request.params.questions.length === 1
          ? (firstQuestion?.question ?? firstQuestion?.header ?? "Codex needs input")
          : "Provide Codex input",
      summary:
        request.params.questions.length === 1
          ? (firstQuestion?.header ? `${firstQuestion.header} required before continuing.` : "Codex requested user input before continuing.")
          : `Codex requested ${request.params.questions.length} inputs before continuing.`,
      request: {
        kind: "form",
        fields,
      },
      context: {
        items: request.params.questions.map((question) => ({
          id: question.id,
          label: question.header,
          value: question.question,
        })),
      },
    },
  ];
}

function normalizeAnswer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value)];
}

function codexSource(threadId: string): SourceRef {
  return {
    id: threadId,
    kind: "codex",
    label: "Codex",
  };
}

function codexTaskId(threadId: string, turnId: string): string {
  return `codex:thread:${encodeURIComponent(threadId)}:turn:${encodeURIComponent(turnId)}`;
}

function codexApprovalInteractionId(requestId: JsonRpcId, itemId: string): string {
  return `codex:approval:${encodeURIComponent(String(requestId))}:${encodeURIComponent(itemId)}`;
}

function codexChoiceInteractionId(requestId: JsonRpcId, itemId: string, questionId: string): string {
  return `codex:choice:${encodeURIComponent(String(requestId))}:${encodeURIComponent(itemId)}:${encodeURIComponent(questionId)}`;
}

function codexFormInteractionId(requestId: JsonRpcId, itemId: string): string {
  return `codex:form:${encodeURIComponent(String(requestId))}:${encodeURIComponent(itemId)}`;
}

function codexEventId(requestId: JsonRpcId, type: ConformedEvent["type"]): string {
  return `codex:${encodeURIComponent(String(requestId))}:${type}`;
}

function parseCodexInteractionId(
  interactionId: string,
):
  | { kind: "approval"; requestId: JsonRpcId }
  | { kind: "choice"; requestId: JsonRpcId; questionId: string }
  | { kind: "form"; requestId: JsonRpcId }
  | null {
  const parts = interactionId.split(":");
  if (parts.length < 4 || parts[0] !== "codex") {
    return null;
  }

  const requestIdPart = parts[2];
  if (!requestIdPart) {
    return null;
  }
  const requestId = decodeRequestId(requestIdPart);

  switch (parts[1]) {
    case "approval":
      return { kind: "approval", requestId };
    case "choice":
      if (parts.length < 5) {
        return null;
      }
      if (!parts[4]) {
        return null;
      }
      return {
        kind: "choice",
        requestId,
        questionId: decodeURIComponent(parts[4]),
      };
    case "form":
      return { kind: "form", requestId };
    default:
      return null;
  }
}

function decodeRequestId(value: string): JsonRpcId {
  const decoded = decodeURIComponent(value);
  return /^-?\d+$/.test(decoded) ? Number(decoded) : decoded;
}
