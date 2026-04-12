import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "@tomismeta/aperture-core";

import type { ApertureRuntimeSnapshot } from "./runtime-contract.js";
import { readRuntimeAuthToken } from "./runtime-auth.js";
import { discoverLocalRuntimes } from "./runtime-discovery.js";

export const DEFAULT_RUNTIME_POLL_INTERVAL_MS = 250;

type RuntimeErrorEnvelope = {
  error?:
    | string
    | {
        code?: string;
        message?: string;
        hint?: string;
      };
};

export class ApertureRuntimeRequestError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code: string | undefined;
  readonly hint: string | undefined;
  readonly body: unknown;

  constructor(options: {
    status: number;
    statusText: string;
    message: string;
    code?: string;
    hint?: string;
    body?: unknown;
  }) {
    super(options.message);
    this.name = "ApertureRuntimeRequestError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.code = options.code;
    this.hint = options.hint;
    this.body = options.body;
  }
}

export function createEmptyRuntimeSnapshot(): ApertureRuntimeSnapshot {
  return {
    version: 0,
    attentionView: { now: null, next: [], ambient: [] },
    signalSummary: {
      recentSignals: 0,
      lifetimeSignals: 0,
      counts: {
        presented: 0,
        viewed: 0,
        responded: 0,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      deferred: {
        next: 0,
        suppressed: 0,
        manual: 0,
      },
      responseRate: 0,
      dismissalRate: 0,
      averageResponseLatencyMs: null,
      averageDismissalLatencyMs: null,
      lastSignalAt: null,
    },
    attentionState: "monitoring",
    adapters: [],
    surfaceCount: 0,
    surfaceCapabilities: {
      topology: {
        supportsAmbient: baseAttentionSurfaceCapabilities.topology.supportsAmbient,
      },
      responses: {
        supportsSingleChoice: baseAttentionSurfaceCapabilities.responses.supportsSingleChoice,
        supportsMultipleChoice: baseAttentionSurfaceCapabilities.responses.supportsMultipleChoice,
        supportsForm: baseAttentionSurfaceCapabilities.responses.supportsForm,
        supportsTextResponse: baseAttentionSurfaceCapabilities.responses.supportsTextResponse,
      },
    } satisfies AttentionSurfaceCapabilities,
    health: {
      startedAt: new Date(0).toISOString(),
      adapters: {
        count: 0,
        ttlMs: 0,
      },
      surfaces: {
        count: 0,
        ttlMs: 0,
      },
      capture: {
        currentSequence: 0,
        currentCaptureSequence: 0,
        eventFeedCount: 0,
        captureSteps: 0,
        publishedSourceEvents: 0,
        submittedResponses: 0,
        signals: 0,
        traces: 0,
        attentionViewSnapshots: 0,
        eventFeedLimit: 0,
        captureLogLimit: 0,
      },
      workResponses: {
        total: 0,
        counts: {
          pending: 0,
          answered: 0,
          expired: 0,
          cancelled: 0,
        },
        capacity: 0,
        pendingTtlMs: 0,
        retentionMs: 0,
        persistenceOk: true,
        lastPersistedAt: null,
        lastPersistenceError: null,
        lastPersistenceErrorAt: null,
      },
      telemetry: {
        totalRequests: 0,
        activeRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        unauthorizedRequests: 0,
        rateLimitedRequests: 0,
        rejectedOriginRequests: 0,
        lastRequestAt: null,
        lastCompletedAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        routes: [],
        recentErrors: [],
      },
      core: {
        attentionState: "monitoring",
        operatorPresence: "present",
        responseExpiryMs: null,
        surfaceCapabilities: {
          topology: {
            supportsAmbient: baseAttentionSurfaceCapabilities.topology.supportsAmbient,
          },
          responses: {
            supportsSingleChoice: baseAttentionSurfaceCapabilities.responses.supportsSingleChoice,
            supportsMultipleChoice:
              baseAttentionSurfaceCapabilities.responses.supportsMultipleChoice,
            supportsForm: baseAttentionSurfaceCapabilities.responses.supportsForm,
            supportsTextResponse: baseAttentionSurfaceCapabilities.responses.supportsTextResponse,
          },
        },
        listeners: {
          totalActive: 0,
          frame: emptyListenerHealth(),
          taskView: emptyListenerHealth(),
          attentionView: emptyListenerHealth(),
          response: emptyListenerHealth(),
          signal: emptyListenerHealth(),
          trace: emptyListenerHealth(),
          internalTrace: emptyListenerHealth(),
        },
        stores: {
          taskViews: {
            taskCount: 0,
            nowCount: 0,
            nextCount: 0,
            ambientCount: 0,
            totalFrames: 0,
          },
          signals: {
            taskCount: 0,
            signalCount: 0,
            oldestSignalAt: null,
            latestSignalAt: null,
            taskRetentionMs: 0,
            maxTrackedTasks: 0,
            prunedTasks: 0,
          },
          episodes: {
            activeRecords: 0,
            dormantRecords: 0,
            retainedRecords: 0,
            boundInteractions: 0,
            dormantRetentionMs: 0,
            maxDormantRecords: 0,
            prunedRecords: 0,
            latestEpisodeAt: null,
          },
        },
      },
    },
  };
}

export function normalizeRuntimeUrls(input: string): { baseUrl: string; controlUrl: string } {
  const normalized = input.replace(/\/+$/, "");
  if (normalized.endsWith("/runtime")) {
    return {
      baseUrl: normalized.slice(0, -"/runtime".length),
      controlUrl: normalized,
    };
  }
  return {
    baseUrl: normalized,
    controlUrl: `${normalized}/runtime`,
  };
}

export async function resolveRuntimeAuthToken(
  input: string,
  explicitToken?: string,
): Promise<string> {
  if (explicitToken) {
    return explicitToken;
  }

  const urls = normalizeRuntimeUrls(input);
  const runtimes = await discoverLocalRuntimes();
  const runtime = runtimes.find(
    (candidate) =>
      candidate.controlUrl.replace(/\/+$/, "") === urls.controlUrl ||
      candidate.baseUrl?.replace(/\/+$/, "") === urls.baseUrl,
  );

  if (!runtime?.tokenPath) {
    throw new Error("No runtime auth token was found for the requested Aperture runtime.");
  }

  return readRuntimeAuthToken(runtime.tokenPath);
}

export async function getJson<T>(url: string, authToken: string): Promise<T> {
  return requestJson<T>(url, {
    headers: buildHeaders(authToken),
  });
}

export async function postJson<T = Record<string, never>>(
  url: string,
  body: unknown,
  authToken: string,
  contentType = "application/json",
): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: buildHeaders(authToken, contentType),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function deleteJson<T = Record<string, never>>(
  url: string,
  authToken: string,
): Promise<T> {
  return requestJson<T>(url, {
    method: "DELETE",
    headers: buildHeaders(authToken),
  });
}

function buildHeaders(authToken: string, contentType?: string): Record<string, string> {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    Authorization: `Bearer ${authToken}`,
  };
}

