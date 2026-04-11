import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";
import { subscribeInternalTrace } from "@tomismeta/aperture-core/internal";

import { initializeRuntimeAuth } from "./runtime-auth.js";
import type { ApertureRuntime, ApertureRuntimeOptions } from "./runtime-contract.js";
import {
  buildRuntimeExplanationSnapshot,
  selectExplanationAttentionView,
} from "./runtime-explanation.js";
import {
  readJson,
  readWorkPayload,
  requestBaseUrl,
  RuntimeHttpError,
  writeJson,
} from "./runtime-http.js";
import { RuntimeRateLimiter } from "./runtime-rate-limit.js";
import {
  matchLiteral,
  matchPattern,
  createRuntimeRouteHandler,
  type RuntimeRoute,
} from "./runtime-router.js";
import {
  removeLocalRuntimeRegistration,
  writeLocalRuntimeRegistration,
} from "./runtime-discovery.js";
import { RuntimeState } from "./runtime-state.js";
import {
  describeAcceptedWork,
  describeWorkEndpoint,
  describeWorkResponse,
} from "./runtime-work.js";
import {
  normalizeSourceEventPayload,
  validateAttentionResponse,
  validateOperatorEngagement,
} from "./runtime-validation.js";
import { mapWorkPayloadToSourceEvents, normalizeWorkPayload } from "./work-event-ingest.js";
import { WorkResponseStore } from "./work-response-store.js";

const DEFAULT_KIND = "aperture";
const DEFAULT_CONTROL_HOST = "127.0.0.1";
const DEFAULT_CONTROL_PATH_PREFIX = "/runtime";
const DEFAULT_EVENT_LOG_LIMIT = 128;
const DEFAULT_CAPTURE_LOG_LIMIT = 2_048;
const DEFAULT_ADAPTER_TTL_MS = 30_000;
const DEFAULT_SURFACE_TTL_MS = 15_000;
const DEFAULT_WORK_RESPONSE_MAX_ENTRIES = 2_048;
const DEFAULT_WORK_RESPONSE_PENDING_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_WORK_RESPONSE_RETENTION_MS = 60 * 60 * 1_000;
const REGISTRATION_HEARTBEAT_MS = 5_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const BODY_LIMIT_BYTES = {
  general: 16 * 1024,
  work: 64 * 1024,
  sourceEvents: 256 * 1024,
} as const;

