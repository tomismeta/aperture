import type {
  OpencodeClientOptions,
  OpencodeListPermissionsResponse,
  OpencodeListQuestionsResponse,
  OpencodePermissionReplyInput,
  OpencodePermissionRespondInput,
  OpencodeQuestionRejectInput,
  OpencodeQuestionReplyInput,
  OpencodeSessionPromptInput,
  OpencodeSseMessage,
} from "./types.js";

export type OpencodeEventStreamOptions = {
  signal?: AbortSignal;
};

export type OpencodeSseHandler = (event: OpencodeSseMessage) => void | Promise<void>;

export class OpencodeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;
  private readonly scope: OpencodeClientOptions["scope"];
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpencodeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.scope = options.scope;
    this.extraHeaders = options.headers ?? {};
    this.authHeader = options.auth
      ? `Basic ${Buffer.from(`${options.auth.username ?? "opencode"}:${options.auth.password}`).toString("base64")}`
      : null;
  }

  async listPermissions(): Promise<OpencodeListPermissionsResponse> {
    return this.get<OpencodeListPermissionsResponse>("/permission");
  }

  async listQuestions(): Promise<OpencodeListQuestionsResponse> {
    return this.get<OpencodeListQuestionsResponse>("/question");
  }

  async replyToPermission(requestId: string, input: OpencodePermissionReplyInput): Promise<unknown> {
    return this.post(`/permission/${encodeURIComponent(requestId)}/reply`, input);
  }

  async respondToSessionPermission(
    sessionId: string,
    requestId: string,
    input: OpencodePermissionRespondInput,
  ): Promise<unknown> {
    return this.post(
      `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}`,
      input,
    );
  }

  async replyToQuestion(requestId: string, input: OpencodeQuestionReplyInput): Promise<unknown> {
    return this.post(`/question/${encodeURIComponent(requestId)}/reply`, input);
  }

  async rejectQuestion(requestId: string, input: OpencodeQuestionRejectInput = {}): Promise<unknown> {
    return this.post(`/question/${encodeURIComponent(requestId)}/reject`, input);
  }

  async promptSession(sessionId: string, input: OpencodeSessionPromptInput): Promise<unknown> {
    return this.post(`/session/${encodeURIComponent(sessionId)}/message`, input);
  }

  async *streamEvents(
    options: OpencodeEventStreamOptions = {},
  ): AsyncGenerator<OpencodeSseMessage, void, undefined> {
    const response = await fetch(this.requestUrl("/event"), {
      headers: this.requestHeaders({
        Accept: "text/event-stream",
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(`OpenCode request failed: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error("OpenCode SSE stream did not include a response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundary = findSseBoundary(buffer);
        if (boundary < 0) {
          break;
        }

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer.startsWith("\r\n\r\n", boundary) ? 4 : 2));
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          yield parsed;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim() !== "") {
      const parsed = parseSseEvent(buffer);
      if (parsed) {
        yield parsed;
      }
    }
  }

  async consumeEvents(
    handler: OpencodeSseHandler,
    options: OpencodeEventStreamOptions = {},
  ): Promise<void> {
    for await (const event of this.streamEvents(options)) {
      await handler(event);
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(this.requestUrl(path), {
      headers: this.requestHeaders(),
    });
    if (!response.ok) {
      throw new Error(`OpenCode request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await fetch(this.requestUrl(path), {
      method: "POST",
      headers: this.requestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`OpenCode request failed: ${response.status} ${response.statusText}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  private requestUrl(path: string): string {
    const url = new URL(path, `${this.baseUrl}/`);
    if (this.scope?.directory && this.scope.mode === "query") {
      url.searchParams.set("directory", this.scope.directory);
    }
    return url.toString();
  }

  private requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      ...extra,
    };
    if (this.authHeader) {
      headers.Authorization = this.authHeader;
    }
    if (this.scope?.directory && this.scope.mode !== "query") {
      headers["x-opencode-directory"] = this.scope.directory;
    }
    return headers;
  }
}

function findSseBoundary(buffer: string): number {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf < 0) {
    return lf;
  }
  if (lf < 0) {
    return crlf;
  }
  return Math.min(crlf, lf);
}

function parseSseEvent(raw: string): OpencodeSseMessage | null {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return normalizeSseMessage(JSON.parse(dataLines.join("\n")));
  } catch {
    return null;
  }
}

function normalizeSseMessage(value: unknown): OpencodeSseMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && "properties" in record) {
    return record as OpencodeSseMessage;
  }
  if (record.payload && typeof record.payload === "object") {
    const payload = record.payload as Record<string, unknown>;
    if (typeof payload.type === "string" && "properties" in payload) {
      return payload as OpencodeSseMessage;
    }
  }
  return null;
}