function emptyListenerHealth() {
  return {
    active: 0,
    emissions: 0,
    failures: 0,
    detached: 0,
    slowDeliveries: 0,
    maxDeliveryMs: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload);
  }

  if (payload.body === undefined) {
    return undefined as T;
  }

  return payload.body as T;
}

function buildRequestError(
  response: Response,
  payload: { body: unknown; text: string },
): ApertureRuntimeRequestError {
  const envelope = readRuntimeErrorEnvelope(payload.body);
  const detail = envelope
    ? typeof envelope.error === "string"
      ? { message: envelope.error }
      : envelope.error
    : undefined;
  const message =
    detail?.message ??
    payload.text.trim() ??
    `Aperture runtime request failed: ${response.status} ${response.statusText}`;
  return new ApertureRuntimeRequestError({
    status: response.status,
    statusText: response.statusText,
    message:
      message.length > 0
        ? message
        : `Aperture runtime request failed: ${response.status} ${response.statusText}`,
    ...(detail?.code ? { code: detail.code } : {}),
    ...(detail?.hint ? { hint: detail.hint } : {}),
    body: payload.body,
  });
}

async function readResponsePayload(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return { body: undefined, text };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType.includes("application/json") ||
    contentType.includes("+json") ||
    text.trim().startsWith("{") ||
    text.trim().startsWith("[")
  ) {
    try {
      return {
        body: JSON.parse(text),
        text,
      };
    } catch {
      // Fall through and return the raw text when a runtime bug serves invalid JSON.
    }
  }

  return { body: text, text };
}

function readRuntimeErrorEnvelope(body: unknown): RuntimeErrorEnvelope | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return body as RuntimeErrorEnvelope;
}