export function createApertureRuntime(options: ApertureRuntimeOptions = {}): ApertureRuntime {
  const core = options.core ?? new ApertureCore();
  const kind = options.kind ?? DEFAULT_KIND;
  const controlHost = options.controlHost ?? DEFAULT_CONTROL_HOST;
  const controlPort = options.controlPort ?? 0;
  const controlPathPrefix = normalizePathPrefix(
    options.controlPathPrefix ?? DEFAULT_CONTROL_PATH_PREFIX,
  );
  const eventLogLimit = options.eventLogLimit ?? DEFAULT_EVENT_LOG_LIMIT;
  const captureLogLimit = options.captureLogLimit ?? DEFAULT_CAPTURE_LOG_LIMIT;
  const adapterTtlMs = options.adapterTtlMs ?? DEFAULT_ADAPTER_TTL_MS;
  const surfaceTtlMs = options.surfaceTtlMs ?? DEFAULT_SURFACE_TTL_MS;
  const workResponseMaxEntries =
    options.workResponseMaxEntries ?? DEFAULT_WORK_RESPONSE_MAX_ENTRIES;
  const workResponsePendingTtlMs =
    options.workResponsePendingTtlMs ?? DEFAULT_WORK_RESPONSE_PENDING_TTL_MS;
  const workResponseRetentionMs =
    options.workResponseRetentionMs ?? DEFAULT_WORK_RESPONSE_RETENTION_MS;
  const runtimeId = randomUUID();
  const startedAt = new Date().toISOString();
  const rateLimiter = new RuntimeRateLimiter({
    windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    limits: {
      mutating: 600,
      work: 120,
      source: 240,
      control: 240,
    },
  });

  let controlServer: ReturnType<typeof createServer> | null = null;
  let registrationInterval: NodeJS.Timeout | null = null;
  let listeningPort: number | null = null;
  let runtimeState: RuntimeState | null = null;
  let runtimeAuth: Awaited<ReturnType<typeof initializeRuntimeAuth>> | null = null;
  let learningPersistence = options.learningPersistence;
  let seededAttentionViewSubscription = false;

  const unsubscribeResponse = core.onResponse((response) => {
    runtimeState?.recordRuntimeResponse(response);
  });
  const unsubscribeTrace = subscribeInternalTrace(core, (trace) => {
    runtimeState?.recordRuntimeTrace(trace);
  });
  const unsubscribeSignal = core.onSignal((signal) => {
    runtimeState?.recordSignal(signal);
  });
  const unsubscribeAttentionView = core.subscribeAttentionView((attentionView) => {
    if (!runtimeState) {
      return;
    }
    if (!seededAttentionViewSubscription) {
      seededAttentionViewSubscription = true;
      return;
    }
    runtimeState.recordAttentionViewSnapshot({
      recordedAt: new Date().toISOString(),
      attentionView,
    });
  });

  return {
    async listen() {
      if (controlServer) {
        throw new Error("Aperture runtime is already listening");
      }

      const runtimeStateKey = controlPort === 0 ? `${kind}-${runtimeId}` : `${kind}-${controlPort}`;
      runtimeAuth = await initializeRuntimeAuth(runtimeStateKey);
      const tokenPath = runtimeAuth.tokenPath;
      const workResponses = await WorkResponseStore.open({
        stateDir: runtimeAuth.stateDir,
        maxEntries: workResponseMaxEntries,
        pendingTtlMs: workResponsePendingTtlMs,
        retentionMs: workResponseRetentionMs,
      });
      runtimeState = new RuntimeState({
        runtimeId,
        kind,
        startedAt,
        eventLogLimit,
        captureLogLimit,
        adapterTtlMs,
        surfaceTtlMs,
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(learningPersistence ? { learningPersistence } : {}),
        workResponses,
      });

      controlServer = createServer(async (req, res) => {
        if (!runtimeState || !runtimeAuth) {
          writeJson(res, 503, {
            error: {
              code: "runtime_unavailable",
              message: "Aperture runtime is not ready yet.",
            },
          });
          return;
        }

        if (!req.method || !req.url) {
          writeJson(res, 404, {
            error: {
              code: "not_found",
              message: "not found",
            },
          });
          return;
        }

        const url = new URL(req.url, `http://${controlHost}`);
        const path = url.pathname;
        syncSurfaceCapabilities(runtimeState);
        await routeHandler(runtimeState, runtimeAuth.token)(req, res, url, path);
      });

      await new Promise<void>((resolve, reject) => {
        controlServer!.once("error", reject);
        controlServer!.listen(controlPort, controlHost, () => {
          controlServer!.off("error", reject);
          resolve();
        });
      });

      const address = controlServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Aperture runtime control server did not bind to a TCP address");
      }

      listeningPort = address.port;
      const binding = {
        baseUrl: `http://${controlHost}:${address.port}`,
        controlUrl: `http://${controlHost}:${address.port}${controlPathPrefix}`,
        authToken: runtimeAuth.token,
        tokenPath: runtimeAuth.tokenPath,
      };

      await registerRuntime(binding.controlUrl, binding.baseUrl, tokenPath);
      registrationInterval = setInterval(() => {
        void registerRuntime(binding.controlUrl, binding.baseUrl, tokenPath).catch(() => {});
      }, REGISTRATION_HEARTBEAT_MS);

      return {
        ...binding,
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
        runtimeState?.setLearningPersistence(learningPersistence);
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
      await runtimeState?.flush();

      if (!controlServer) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        controlServer!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      controlServer = null;
      listeningPort = null;
    },

    getCore() {
      return core;
    },

    hasAttachedSurface() {
      return (runtimeState?.surfaceCount ?? 0) > 0;
    },

    exportSessionCapture() {
      if (!runtimeState) {
        throw new Error("Aperture runtime is not listening");
      }
      const capture = runtimeState.captureData();
      const explanationAttentionView = selectExplanationAttentionView(
        core.getAttentionView(),
        capture.attentionViewSnapshots,
      );
      const explanation = buildRuntimeExplanationSnapshot(explanationAttentionView, capture.traces);
      return runtimeState.exportSessionCapture(core, explanation);
    },

    publishSourceEvent(event) {
      const recordedAt = new Date().toISOString();
      runtimeState?.registerPendingWorkResponse(event, recordedAt);
      core.publishSourceEvent(event);
      runtimeState?.recordPublishedSourceEvent(event, recordedAt);
    },

    publishSourceEventBatch(events) {
      const recordedAt = new Date().toISOString();
      for (const event of events) {
        runtimeState?.registerPendingWorkResponse(event, recordedAt);
        core.publishSourceEvent(event);
        runtimeState?.recordPublishedSourceEvent(event, recordedAt);
      }
    },
  };

  function routeHandler(state: RuntimeState, authToken: string) {
    const routes: RuntimeRoute[] = [
      {
        method: "GET",
        match: matchLiteral(`${controlPathPrefix}/health`),
        requiresAuth: false,
        handler: async ({ res }) => {
          writeJson(res, 200, {
            ok: true,
            runtimeId,
            kind,
            adapterCount: state.snapshot(core).adapters.length,
            surfaceCount: state.surfaceCount,
            authRequired: true,
            metadata: options.metadata ?? {},
          });
        },
      },
      {
        method: "GET",
        match: matchLiteral(`${controlPathPrefix}/state`),
        handler: async ({ res }) => {
          writeJson(res, 200, state.snapshot(core));
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/learning/checkpoint`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res }) => {
          const snapshot = await core.checkpointMemory();
          if (!snapshot) {
            writeJson(res, 200, { checkpointed: false });
            return;
          }
          learningPersistence = {
            ...(learningPersistence ?? { enabled: true }),
            lastCheckpointAt: snapshot.updatedAt,
          };
          state.setLearningPersistence(learningPersistence);
          writeJson(res, 200, {
            checkpointed: true,
            updatedAt: snapshot.updatedAt,
            sessionCount: snapshot.sessionCount,
          });
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/learning/reload`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res }) => {
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
          state.setLearningPersistence(learningPersistence);
          writeJson(res, 200, {
            reloaded: true,
            loadedAt,
          });
        },
      },
      {
        method: "GET",
        match: matchLiteral(`${controlPathPrefix}/events`),
        handler: async ({ res, url }) => {
          const since = Number(url.searchParams.get("since") ?? "0");
          writeJson(res, 200, {
            events: state.eventsSince(since),
            nextSequence: state.nextSequence(),
            stateVersion: state.version,
          });
        },
      },
      {
        method: "GET",
        match: matchLiteral(`${controlPathPrefix}/session`),
        handler: async ({ res }) => {
          const capture = state.captureData();
          const explanationAttentionView = selectExplanationAttentionView(
            core.getAttentionView(),
            capture.attentionViewSnapshots,
          );
          const explanation = buildRuntimeExplanationSnapshot(
            explanationAttentionView,
            capture.traces,
          );
          writeJson(res, 200, state.exportSessionCapture(core, explanation));
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/response`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ req, res }) => {
          const payload = await readJson(req, BODY_LIMIT_BYTES.general);
          const response = validateAttentionResponse(payload);
          if (!response) {
            throw new RuntimeHttpError(
              400,
              "invalid_attention_response",
              "Invalid attention response payload.",
            );
          }
          state.recordSubmittedResponse(response, new Date().toISOString());
          core.submit(response);
          writeJson(res, 200, {});
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/engagement`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ req, res }) => {
          const payload = await readJson(req, BODY_LIMIT_BYTES.general);
          const engagement = validateOperatorEngagement(payload);
          if (!engagement) {
            throw new RuntimeHttpError(
              400,
              "invalid_engagement",
              "Invalid operator engagement payload.",
            );
          }
          core.engage(engagement.taskId, engagement.interactionId, {
            ...(engagement.durationMs !== undefined ? { durationMs: engagement.durationMs } : {}),
          });
          writeJson(res, 200, { engaged: true });
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/events/source`),
        mutating: true,
        rateLimitKey: "source",
        handler: async ({ req, res }) => {
          const payload = await readJson(req, BODY_LIMIT_BYTES.sourceEvents);
          let sourceEvents: SourceEvent[];
          try {
            sourceEvents = normalizeSourceEventPayload(payload);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Invalid source event payload.";
            throw new RuntimeHttpError(400, "invalid_source_event", message);
          }
          const recordedAt = new Date().toISOString();
          for (const event of sourceEvents) {
            state.registerPendingWorkResponse(event, recordedAt);
            core.publishSourceEvent(event);
            state.recordPublishedSourceEvent(event, recordedAt);
          }
          writeJson(res, 200, { published: sourceEvents.length });
        },
      },
      {
        method: "GET",
        match: matchLiteral("/work"),
        handler: async ({ res }) => {
          if (listeningPort === null) {
            throw new RuntimeHttpError(
              503,
              "runtime_unavailable",
              "Aperture runtime is not ready yet.",
            );
          }
          writeJson(res, 200, describeWorkEndpoint(state.retention));
        },
      },
      {
        method: "GET",
        match: matchLiteral("/v1/work"),
        handler: async ({ res }) => {
          if (listeningPort === null) {
            throw new RuntimeHttpError(
              503,
              "runtime_unavailable",
              "Aperture runtime is not ready yet.",
            );
          }
          writeJson(res, 200, describeWorkEndpoint(state.retention));
        },
      },
      {
        method: "GET",
        match: matchPattern(/^\/(?:v1\/)?work\/response\/([^/]+)$/, ["interactionId"]),
        handler: async ({ res, params }) => {
          const interactionId = decodeParam(params.interactionId);
          const workResponse = state.readWorkResponse(interactionId);
          if (!workResponse) {
            throw new RuntimeHttpError(
              404,
              "work_response_not_found",
              "No retained work response was found for that interactionId.",
              "The interaction may never have been registered, may have expired, or may have been evicted after its retention window.",
            );
          }
          writeJson(res, 200, describeWorkResponse(workResponse));
        },
      },
      {
        method: "DELETE",
        match: matchPattern(/^\/(?:v1\/)?work\/response\/([^/]+)$/, ["interactionId"]),
        mutating: true,
        rateLimitKey: "work",
        handler: async ({ res, params }) => {
          const interactionId = decodeParam(params.interactionId);
          const workResponse = state.cancelWorkResponse(interactionId);
          if (!workResponse) {
            throw new RuntimeHttpError(
              404,
              "work_response_not_found",
              "No retained work response was found for that interactionId.",
            );
          }
          if (workResponse.state === "answered") {
            throw new RuntimeHttpError(
              409,
              "work_response_answered",
              "Answered work responses cannot be cancelled.",
            );
          }
          writeJson(res, 200, describeWorkResponse(workResponse));
        },
      },
      {
        method: "POST",
        match: matchLiteral("/work"),
        mutating: true,
        rateLimitKey: "work",
        handler: async ({ req, res }) => {
          const payload = await readWorkPayload(req, BODY_LIMIT_BYTES.work);
          let normalizedWork;
          try {
            normalizedWork = normalizeWorkPayload(payload);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RuntimeHttpError(400, "invalid_work_payload", detail);
          }
          const sourceEvents = mapWorkPayloadToSourceEvents(normalizedWork);
          const recordedAt = new Date().toISOString();
          for (const event of sourceEvents) {
            state.registerPendingWorkResponse(event, recordedAt);
            core.publishSourceEvent(event);
            state.recordPublishedSourceEvent(event, recordedAt);
          }
          const baseUrl = requestBaseUrl(req, controlHost, listeningPort ?? (controlPort || 4546));
          writeJson(
            res,
            200,
            describeAcceptedWork(normalizedWork, sourceEvents, {
              baseUrl,
              retention: state.retention,
            }),
          );
        },
      },
      {
        method: "POST",
        match: matchLiteral("/v1/work"),
        mutating: true,
        rateLimitKey: "work",
        handler: async ({ req, res }) => {
          const payload = await readWorkPayload(req, BODY_LIMIT_BYTES.work);
          let normalizedWork;
          try {
            normalizedWork = normalizeWorkPayload(payload);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RuntimeHttpError(400, "invalid_work_payload", detail);
          }
          const sourceEvents = mapWorkPayloadToSourceEvents(normalizedWork);
          const recordedAt = new Date().toISOString();
          for (const event of sourceEvents) {
            state.registerPendingWorkResponse(event, recordedAt);
            core.publishSourceEvent(event);
            state.recordPublishedSourceEvent(event, recordedAt);
          }
          const baseUrl = requestBaseUrl(req, controlHost, listeningPort ?? (controlPort || 4546));
          writeJson(
            res,
            200,
            describeAcceptedWork(normalizedWork, sourceEvents, {
              baseUrl,
              retention: state.retention,
            }),
          );
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/adapters/register`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ req, res }) => {
          const payload = (await readJson(req, BODY_LIMIT_BYTES.general)) as {
            id?: string;
            kind?: string;
            label?: string;
            metadata?: Record<string, string>;
          };
          if (typeof payload.kind !== "string" || payload.kind.trim() === "") {
            throw new RuntimeHttpError(
              400,
              "invalid_adapter_registration",
              "adapter registration requires a non-empty kind",
            );
          }
          const adapterId = payload.id?.trim() || randomUUID();
          const attached = state.registerAdapter({
            id: adapterId,
            kind: payload.kind,
            ...(payload.label ? { label: payload.label } : {}),
            ...(payload.metadata ? { metadata: payload.metadata } : {}),
            connectedAt: new Date().toISOString(),
          });
          writeJson(res, 200, {
            adapterId,
            ...attached,
          });
        },
      },
      {
        method: "POST",
        match: matchPattern(
          new RegExp(`^${escapeRegExp(controlPathPrefix)}/adapters/([^/]+)/heartbeat$`),
          ["adapterId"],
        ),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res, params }) => {
          const adapterId = decodeParam(params.adapterId);
          if (!state.heartbeatAdapter(adapterId)) {
            throw new RuntimeHttpError(404, "unknown_adapter", "unknown adapter");
          }
          writeJson(res, 200, {});
        },
      },
      {
        method: "DELETE",
        match: matchPattern(new RegExp(`^${escapeRegExp(controlPathPrefix)}/adapters/([^/]+)$`), [
          "adapterId",
        ]),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res, params }) => {
          state.removeAdapter(decodeParam(params.adapterId));
          writeJson(res, 200, {});
        },
      },
      {
        method: "POST",
        match: matchLiteral(`${controlPathPrefix}/surfaces/attach`),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ req, res }) => {
          const payload = (await readJson(req, BODY_LIMIT_BYTES.general)) as {
            label?: string;
            capabilities?: {
              topology?: { supportsAmbient?: boolean };
              responses?: {
                supportsSingleChoice?: boolean;
                supportsMultipleChoice?: boolean;
                supportsForm?: boolean;
                supportsTextResponse?: boolean;
              };
            };
          };
          const surfaceId = randomUUID();
          const attached = state.attachSurface({
            id: surfaceId,
            ...(payload?.label ? { label: payload.label } : {}),
            capabilities: payload?.capabilities,
          });
          syncSurfaceCapabilities(state);
          writeJson(res, 200, {
            surfaceId,
            ...attached,
          });
        },
      },
      {
        method: "POST",
        match: matchPattern(
          new RegExp(`^${escapeRegExp(controlPathPrefix)}/surfaces/([^/]+)/heartbeat$`),
          ["surfaceId"],
        ),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res, params }) => {
          const surfaceId = decodeParam(params.surfaceId);
          if (!state.heartbeatSurface(surfaceId)) {
            throw new RuntimeHttpError(404, "unknown_surface", "unknown surface");
          }
          writeJson(res, 200, {});
        },
      },
      {
        method: "DELETE",
        match: matchPattern(new RegExp(`^${escapeRegExp(controlPathPrefix)}/surfaces/([^/]+)$`), [
          "surfaceId",
        ]),
        mutating: true,
        rateLimitKey: "control",
        handler: async ({ res, params }) => {
          state.removeSurface(decodeParam(params.surfaceId));
          syncSurfaceCapabilities(state);
          writeJson(res, 200, {});
        },
      },
    ];

    return createRuntimeRouteHandler({
      routes,
      authToken,
      rateLimiter,
    });
  }

  function syncSurfaceCapabilities(state: RuntimeState): void {
    core.setSurfaceCapabilities(state.aggregateSurfaceCapabilities());
  }

  async function registerRuntime(
    controlUrl: string,
    baseUrl: string,
    tokenPath: string,
  ): Promise<void> {
    await writeLocalRuntimeRegistration({
      id: runtimeId,
      kind,
      controlUrl,
      baseUrl,
      tokenPath,
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

function decodeParam(value: string | undefined): string {
  if (!value) {
    throw new RuntimeHttpError(400, "invalid_route_parameter", "invalid route parameter");
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RuntimeHttpError(400, "invalid_route_parameter", "invalid route parameter");
  }
}
