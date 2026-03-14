export type OpencodeProjectScopeMode = "header" | "query";

export type OpencodeDirectoryScope = {
  directory: string;
  mode?: OpencodeProjectScopeMode;
};

export type OpencodeAuthOptions = {
  username?: string;
  password: string;
};

export type OpencodeReconnectOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  heartbeatTimeoutMs?: number;
  maxAttempts?: number;
};

export type OpencodeScopedRequestOptions = {
  auth?: OpencodeAuthOptions;
  scope?: OpencodeDirectoryScope;
  headers?: Record<string, string>;
};

export type OpencodeClientOptions = OpencodeScopedRequestOptions & {
  baseUrl: string;
  reconnect?: OpencodeReconnectOptions;
};

export type OpencodePermissionDecision = "once" | "always" | "reject";

export type OpencodePermissionAnswer = {
  reply: OpencodePermissionDecision;
  message?: string;
};

export type OpencodePermissionReplyInput = OpencodePermissionAnswer;

export type OpencodeQuestionReplyInput = {
  answers: string[][];
};

export type OpencodeQuestionRejectInput = {
  message?: string;
};

export type OpencodeToolCallPattern = {
  value?: string;
  source?: string;
  [key: string]: unknown;
};

export type OpencodePermissionMetadata = {
  sessionID?: string;
  tool?: string;
  callID?: string;
  title?: string;
  description?: string;
  patterns?: OpencodeToolCallPattern[];
  [key: string]: unknown;
};

export type OpencodePermissionListItem = {
  id: string;
  sessionID?: string;
  message?: string;
  title?: string;
  metadata?: OpencodePermissionMetadata;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type OpencodeQuestionOption = {
  label: string;
  value?: string;
  description?: string;
  selected?: boolean;
  [key: string]: unknown;
};

export type OpencodeQuestionField = {
  id: string;
  label: string;
  kind?: string;
  required?: boolean;
  placeholder?: string;
  options?: OpencodeQuestionOption[];
  [key: string]: unknown;
};

export type OpencodeQuestionPrompt = {
  id?: string;
  header?: string;
  label?: string;
  prompt?: string;
  allowCustomInput?: boolean;
  multiSelect?: boolean;
  options?: OpencodeQuestionOption[];
  fields?: OpencodeQuestionField[];
  [key: string]: unknown;
};

export type OpencodeQuestionForm = {
  title?: string;
  prompts: OpencodeQuestionPrompt[];
  [key: string]: unknown;
};

export type OpencodeQuestionListItem = {
  id: string;
  sessionID?: string;
  title?: string;
  message?: string;
  questions?: OpencodeQuestionPrompt[];
  form?: OpencodeQuestionForm;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type OpencodeListPermissionsResponse = OpencodePermissionListItem[];

export type OpencodeListQuestionsResponse = OpencodeQuestionListItem[];

export type OpencodeSseEvent<TType extends string = string, TData = unknown> = {
  type: TType;
  properties: TData;
};

export type OpencodeServerConnectedEvent = OpencodeSseEvent<
  "server.connected",
  {
    connectedAt?: string;
    serverVersion?: string;
    [key: string]: unknown;
  }
>;

export type OpencodeServerHeartbeatEvent = OpencodeSseEvent<
  "server.heartbeat",
  {
    timestamp?: string;
    [key: string]: unknown;
  }
>;

export type OpencodePermissionAskedEvent = OpencodeSseEvent<
  "permission.asked",
  OpencodePermissionListItem
>;

export type OpencodePermissionRepliedEvent = OpencodeSseEvent<
  "permission.replied",
  {
    id: string;
    sessionID?: string;
    reply?: OpencodePermissionDecision;
    message?: string;
    [key: string]: unknown;
  }
>;

export type OpencodeQuestionAskedEvent = OpencodeSseEvent<
  "question.asked",
  OpencodeQuestionListItem
>;

export type OpencodeQuestionRepliedEvent = OpencodeSseEvent<
  "question.replied",
  {
    id: string;
    sessionID?: string;
    answers?: string[][];
    [key: string]: unknown;
  }
>;

export type OpencodeQuestionRejectedEvent = OpencodeSseEvent<
  "question.rejected",
  {
    id: string;
    sessionID?: string;
    message?: string;
    [key: string]: unknown;
  }
>;

export type OpencodeSessionStatusEvent = OpencodeSseEvent<
  "session.status",
  {
    sessionID?: string;
    status?: string;
    reason?: string;
    [key: string]: unknown;
  }
>;

export type OpencodeMessagePartUpdatedEvent = OpencodeSseEvent<
  "message.part.updated",
  {
    sessionID?: string;
    messageID?: string;
    partID?: string;
    part?: Record<string, unknown>;
    [key: string]: unknown;
  }
>;

export type OpencodeUnknownEvent = OpencodeSseEvent<string, Record<string, unknown>>;

export type OpencodeSupportedEvent =
  | OpencodeServerConnectedEvent
  | OpencodeServerHeartbeatEvent
  | OpencodePermissionAskedEvent
  | OpencodePermissionRepliedEvent
  | OpencodeQuestionAskedEvent
  | OpencodeQuestionRepliedEvent
  | OpencodeQuestionRejectedEvent
  | OpencodeSessionStatusEvent
  | OpencodeMessagePartUpdatedEvent;

export type OpencodeEventType = OpencodeSupportedEvent["type"];

export type OpencodeSseMessage = OpencodeSupportedEvent | OpencodeUnknownEvent;
