import type { PaperclipAction, PaperclipLiveEvent } from "./index.js";

export type PaperclipClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

const MAX_SSE_BUFFER_BYTES = 256 * 1024;

export async function* streamPaperclipLiveEvents(
  companyId: string,
  options: PaperclipClientOptions,
): AsyncGenerator<PaperclipLiveEvent, void, void> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const response = await fetchImpl(
    `${baseUrl}/api/companies/${encodeURIComponent(companyId)}/events/ws`,
    {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...(options.headers ?? {}),
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Paperclip live event stream failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Paperclip live event stream returned no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      assertBufferSize(buffer);

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        const event = parseServerSentEvent(rawEvent);
        if (event) {
          yield event;
        }
        boundaryIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const trailingEvent = parseServerSentEvent(buffer);
    if (trailingEvent) {
      yield trailingEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function executePaperclipAction(
  action: PaperclipAction,
  options: PaperclipClientOptions,
): Promise<Response> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const response = await fetchImpl(`${baseUrl}${action.path}`, {
    method: action.method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...(action.body !== undefined ? { body: JSON.stringify(action.body) } : {}),
  });

  if (!response.ok) {
    throw new Error(`Paperclip action ${action.kind} failed with status ${response.status}`);
  }

  return response;
}

function parseServerSentEvent(rawEvent: string): PaperclipLiveEvent | null {
  if (rawEvent.trim().length === 0) {
    return null;
  }

  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return JSON.parse(dataLines.join("\n")) as PaperclipLiveEvent;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Paperclip baseUrl must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Paperclip baseUrl must use http or https");
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("Paperclip baseUrl must not include embedded credentials");
  }

  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function assertBufferSize(buffer: string): void {
  if (buffer.length > MAX_SSE_BUFFER_BYTES) {
    throw new Error(`Paperclip live event stream exceeded ${MAX_SSE_BUFFER_BYTES} bytes without an event boundary`);
  }
}
