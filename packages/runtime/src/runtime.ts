import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ApertureCore,
  type AttentionFrame,
  type AttentionResponse,
  type AttentionSignal,
  type AttentionSurfaceCapabilities,
  type AttentionView,
  type SourceEvent,
  baseAttentionSurfaceCapabilities,
  mergeAttentionSurfaceCapabilities,
} from "@tomismeta/aperture-core";
import type {
  ApertureTrace,
  AttentionSignalSummary,
  AttentionState,
} from "../../core/src/internal-contract.js";
import { subscribeInternalTrace } from "../../core/src/internal-contract.js";

import {
  removeLocalRuntimeRegistration,
  writeLocalRuntimeRegistration,
} from "./runtime-discovery.js";
import type {
  ApertureRuntime,
  ApertureRuntimeAdapter,
  ApertureRuntimeAttentionViewSnapshot,
  ApertureRuntimeCaptureStep,
  ApertureRuntimeEvent,
  ApertureRuntimeExplanationSnapshot,
  ApertureRuntimeOptions,
  ApertureRuntimeSessionCapture,
  ApertureRuntimeSnapshot,
  RuntimeWorkResponseRecord,
  WorkReceipt,
  WorkReceiptItem,
  WorkReceiptMode,
  WorkReceiptNextStep,
  WorkResponse,
  WorkResponseState,
} from "./runtime-contract.js";
import {
  buildRuntimeExplanationSnapshot,
  selectExplanationAttentionView,
} from "./runtime-explanation.js";
import {
  describeAcceptedWork,
  describeWorkEndpoint,
  describeWorkResponse,
  invalidWorkPayloadMessage,
  readWorkResponseInteractionId,
} from "./runtime-work.js";
import {
  normalizeSourceEventPayload,
  validateAttentionResponse,
  validateOperatorEngagement,
} from "./runtime-validation.js";
import {
  mapWorkPayloadToSourceEvents,
  normalizeWorkPayload,
} from "./work-event-ingest.js";

type SurfaceSession = {
  id: string;
  lastSeenAt: number;
  label?: string;
  capabilities: AttentionSurfaceCapabilities;
};

type AdapterSession = {
  id: string;
  kind: string;
  lastSeenAt: number;
  connectedAt: string;
  label?: string;
  metadata?: Record<string, string>;
};

const DEFAULT_KIND = "aperture";
const DEFAULT_CONTROL_HOST = "127.0.0.1";
const DEFAULT_CONTROL_PATH_PREFIX = "/runtime";
const DEFAULT_EVENT_LOG_LIMIT = 128;
const DEFAULT_ADAPTER_TTL_MS = 30_000;
const DEFAULT_SURFACE_TTL_MS = 15_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const REGISTRATION_HEARTBEAT_MS = 5_000;

