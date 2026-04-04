import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ApertureCore,
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
    }
  | {
      sequence: number;
      type: "trace";
      trace: ApertureTrace;
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

export type ApertureRuntimeCaptureStep =
  | {
      sequence: number;
      recordedAt: string;
      kind: "publishSource";
      event: SourceEvent;
    }
  | {
      sequence: number;
      recordedAt: string;
      kind: "submit";
      response: AttentionResponse;
    };

export type ApertureRuntimeSessionStep = ApertureRuntimeCaptureStep;

export type ApertureRuntimeAttentionViewSnapshot = {
  sequence: number;
  recordedAt: string;
  attentionView: AttentionView;
};

export type ApertureRuntimeViewSnapshot = ApertureRuntimeAttentionViewSnapshot;

export type ApertureRuntimeSessionCapture = {
  runtimeId: string;
  kind: string;
  startedAt: string;
  exportedAt: string;
  /** Canonical runtime-owned capture fields. */
  captureSteps: ApertureRuntimeCaptureStep[];
  publishedSourceEvents: SourceEvent[];
  submittedResponses: AttentionResponse[];
  signals: AttentionSignal[];
  traces: ApertureTrace[];
  attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[];
  currentAttentionView: AttentionView;
  /** Compatibility aliases retained for current capture tooling. */
  steps: ApertureRuntimeCaptureStep[];
  sourceEvents: SourceEvent[];
  responses: AttentionResponse[];
  viewSnapshots: ApertureRuntimeAttentionViewSnapshot[];
  attentionView: AttentionView;
  adapters: ApertureRuntimeAdapter[];
  metadata?: Record<string, string>;
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
  exportSessionCapture(): ApertureRuntimeSessionCapture;
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
const TASK_STATUSES = new Set(["running", "blocked", "waiting", "completed", "failed"]);
const REQUEST_KINDS = new Set(["approval", "choice", "form"]);
const SELECTION_MODES = new Set(["single", "multiple"]);
const FIELD_TYPES = new Set(["text", "textarea", "number", "select", "boolean"]);
const RESPONSE_KINDS = new Set(["acknowledged", "approved", "rejected", "option_selected", "text_submitted", "form_submitted", "dismissed"]);

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
    pushEvent({ type: "response", response });
    pushBounded(submittedResponses, response);
  });
  const unsubscribeTrace = core.onTrace((trace) => {
    pushEvent({ type: "trace", trace: trace as ApertureTrace });
    pushBounded(traceLog, trace as ApertureTrace);
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

      if (req.method === "POST" && path === `${controlPathPrefix}/responses`) {
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
    const steps = [...captureSteps];
    const sourceEvents = [...publishedSourceEvents];
    const responses = [...submittedResponses];
    const viewSnapshots = [...attentionViewSnapshots];
    const attentionView = core.getAttentionView();

    return {
      runtimeId,
      kind,
      startedAt,
      exportedAt: new Date().toISOString(),
      captureSteps: steps,
      publishedSourceEvents: sourceEvents,
      submittedResponses: responses,
      signals: [...signalLog],
      traces: [...traceLog],
      attentionViewSnapshots: viewSnapshots,
      currentAttentionView: attentionView,
      steps,
      sourceEvents,
      responses,
      viewSnapshots,
      attentionView,
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

  function recordSubmittedResponse(response: AttentionResponse): void {
    pushBounded(captureSteps, {
      sequence: nextCaptureSequence(),
      recordedAt: new Date().toISOString(),
      kind: "submit",
      response,
    });
    bumpStateVersion();
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

function normalizeSourceEventPayload(payload: unknown): SourceEvent[] {
  if (isRecord(payload) && Array.isArray(payload.events)) {
    const events = payload.events.map((event) => validateSourceEvent(event));
    if (events.some((event) => event === null)) {
      throw new Error("Invalid source event batch payload.");
    }
    return events as SourceEvent[];
  }

  if (isRecord(payload) && "event" in payload) {
    const event = validateSourceEvent(payload.event);
    if (!event) {
      throw new Error("Invalid source event payload.");
    }
    return [event];
  }

  const event = validateSourceEvent(payload);
  if (!event) {
    throw new Error("Invalid source event payload.");
  }

  return [event];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateAttentionResponse(value: unknown): AttentionResponse | null {
  if (!isRecord(value) || typeof value.taskId !== "string" || typeof value.interactionId !== "string" || !isRecord(value.response)) {
    return null;
  }

  const kind = value.response.kind;
  if (typeof kind !== "string" || !RESPONSE_KINDS.has(kind)) {
    return null;
  }

  switch (kind) {
    case "acknowledged":
    case "dismissed":
      return value as AttentionResponse;
    case "approved":
    case "rejected":
      return value.response.reason === undefined || typeof value.response.reason === "string"
        ? value as AttentionResponse
        : null;
    case "option_selected":
      return isStringArray(value.response.optionIds) ? value as AttentionResponse : null;
    case "text_submitted":
      return typeof value.response.text === "string" ? value as AttentionResponse : null;
    case "form_submitted":
      return isRecord(value.response.values) ? value as AttentionResponse : null;
  }

  return null;
}

function validateSourceEvent(value: unknown): SourceEvent | null {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string" || typeof value.taskId !== "string" || typeof value.timestamp !== "string") {
    return null;
  }

  if (
    (value.source !== undefined && validateSourceRef(value.source) === null)
    || (value.semanticHints !== undefined && !isRecord(value.semanticHints))
  ) {
    return null;
  }

  switch (value.type) {
    case "task.started":
      return typeof value.title === "string" && (value.summary === undefined || typeof value.summary === "string")
        ? value as SourceEvent
        : null;
    case "task.updated":
      return typeof value.title === "string"
        && (value.summary === undefined || typeof value.summary === "string")
        && typeof value.status === "string"
        && TASK_STATUSES.has(value.status)
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || typeof value.activityClass === "string")
        && (value.progress === undefined || typeof value.progress === "number")
        ? value as SourceEvent
        : null;
    case "human.input.requested":
      return typeof value.interactionId === "string"
        && typeof value.title === "string"
        && typeof value.summary === "string"
        && (value.toolFamily === undefined || typeof value.toolFamily === "string")
        && (value.activityClass === undefined || typeof value.activityClass === "string")
        && validateHumanInputRequest(value.request)
        && (value.context === undefined || validateContext(value.context))
        && (value.provenance === undefined || validateProvenance(value.provenance))
        && (value.riskHint === undefined || value.riskHint === "low" || value.riskHint === "medium" || value.riskHint === "high")
        ? value as SourceEvent
        : null;
    case "task.completed":
      return value.summary === undefined || typeof value.summary === "string"
        ? value as SourceEvent
        : null;
    case "task.cancelled":
      return value.reason === undefined || typeof value.reason === "string"
        ? value as SourceEvent
        : null;
    default:
      return null;
  }
}

function validateSourceRef(value: unknown): object | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  if (
    (value.kind !== undefined && typeof value.kind !== "string")
    || (value.label !== undefined && typeof value.label !== "string")
  ) {
    return null;
  }

  return value;
}

function validateHumanInputRequest(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string" || !REQUEST_KINDS.has(value.kind)) {
    return false;
  }

  switch (value.kind) {
    case "approval":
      return value.requireReason === undefined || typeof value.requireReason === "boolean";
    case "choice":
      return typeof value.selectionMode === "string"
        && SELECTION_MODES.has(value.selectionMode)
        && (value.allowTextResponse === undefined || typeof value.allowTextResponse === "boolean")
        && Array.isArray(value.options)
        && value.options.every((option) => isRecord(option) && typeof option.id === "string" && typeof option.label === "string" && (option.summary === undefined || typeof option.summary === "string"));
    case "form":
      return Array.isArray(value.fields)
        && value.fields.every((field) => (
          isRecord(field)
          && typeof field.id === "string"
          && typeof field.label === "string"
          && typeof field.type === "string"
          && FIELD_TYPES.has(field.type)
          && (field.required === undefined || typeof field.required === "boolean")
          && (field.options === undefined || (Array.isArray(field.options) && field.options.every((option) => isRecord(option) && typeof option.value === "string" && typeof option.label === "string")))
        ));
  }

  return false;
}

function validateContext(value: unknown): boolean {
  return (
    isRecord(value)
    && (value.stage === undefined || typeof value.stage === "string")
    && (value.progress === undefined || typeof value.progress === "number")
    && (
      value.items === undefined
      || (
        Array.isArray(value.items)
        && value.items.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.label === "string" && (item.value === undefined || typeof item.value === "string"))
      )
    )
  );
}

function validateProvenance(value: unknown): boolean {
  return (
    isRecord(value)
    && (value.whyNow === undefined || typeof value.whyNow === "string")
    && (value.factors === undefined || isStringArray(value.factors))
  );
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
