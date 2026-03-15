import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ApertureCore,
  DEFAULT_ATTENTION_SURFACE_CAPABILITIES,
  type AttentionResponse,
  type AttentionSignalSummary,
  type AttentionSurfaceCapabilities,
  type AttentionState,
  type AttentionView,
  type SourceEvent,
  mergeAttentionSurfaceCapabilities,
} from "@tomismeta/aperture-core";

import type { LearningPersistenceState } from "./learning-persistence.js";
import {
  removeLocalRuntimeRegistration,
  writeLocalRuntimeRegistration,
} from "./runtime-discovery.js";

export type ApertureRuntimeOptions = {
  kind?: string;
  controlHost?: string;
  controlPathPrefix?: string;
  controlPort?: number;
  eventLogLimit?: number;
  adapterTtlMs?: number;
  surfaceTtlMs?: number;
  metadata?: Record<string, string>;
  core?: ApertureCore;
  learningPersistence?: LearningPersistenceState;
};

export type ApertureRuntimeEvent =
  | {
      sequence: number;
      type: "response";
      response: AttentionResponse;
    };

export type ApertureRuntimeSnapshot = {
  version: number;
  attentionView: AttentionView;
  signalSummary: AttentionSignalSummary;
  attentionState: AttentionState;
  adapters: ApertureRuntimeAdapter[];
  surfaceCount: number;
  surfaceCapabilities: AttentionSurfaceCapabilities;
  learningPersistence?: LearningPersistenceState;
};

export type ApertureRuntimeAdapter = {
  id: string;
  kind: string;
  label?: string;
  metadata?: Record<string, string>;
  lastSeenAt: string;
  connectedAt: string;
};

export type ApertureRuntime = {
  listen(): Promise<{
    controlUrl: string;
    runtimeId: string;
    kind: string;
    surfaceTtlMs: number;
  }>;
  close(): Promise<void>;
  getCore(): ApertureCore;
  hasAttachedSurface(): boolean;
  publishSourceEvent(event: SourceEvent): void;
  publishSourceEventBatch(events: SourceEvent[]): void;
};

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
  const events: ApertureRuntimeEvent[] = [];
  let sequence = 0;
  let stateVersion = 0;
  let registrationInterval: NodeJS.Timeout | null = null;
  let learningPersistence = options.learningPersistence;
  let seededAttentionViewSubscription = false;

  const bumpStateVersion = () => {
    stateVersion += 1;
  };

  const pushEvent = (event: Omit<ApertureRuntimeEvent, "sequence">) => {
    sequence += 1;
    events.push({ sequence, ...event });
    if (events.length > eventLogLimit) {
      events.splice(0, events.length - eventLogLimit);
    }
  };

  const unsubscribeResponse = core.onResponse((response) => {
    pushEvent({ type: "response", response });
  });
  const unsubscribeSignal = core.onSignal(() => {
    bumpStateVersion();
  });
  const unsubscribeAttentionView = core.subscribeAttentionView(() => {
    if (!seededAttentionViewSubscription) {
      seededAttentionViewSubscription = true;
      return;
    }
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

      if (req.method === "POST" && path === `${controlPathPrefix}/responses`) {
        const response = (await readJson(req, bodyLimitBytes)) as AttentionResponse;
        core.submit(response);
        writeJson(res, 200, {});
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/events/source`) {
        const payload = (await readJson(req, bodyLimitBytes)) as { event?: SourceEvent; events?: SourceEvent[] } | SourceEvent;
        const events = normalizeSourceEventPayload(payload);
        for (const event of events) {
          core.publishSourceEvent(event);
        }
        writeJson(res, 200, { published: events.length });
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
          capabilities?: Partial<AttentionSurfaceCapabilities>;
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
        controlUrl: `http://${controlHost}:${address.port}${controlPathPrefix}`,
      };

      await registerRuntime(binding.controlUrl);
      registrationInterval = setInterval(() => {
        void registerRuntime(binding.controlUrl).catch(() => {});
      }, REGISTRATION_HEARTBEAT_MS);

      return {
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
    publishSourceEvent(event) {
      core.publishSourceEvent(event);
    },
    publishSourceEventBatch(events) {
      for (const event of events) {
        core.publishSourceEvent(event);
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

function normalizeSourceEventPayload(
  payload: { event?: SourceEvent; events?: SourceEvent[] } | SourceEvent,
): SourceEvent[] {
  if (Array.isArray((payload as { events?: SourceEvent[] }).events)) {
    return (payload as { events: SourceEvent[] }).events;
  }

  if ((payload as { event?: SourceEvent }).event) {
    return [(payload as { event: SourceEvent }).event];
  }

  return [payload as SourceEvent];
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
  capabilities: Partial<AttentionSurfaceCapabilities> | undefined,
): AttentionSurfaceCapabilities {
  return {
    supportsQueue: capabilities?.supportsQueue ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsQueue,
    supportsAmbient: capabilities?.supportsAmbient ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsAmbient,
    supportsSingleChoice:
      capabilities?.supportsSingleChoice ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsSingleChoice,
    supportsMultipleChoice:
      capabilities?.supportsMultipleChoice ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsMultipleChoice,
    supportsForms: capabilities?.supportsForms ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsForms,
    supportsFreeformText:
      capabilities?.supportsFreeformText ?? DEFAULT_ATTENTION_SURFACE_CAPABILITIES.supportsFreeformText,
  };
}

async function readOptionalJson(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown | null> {
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJson(req: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const parsed = await readOptionalJson(req, bodyLimitBytes);
  if (parsed === null) {
    throw new Error("request body is empty");
  }
  return parsed;
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
