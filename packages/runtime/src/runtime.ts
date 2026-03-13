import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ApertureCore,
  type AttentionState,
  type AttentionView,
  type ConformedEvent,
  type FrameResponse,
  type SignalSummary,
} from "@aperture/core";

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
      response: FrameResponse;
    };

export type ApertureRuntimeSnapshot = {
  attentionView: AttentionView;
  signalSummary: SignalSummary;
  attentionState: AttentionState;
  adapters: ApertureRuntimeAdapter[];
  surfaceCount: number;
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
  publishConformed(event: ConformedEvent): void;
  publishConformedBatch(events: ConformedEvent[]): void;
};

type SurfaceSession = {
  id: string;
  lastSeenAt: number;
  label?: string;
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
  const runtimeId = randomUUID();
  const startedAt = new Date().toISOString();
  const adapters = new Map<string, AdapterSession>();
  const surfaces = new Map<string, SurfaceSession>();
  const events: ApertureRuntimeEvent[] = [];
  let sequence = 0;
  let registrationInterval: NodeJS.Timeout | null = null;
  let learningPersistence = options.learningPersistence;

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
        writeJson(res, 200, {
          checkpointed: true,
          updatedAt: snapshot.updatedAt,
          sessionCount: snapshot.sessionCount,
        });
        return;
      }

      if (req.method === "GET" && path === `${controlPathPrefix}/events`) {
        const since = Number(url.searchParams.get("since") ?? "0");
        writeJson(res, 200, {
          events: events.filter((event) => event.sequence > since),
          nextSequence: sequence,
        });
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/responses`) {
        const response = (await readJson(req)) as FrameResponse;
        core.submit(response);
        writeJson(res, 200, {});
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/events/conformed`) {
        const payload = (await readJson(req)) as { event?: ConformedEvent; events?: ConformedEvent[] } | ConformedEvent;
        const events = normalizeConformedPayload(payload);
        for (const event of events) {
          core.publishConformed(event);
        }
        writeJson(res, 200, { published: events.length });
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/adapters/register`) {
        const payload = (await readJson(req)) as {
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
        adapters.delete(adapterId);
        writeJson(res, 200, {});
        return;
      }

      if (req.method === "POST" && path === `${controlPathPrefix}/surfaces/attach`) {
        const payload = (await readOptionalJson(req)) as { label?: string } | null;
        const surfaceId = randomUUID();
        surfaces.set(surfaceId, {
          id: surfaceId,
          lastSeenAt: Date.now(),
          ...(payload?.label ? { label: payload.label } : {}),
        });
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
        surfaces.delete(surfaceId);
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
      }
      unsubscribeResponse();
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
    publishConformed(event) {
      core.publishConformed(event);
    },
    publishConformedBatch(events) {
      for (const event of events) {
        core.publishConformed(event);
      }
    },
  };

  function pruneSurfaces(): void {
    const cutoff = Date.now() - surfaceTtlMs;
    for (const [surfaceId, surface] of surfaces.entries()) {
      if (surface.lastSeenAt < cutoff) {
        surfaces.delete(surfaceId);
      }
    }
  }

  function pruneAdapters(): void {
    const cutoff = Date.now() - adapterTtlMs;
    for (const [adapterId, adapter] of adapters.entries()) {
      if (adapter.lastSeenAt < cutoff) {
        adapters.delete(adapterId);
      }
    }
  }

  function snapshot(): ApertureRuntimeSnapshot {
    return {
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
      ...(learningPersistence ? { learningPersistence } : {}),
    };
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

function normalizeConformedPayload(
  payload: { event?: ConformedEvent; events?: ConformedEvent[] } | ConformedEvent,
): ConformedEvent[] {
  if (Array.isArray((payload as { events?: ConformedEvent[] }).events)) {
    return (payload as { events: ConformedEvent[] }).events;
  }

  if ((payload as { event?: ConformedEvent }).event) {
    return [(payload as { event: ConformedEvent }).event];
  }

  return [payload as ConformedEvent];
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

async function readOptionalJson(req: IncomingMessage): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const parsed = await readOptionalJson(req);
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
