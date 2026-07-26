import { readResponseJsonWithLimit } from "./public-corpus-fetch-body.js";

const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export type PublicCorpusFetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

export type PublicCorpusSleep = (delayMs: number) => Promise<void>;

export type PublicCorpusFetchPolicy = {
  timeoutMs: number;
  maxRetries: number;
  maxBytes?: number;
  fetch?: PublicCorpusFetchLike;
  sleep?: PublicCorpusSleep;
};

export async function fetchJsonWithPolicy(
  url: string,
  policy: PublicCorpusFetchPolicy,
): Promise<unknown> {
  const fetchFn = policy.fetch ?? fetch;
  const sleepFn = policy.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);

    try {
      const response = await fetchFn(url, { signal: controller.signal });

      if (response.ok) {
        const payload = await readResponseJsonWithLimit(
          response,
          controller.signal,
          policy.maxBytes,
        );
        clearTimeout(timeout);
        return payload;
      }

      clearTimeout(timeout);
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= policy.maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);
      }

      await sleepFn(readRetryDelayMs(response, attempt));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= policy.maxRetries || !isRetryableFetchError(error)) {
        break;
      }
      await sleepFn(DEFAULT_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function readRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return DEFAULT_RETRY_BASE_DELAY_MS * 2 ** attempt;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return DEFAULT_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  return error.name === "AbortError" || error.name === "TypeError";
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
