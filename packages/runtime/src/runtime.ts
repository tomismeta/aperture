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
import { writeJson } from "./runtime-http.js";
import { RuntimeRateLimiter } from "./runtime-rate-limit.js";
import { createRuntimeRouteHandler } from "./runtime-router.js";
import { buildRuntimeRoutes } from "./runtime-routes.js";
import {
  removeLocalRuntimeRegistration,
  writeLocalRuntimeRegistration,
} from "./runtime-discovery.js";
import { RuntimeState } from "./runtime-state.js";
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

      const routeHandler = createRuntimeRouteHandler({
        routes: buildRuntimeRoutes({
          runtimeId,
          kind,
          ...(options.metadata ? { metadata: options.metadata } : {}),
          controlHost,
          controlPort,
          controlPathPrefix,
          bodyLimits: BODY_LIMIT_BYTES,
          core,
          state: runtimeState,
          getListeningPort: () => listeningPort,
          publishSourceEvents,
          syncSurfaceCapabilities: () => syncSurfaceCapabilities(runtimeState!),
          exportSessionCapture: () => exportSessionCapture(runtimeState!),
          setLearningPersistence: (nextLearningPersistence) => {
            learningPersistence = nextLearningPersistence;
            runtimeState?.setLearningPersistence(nextLearningPersistence);
          },
          readLearningPersistence: () => learningPersistence,
        }),
        authToken: runtimeAuth.token,
        rateLimiter,
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
        await routeHandler(req, res, url, path);
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
      return exportSessionCapture(runtimeState);
    },

    publishSourceEvent(event) {
      publishSourceEvents([event]);
    },

    publishSourceEventBatch(events) {
      publishSourceEvents(events);
    },
  };

  function syncSurfaceCapabilities(state: RuntimeState): void {
    core.setSurfaceCapabilities(state.aggregateSurfaceCapabilities());
  }

  function publishSourceEvents(events: SourceEvent[]): void {
    const recordedAt = new Date().toISOString();
    for (const event of events) {
      runtimeState?.registerPendingWorkResponse(event, recordedAt);
      core.publishSourceEvent(event);
      runtimeState?.recordPublishedSourceEvent(event, recordedAt);
    }
  }

  function exportSessionCapture(state: RuntimeState) {
    const capture = state.captureData();
    const explanationAttentionView = selectExplanationAttentionView(
      core.getAttentionView(),
      capture.attentionViewSnapshots,
    );
    const explanation = buildRuntimeExplanationSnapshot(explanationAttentionView, capture.traces);
    return state.exportSessionCapture(core, explanation);
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
