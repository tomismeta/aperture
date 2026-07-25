const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

export async function readResponseJsonWithLimit(
  response: Response,
  signal: AbortSignal,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, signal, maxBytes);
  return JSON.parse(text) as unknown;
}

async function readResponseTextWithLimit(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    assertResponseSize(Buffer.byteLength(text, "utf8"), maxBytes);
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelReader = (): void => {
    void reader.cancel();
  };
  signal.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      if (signal.aborted) throw createAbortError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw createAbortError();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        assertResponseSize(totalBytes, maxBytes);
        chunks.push(value);
      }
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }

  return new TextDecoder().decode(concatenateChunks(chunks, totalBytes));
}

function concatenateChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function assertResponseSize(totalBytes: number, maxBytes: number): void {
  if (totalBytes > maxBytes) {
    throw new Error(`Response body exceeded ${maxBytes} bytes.`);
  }
}

function createAbortError(): Error {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}
