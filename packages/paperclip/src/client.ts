import type { PaperclipAction, PaperclipLiveEvent } from "./index.js";

export type PaperclipClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export async function* streamPaperclipLiveEvents(
  companyId: string,
  options: PaperclipClientOptions,
): AsyncGenerator<PaperclipLiveEvent, void, void> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(
    `${trimTrailingSlash(options.baseUrl)}/api/companies/${encodeURIComponent(companyId)}/events/ws`,
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
  const response = await fetchImpl(`${trimTrailingSlash(options.baseUrl)}${action.path}`, {
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