export function createApertureRuntime(
  options: ApertureRuntimeOptions = {},
): ApertureRuntime {
  const core = options.core ?? new ApertureCore();
  const kind = options.kind ?? DEFAULT_KIND;
  const controlHost = options.controlHost ?? DEFAULT_CONTROL_HOST;
  const controlPort = options.controlPort ?? 0;
  const controlPathPrefix = normalizePathPrefix(
    options.controlPathPrefix ?? DEFAULT_CONTROL_PATH_PREFIX,
  );
  const eventLogLimit = options.eventLogLimit ?? DEFAULT_EVENT_LOG_LIMIT;
  const adapterTtlMs = options.adapterTtlMs ?? DEFAULT_ADAPTER_TTL_MS;
  const surfaceTtlMs = options.surfaceTtlMs ?? DEFAULT_SURFACE_TTL_MS;
  const bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES;
  const runtimeId = randomUUID();
  const startedAt = new Date().toISOString();
  const adapters = new Map<string, AdapterSession>();
  const surfaces = new Map<string, SurfaceSession>();
  const workResponses = new Map<string, {
    taskId: string;
    interactionId: string;
    state: WorkResponseState;
    response?: AttentionResponse["response"];
    answeredAt?: string;
  }>();
  const events: ApertureRuntimeEvent[] = [];
  const publishedSourceEvents: SourceEvent[] = [];
  const submittedResponses: AttentionResponse[] = [];
  const signalLog: AttentionSignal[] = [];
  const traceLog: ApertureTrace[] = [];
  const attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[] = [];
  const captureSteps: ApertureRuntimeCaptureStep[] = [];
  let sequence = 0;
  let captureSequence = 0;
  let stateVersion = 0;
  let registrationInterval: NodeJS.Timeout | null = null;
  let learningPersistence = options.learningPersistence;
  let seededAttentionViewSubscription = false;

  const bumpStateVersion = () => {
    stateVersion += 1;
  };

  const pushEvent = (event: { type: "response"; response: AttentionResponse } | { type: "trace"; trace: ApertureTrace }) => {
    sequence += 1;
    events.push({ sequence, ...event });
    if (events.length > eventLogLimit) {
      events.splice(0, events.length - eventLogLimit);
    }
  };

  const pushBounded = <T>(entries: T[], entry: T) => {
    entries.push(entry);
    if (entries.length > eventLogLimit) {
      entries.splice(0, entries.length - eventLogLimit);
    }
  };

  const nextCaptureSequence = () => {
    captureSequence += 1;
    return captureSequence;
  };

  const unsubscribeResponse = core.onResponse((response) => {
    recordWorkResponse(response);
    pushEvent({ type: "response", response });
    pushBounded(submittedResponses, response);
  });
  const unsubscribeTrace = subscribeInternalTrace(core, (trace) => {
    pushEvent({ type: "trace", trace });
    pushBounded(traceLog, trace);
  });
  const unsubscribeSignal = core.onSignal((signal) => {
    pushBounded(signalLog, signal);
    bumpStateVersion();
  });
  const unsubscribeAttentionView = core.subscribeAttentionView(() => {
    if (!seededAttentionViewSubscription) {
      seededAttentionViewSubscription = true;
      return;
    }
    pushBounded(attentionViewSnapshots, {
      sequence: nextCaptureSequence(),
      recordedAt: new Date().toISOString(),
      attentionView: core.getAttentionView(),
    });
    bumpStateVersion();
  });

  const controlServer = createServer(async (req, res) => {
    try {
      if (!req.method || !req.url) {
        writeJson(res, 404, { error: "not found" });
        return;
      }

      pruneSurfaces();
      pruneAdapters();
      const url = new URL(req.url, `http://${controlHost}`);
      const path = url.pathname;

      if (req.method === "GET" && path === `${controlPathPrefix}/health`) {
        writeJson(res, 200, {
          ok: true,
          runtimeId,
          kind,
          adapterCount: adapters.size,
          surfaceCount: surfaces.size,
          metadata: options.metadata ?? {},
        });
        return;
      }

      if (req.method === "GET" && path === `${controlPathPrefix}/state`) {
        writeJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/learning/checkpoint`) {
        const snapshot = await core.checkpointMemory();
        if (!snapshot) {
          writeJson(res, 200, { checkpointed: false });
          return;
        }
        learningPersistence = {
          ...(learningPersistence ?? { enabled: true }),
          lastCheckpointAt: snapshot.updatedAt,
        };
        bumpStateVersion();
        writeJson(res, 200, {
          checkpointed: true,
          updatedAt: snapshot.updatedAt,
          sessionCount: snapshot.sessionCount,
        });
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/learning/reload`) {
        const reloaded = await core.reloadMarkdown();
        if (!reloaded) {
          writeJson(res, 200, { reloaded: false });
          return;
        }
        const loadedAt = new Date().toISOString();
        learningPersistence = {
          ...(learningPersistence ?? { enabled: true }),
          lastLoadedAt: loadedAt,
        };
        bumpStateVersion();
        writeJson(res, 200, {
          reloaded: true,
          loadedAt,
        });
        return;
      }

      if (req.method === "GET" && path === `${controlPathPrefix}/events`) {
        const since = Number(url.searchParams.get("since") ?? "0");
        writeJson(res, 200, {
          events: events.filter((event) => event.sequence > since),
          nextSequence: sequence,
          stateVersion,
        });
        return;
      }

      if (req.method === "GET" && path === `${controlPathPrefix}/session`) {
        writeJson(res, 200, exportSessionCapture());
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/response`) {
        const payload = await readJson(req, bodyLimitBytes);
        const response = validateAttentionResponse(payload);
        if (!response) {
          throw new Error("Invalid attention response payload.");
        }
        recordSubmittedResponse(response);
        core.submit(response);
        writeJson(res, 200, {});
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/engagement`) {
        const payload = await readJson(req, bodyLimitBytes);
        const engagement = validateOperatorEngagement(payload);
        if (!engagement) {
          throw new Error("Invalid operator engagement payload.");
        }
        core.engage(engagement.taskId, engagement.interactionId, {
          ...(engagement.durationMs !== undefined ? { durationMs: engagement.durationMs } : {}),
        });
        writeJson(res, 200, { engaged: true });
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/events/source`) {
        const payload = await readJson(req, bodyLimitBytes);
        const events = normalizeSourceEventPayload(payload);
        for (const event of events) {
          core.publishSourceEvent(event);
          recordPublishedSourceEvent(event);
        }
        writeJson(res, 200, { published: events.length });
        return;
      }

      if (req.method === "GET" && path === "/work") {
        writeJson(res, 200, describeWorkEndpoint());
        return;
      }

      const workResponseInteractionId = readWorkResponseInteractionId(path);
      if (req.method === "GET" && workResponseInteractionId !== null) {
        const workResponse = workResponses.get(workResponseInteractionId);
        if (!workResponse) {
          writeJson(res, 404, {
            error:
              "No work response found for that interactionId. A public response loop is created when you POST a structured WorkEvent with kind=input.requested to /work.",
          });
          return;
        }
        writeJson(res, 200, describeWorkResponse(workResponse));
        return;
      }

      if (
        req.method === "POST"
        && path === "/work"
      ) {
        const payload = await readWorkPayload(req, bodyLimitBytes);
        const normalizedWork = normalizeWorkPayload(payload);
        const events = mapWorkPayloadToSourceEvents(normalizedWork);
        for (const event of events) {
          registerPendingWorkResponse(event);
          core.publishSourceEvent(event);
          recordPublishedSourceEvent(event);
        }
        writeJson(res, 200, describeAcceptedWork(normalizedWork, events));
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/adapters/register`) {
        const payload = (await readJson(req, bodyLimitBytes)) as {
          id?: string;
          kind: string;
          label?: string;
          metadata?: Record<string, string>;
        };
        if (typeof payload.kind !== "string" || payload.kind.trim() === "") {
          throw new Error("adapter registration requires a non-empty kind");
        }
        const adapterId = payload.id?.trim() || randomUUID();
        const connectedAt = new Date().toISOString();
        adapters.set(adapterId, {
          id: adapterId,
          kind: payload.kind,
          lastSeenAt: Date.now(),
          connectedAt,
          ...(payload.label ? { label: payload.label } : {}),
          ...(payload.metadata ? { metadata: payload.metadata } : {}),
        });
        bumpStateVersion();
        writeJson(res, 200, {
          adapterId,
          heartbeatIntervalMs: Math.max(1_000, Math.floor(adapterTtlMs / 3)),
          expiresAt: new Date(Date.now() + adapterTtlMs).toISOString(),
        });
        return;
      }

      const adapterHeartbeatMatch = path.match(
        new RegExp(`^${escapeRegExp(controlPathPrefix)}/adapters/([^/]+)/heartbeat$`),
      );
      if (req.method === "POST" && adapterHeartbeatMatch?.[1]) {
        const adapterId = decodeURIComponent(adapterHeartbeatMatch[1]);
        const adapter = adapters.get(adapterId);
        if (!adapter) {
          writeJson(res, 404, { error: "unknown adapter" });
          return;
        }
        adapter.lastSeenAt = Date.now();
        writeJson(res, 200, {});
        return;
      }

      const adapterDetachMatch = path.match(
        new RegExp(`^${escapeRegExp(controlPathPrefix)}/adapters/([^/]+)$`),
      );
      if (req.method === "DELETE" && adapterDetachMatch?.[1]) {
        const adapterId = decodeURIComponent(adapterDetachMatch[1]);
        if (adapters.delete(adapterId)) {
          bumpStateVersion();
        }
        writeJson(res, 200, {});
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/surfaces/attach`) {
        const payload = (await readOptionalJson(req, bodyLimitBytes)) as {
          label?: string;
          capabilities?: PartialSurfaceCapabilities;
        } | null;
        const surfaceId = randomUUID();
        surfaces.set(surfaceId, {
          id: surfaceId,
          lastSeenAt: Date.now(),
          capabilities: normalizeSurfaceCapabilities(payload?.capabilities),
          ...(payload?.label ? { label: payload.label } : {}),
        });
        core.setSurfaceCapabilities(aggregateSurfaceCapabilities());
        bumpStateVersion();
        writeJson(res, 200, {
          surfaceId,
          heartbeatIntervalMs: Math.max(1_000, Math.floor(surfaceTtlMs / 3)),
          expiresAt: new Date(Date.now() + surfaceTtlMs).toISOString(),
        });
        return;
      }

      const heartbeatMatch = path.match(
        new RegExp(`^${escapeRegExp(controlPathPrefix)}/surfaces/([^/]+)/heartbeat$`),
      );
      if (req.method === "POST" && heartbeatMatch?.[1]) {
        const surfaceId = decodeURIComponent(heartbeatMatch[1]);
        const surface = surfaces.get(surfaceId);
        if (!surface) {
          writeJson(res, 404, { error: "unknown surface" });
          return;
        }
        surface.lastSeenAt = Date.now();
        writeJson(res, 200, {});
        return;
      }

      const detachMatch = path.match(
        new RegExp(`^${escapeRegExp(controlPathPrefix)}/surfaces/([^/]+)$`),
      );
      if (req.method === "DELETE" && detachMatch?.[1]) {
        const surfaceId = decodeURIComponent(detachMatch[1]);
        if (surfaces.delete(surfaceId)) {
          core.setSurfaceCapabilities(aggregateSurfaceCapabilities());
          bumpStateVersion();
        }
        writeJson(res, 200, {});
        return;
      }

      writeJson(res, 404, { error: "not found" });
    } catch (error) {
      writeJson(res, 400, {
        error: error instanceof Error ? error.message : "invalid request",
      });
    }
  });

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        controlServer.once("error", reject);
        controlServer.listen(controlPort, controlHost, () => {
          controlServer.off("error", reject);
          resolve();
        });
      });

      const address = controlServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Aperture runtime control server did not bind to a TCP address");
      }

      const binding = {
        baseUrl: `http://${controlHost}:${address.port}`,
        controlUrl: `http://${controlHost}:${address.port}${controlPathPrefix}`,
      };

      await registerRuntime(binding.controlUrl);
      registrationInterval = setInterval(() => {
        void registerRuntime(binding.controlUrl).catch(() => {});
      }, REGISTRATION_HEARTBEAT_MS);

      return {
        baseUrl: binding.baseUrl,
        controlUrl: binding.controlUrl,
        runtimeId,
        kind,
        surfaceTtlMs,
      };
    },
    async close() {
      const snapshot = await core.checkpointMemory();
      if (snapshot) {
        learningPersistence = {
          ...(learningPersistence ?? { enabled: true }),
          lastCheckpointAt: snapshot.updatedAt,
        };
        bumpStateVersion();
      }
      unsubscribeResponse();
      unsubscribeTrace();
      unsubscribeSignal();
      unsubscribeAttentionView();
      if (registrationInterval) {
        clearInterval(registrationInterval);
        registrationInterval = null;
      }
      await removeLocalRuntimeRegistration(runtimeId).catch(() => {});
      if ("closeIdleConnections" in controlServer && typeof controlServer.closeIdleConnections === "function") {
        controlServer.closeIdleConnections();
      }
      if ("closeAllConnections" in controlServer && typeof controlServer.closeAllConnections === "function") {
        controlServer.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        controlServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    getCore() {
      return core;
    },
    hasAttachedSurface() {
      pruneSurfaces();
      return surfaces.size > 0;
    },
    exportSessionCapture() {
      return exportSessionCapture();
    },
    publishSourceEvent(event) {
      core.publishSourceEvent(event);
      recordPublishedSourceEvent(event);
    },
    publishSourceEventBatch(events) {
      for (const event of events) {
        core.publishSourceEvent(event);
        recordPublishedSourceEvent(event);
      }
    },
  };

  function pruneSurfaces(): void {
    const cutoff = Date.now() - surfaceTtlMs;
    let removed = false;
    for (const [surfaceId, surface] of surfaces.entries()) {
      if (surface.lastSeenAt < cutoff) {
        surfaces.delete(surfaceId);
        removed = true;
      }
    }
    if (removed) {
      core.setSurfaceCapabilities(aggregateSurfaceCapabilities());
      bumpStateVersion();
    }
  }

  function pruneAdapters(): void {
    const cutoff = Date.now() - adapterTtlMs;
    let removed = false;
    for (const [adapterId, adapter] of adapters.entries()) {
      if (adapter.lastSeenAt < cutoff) {
        adapters.delete(adapterId);
        removed = true;
      }
    }
    if (removed) {
      bumpStateVersion();
    }
  }

  function snapshot(): ApertureRuntimeSnapshot {
    return {
      version: stateVersion,
      attentionView: core.getAttentionView(),
      signalSummary: core.getSignalSummary(),
      attentionState: core.getAttentionState(),
      adapters: [...adapters.values()]
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map((adapter) => ({
          id: adapter.id,
          kind: adapter.kind,
          ...(adapter.label ? { label: adapter.label } : {}),
          ...(adapter.metadata ? { metadata: adapter.metadata } : {}),
          lastSeenAt: new Date(adapter.lastSeenAt).toISOString(),
          connectedAt: adapter.connectedAt,
      })),
      surfaceCount: surfaces.size,
      surfaceCapabilities: aggregateSurfaceCapabilities(),
      ...(learningPersistence ? { learningPersistence } : {}),
    };
  }

  function exportSessionCapture(): ApertureRuntimeSessionCapture {
    const runtimeCaptureSteps = [...captureSteps];
    const runtimePublishedSourceEvents = [...publishedSourceEvents];
    const runtimeSubmittedResponses = [...submittedResponses];
    const runtimeAttentionViewSnapshots = [...attentionViewSnapshots];
    const runtimeCurrentAttentionView = core.getAttentionView();
    const runtimeExplanationAttentionView = selectExplanationAttentionView(
      runtimeCurrentAttentionView,
      runtimeAttentionViewSnapshots,
    );
    const runtimeCurrentExplanation = buildRuntimeExplanationSnapshot(
      runtimeExplanationAttentionView,
      traceLog,
    );

    return {
      runtimeId,
      kind,
      startedAt,
      exportedAt: new Date().toISOString(),
      captureSteps: runtimeCaptureSteps,
      publishedSourceEvents: runtimePublishedSourceEvents,
      submittedResponses: runtimeSubmittedResponses,
      signals: [...signalLog],
      traces: [...traceLog],
      attentionViewSnapshots: runtimeAttentionViewSnapshots,
      currentAttentionView: runtimeCurrentAttentionView,
      currentExplanation: runtimeCurrentExplanation,
      adapters: snapshot().adapters,
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(learningPersistence ? { learningPersistence } : {}),
    };
  }

  function recordPublishedSourceEvent(event: SourceEvent): void {
    pushBounded(publishedSourceEvents, event);
    pushBounded(captureSteps, {
      sequence: nextCaptureSequence(),
      recordedAt: new Date().toISOString(),
      kind: "publishSource",
      event,
    });
    bumpStateVersion();
  }

  function registerPendingWorkResponse(event: SourceEvent): void {
    if (event.type !== "human.input.requested") {
      return;
    }
    workResponses.set(event.interactionId, {
      taskId: event.taskId,
      interactionId: event.interactionId,
      state: "pending",
    });
  }

  function recordSubmittedResponse(response: AttentionResponse): void {
    pushBounded(captureSteps, {
      sequence: nextCaptureSequence(),
      recordedAt: new Date().toISOString(),
      kind: "submit",
      response,
    });
    bumpStateVersion();
  }

  function recordWorkResponse(response: AttentionResponse): void {
    const current = workResponses.get(response.interactionId);
    if (!current) {
      return;
    }
    workResponses.set(response.interactionId, {
      taskId: response.taskId,
      interactionId: response.interactionId,
      state: "answered",
      response: response.response,
      answeredAt: new Date().toISOString(),
    });
  }

  function aggregateSurfaceCapabilities(): AttentionSurfaceCapabilities {
    return mergeAttentionSurfaceCapabilities([...surfaces.values()].map((surface) => surface.capabilities));
  }

  async function registerRuntime(controlUrl: string): Promise<void> {
    await writeLocalRuntimeRegistration({
      id: runtimeId,
      kind,
      controlUrl,
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
  }
}

function normalizePathPrefix(pathPrefix: string): string {
  const trimmed = pathPrefix.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSurfaceCapabilities(
  capabilities: PartialSurfaceCapabilities | undefined,
): AttentionSurfaceCapabilities {
  return {
    topology: {
      supportsAmbient:
        capabilities?.topology?.supportsAmbient
        ?? baseAttentionSurfaceCapabilities.topology.supportsAmbient,
    },
    responses: {
      supportsSingleChoice:
        capabilities?.responses?.supportsSingleChoice
        ?? baseAttentionSurfaceCapabilities.responses.supportsSingleChoice,
      supportsMultipleChoice:
        capabilities?.responses?.supportsMultipleChoice
        ?? baseAttentionSurfaceCapabilities.responses.supportsMultipleChoice,
      supportsForm:
        capabilities?.responses?.supportsForm
        ?? baseAttentionSurfaceCapabilities.responses.supportsForm,
      supportsTextResponse:
        capabilities?.responses?.supportsTextResponse
        ?? baseAttentionSurfaceCapabilities.responses.supportsTextResponse,
    },
  };
}

type PartialSurfaceCapabilities = {
  topology?: Partial<AttentionSurfaceCapabilities["topology"]>;
  responses?: Partial<AttentionSurfaceCapabilities["responses"]>;
};

async function readOptionalJson(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown | null> {
  const body = await readOptionalBody(req, bodyLimitBytes);
  if (body === null) {
    return null;
  }
  return JSON.parse(body);
}

async function readJson(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const parsed = await readOptionalJson(req, bodyLimitBytes);
  if (parsed === null) {
    throw new Error("request body is empty");
  }
  return parsed;
}

async function readWorkPayload(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const body = await readOptionalBody(req, bodyLimitBytes);
  if (body === null) {
    throw new Error("request body is empty");
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("request body is empty");
  }

  if (shouldParseWorkBodyAsJson(trimmed, req.headers["content-type"])) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      if (looksLikeJsonValue(trimmed)) {
        throw new Error(invalidWorkPayloadMessage("The request body looked like JSON, but it could not be parsed."));
      }
    }
  }

  return trimmed;
}

async function readOptionalBody(req: IncomingMessage, bodyLimitBytes: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > bodyLimitBytes) {
      throw new Error(`request body exceeded ${bodyLimitBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
): void {
  if (res.writableEnded) {
    return;
  }

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    Connection: "close",
  });
  res.end(JSON.stringify(body));
}

function shouldParseWorkBodyAsJson(
  body: string,
  contentTypeHeader: string | string[] | undefined,
): boolean {
  return looksLikeJsonContentType(contentTypeHeader) || looksLikeJsonValue(body);
}

function looksLikeJsonContentType(contentTypeHeader: string | string[] | undefined): boolean {
  if (contentTypeHeader === undefined) {
    return false;
  }
  const value = Array.isArray(contentTypeHeader)
    ? contentTypeHeader.join(",")
    : contentTypeHeader;
  return value.toLowerCase().includes("json");
}

function looksLikeJsonValue(body: string): boolean {
  return body.startsWith("{") || body.startsWith("[") || body.startsWith("\"");
}
