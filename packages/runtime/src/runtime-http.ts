import type { IncomingMessage, ServerResponse } from "node:http";

export class RuntimeHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    hint?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export type RuntimeErrorDescription = {
  statusCode: number;
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

export async function readOptionalBody(
  req: IncomingMessage,
  bodyLimitBytes: number,
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > bodyLimitBytes) {
      throw new RuntimeHttpError(
        413,
        "body_too_large",
        `request body exceeded ${bodyLimitBytes} bytes`,
      );
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readOptionalJson(
  req: IncomingMessage,
  bodyLimitBytes: number,
): Promise<unknown | null> {
  const body = await readOptionalBody(req, bodyLimitBytes);
  if (body === null) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RuntimeHttpError(400, "invalid_json", "request body must be valid JSON");
  }
}

export async function readJson(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const parsed = await readOptionalJson(req, bodyLimitBytes);
  if (parsed === null) {
    throw new RuntimeHttpError(400, "empty_body", "request body is empty");
  }
  return parsed;
}

export async function readWorkPayload(
  req: IncomingMessage,
  bodyLimitBytes: number,
): Promise<unknown> {
  const body = await readOptionalBody(req, bodyLimitBytes);
  if (body === null) {
    throw new RuntimeHttpError(400, "empty_body", "request body is empty");
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new RuntimeHttpError(400, "empty_body", "request body is empty");
  }

  const contentType = readContentType(req.headers["content-type"]);
  if (contentType !== null) {
    if (isJsonContentType(contentType)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        throw new RuntimeHttpError(
          400,
          "invalid_work_json",
          "The request body declared JSON but could not be parsed.",
          "Use valid JSON for WorkEvent payloads or send plain text with Content-Type: text/plain.",
        );
      }
    }

    if (contentType === "text/plain") {
      return trimmed;
    }
  }

  if (looksLikeJsonObjectOrArray(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new RuntimeHttpError(
        400,
        "invalid_work_json",
        "The request body looked like JSON, but it could not be parsed.",
        "Use valid JSON for WorkEvent payloads or send plain text with Content-Type: text/plain.",
      );
    }
  }

  return trimmed;
}

export function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
): void {
  if (res.writableEnded) {
    return;
  }
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "null",
    Vary: "Origin",
    Connection: "close",
  });
  res.end(JSON.stringify(body));
}

export function writeError(res: ServerResponse<IncomingMessage>, error: unknown): void {
  const described = describeRuntimeError(error);
  writeJson(res, described.statusCode, {
    error: {
      code: described.code,
      message: described.message,
      ...(described.hint !== undefined ? { hint: described.hint } : {}),
      ...(described.details ?? {}),
    },
  });
}

export function describeRuntimeError(error: unknown): RuntimeErrorDescription {
  if (error instanceof RuntimeHttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.hint !== undefined ? { hint: error.hint } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  return {
    statusCode: 500,
    code: "internal_error",
    message: error instanceof Error ? error.message : "internal error",
  };
}

export function requestBaseUrl(
  req: IncomingMessage,
  fallbackHost: string,
  fallbackPort: number,
): string {
  const host = req.headers.host?.trim();
  if (host && host.length > 0) {
    return `http://${host.replace(/\/+$/, "")}`;
  }
  return `http://${fallbackHost}:${fallbackPort}`;
}

export function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readContentType(header: string | string[] | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  return value.split(";")[0]?.trim().toLowerCase() ?? null;
}

function isJsonContentType(contentType: string): boolean {
  return contentType === "application/json" || contentType.endsWith("+json");
}

function looksLikeJsonObjectOrArray(body: string): boolean {
  return body.startsWith("{") || body.startsWith("[");
}
