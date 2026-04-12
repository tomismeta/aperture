import { randomUUID } from "node:crypto";

import { type ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";
import {
  isApertureCoreResponseExpiredError,
  isApertureCoreValidationError,
  type InternalHealthEmitter,
} from "@tomismeta/aperture-core/internal";

import type { LearningPersistenceState } from "./learning-persistence.js";
import {
  readJson,
  readWorkPayload,
  requestBaseUrl,
  RuntimeHttpError,
  writeJson,
} from "./runtime-http.js";
import {
  matchLiteral,
  matchPattern,
  type RuntimeRoute,
  type RuntimeRouteContext,
} from "./runtime-router.js";
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

type RuntimeRouteBodyLimits = {
  general: number;
  work: number;
  sourceEvents: number;
};

type RuntimeRouteCore = Pick<
  ApertureCore,
  | "checkpointMemory"
  | "reloadMarkdown"
  | "submit"
  | "engage"
  | "getAttentionView"
  | "getSignalSummary"
  | "getAttentionState"
> &
  InternalHealthEmitter;

export type BuildRuntimeRoutesOptions = {
  runtimeId: string;
  kind: string;
  metadata?: Record<string, string>;
  controlHost: string;
  controlPort: number;
  controlPathPrefix: string;
  bodyLimits: RuntimeRouteBodyLimits;
  core: RuntimeRouteCore;
  state: RuntimeState;
  getListeningPort: () => number | null;
  publishSourceEvents: (events: SourceEvent[]) => void;
  syncSurfaceCapabilities: () => void;
  exportSessionCapture: () => ReturnType<RuntimeState["exportSessionCapture"]>;
  setLearningPersistence: (state: LearningPersistenceState | undefined) => void;
  readLearningPersistence: () => LearningPersistenceState | undefined;
};

const WORK_ROUTE_PATHS = ["/work", "/v1/work"] as const;
const WORK_RESPONSE_ROUTE = /^\/(?:v1\/)?work\/response\/([^/]+)$/;

export function buildRuntimeRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    {
      name: "runtime.health",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/health`),
      requiresAuth: false,
      handler: async ({ res }) => {
        const snapshot = options.state.snapshot(options.core);
        writeJson(res, 200, {
          ok: true,
          runtimeId: options.runtimeId,
          kind: options.kind,
          adapterCount: snapshot.adapters.length,
          surfaceCount: snapshot.surfaceCount,
          authRequired: true,
          metadata: options.metadata ?? {},
          health: snapshot.health,
        });
      },
    },
    {
      name: "runtime.state",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/state`),
      handler: async ({ res }) => {
        writeJson(res, 200, options.state.snapshot(options.core));
      },
    },
    {
      name: "runtime.learning.checkpoint",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/learning/checkpoint`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res }) => {
        const snapshot = await options.core.checkpointMemory();
        if (!snapshot) {
          writeJson(res, 200, { checkpointed: false });
          return;
        }
        const nextLearningPersistence: LearningPersistenceState = {
          ...(options.readLearningPersistence() ?? { enabled: true }),
          lastCheckpointAt: snapshot.updatedAt,
        };
        options.setLearningPersistence(nextLearningPersistence);
        writeJson(res, 200, {
          checkpointed: true,
          updatedAt: snapshot.updatedAt,
          sessionCount: snapshot.sessionCount,
        });
      },
    },
    {
      name: "runtime.learning.reload",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/learning/reload`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res }) => {
        const reloaded = await options.core.reloadMarkdown();
        if (!reloaded) {
          writeJson(res, 200, { reloaded: false });
          return;
        }
        const loadedAt = new Date().toISOString();
        const nextLearningPersistence: LearningPersistenceState = {
          ...(options.readLearningPersistence() ?? { enabled: true }),
          lastLoadedAt: loadedAt,
        };
        options.setLearningPersistence(nextLearningPersistence);
        writeJson(res, 200, {
          reloaded: true,
          loadedAt,
        });
      },
    },
    {
      name: "runtime.events.feed",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/events`),
      handler: async ({ res, url }) => {
        const since = Number(url.searchParams.get("since") ?? "0");
        writeJson(res, 200, {
          events: options.state.eventsSince(since),
          nextSequence: options.state.nextSequence(),
          stateVersion: options.state.version,
        });
      },
    },
    {
      name: "runtime.session",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/session`),
      handler: async ({ res }) => {
        writeJson(res, 200, options.exportSessionCapture());
      },
    },
    {
      name: "runtime.response.submit",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/response`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.general);
        const response = validateAttentionResponse(payload);
        if (!response) {
          throw new RuntimeHttpError(
            400,
            "invalid_attention_response",
            "Invalid attention response payload.",
          );
        }
        try {
          options.core.submit(response);
        } catch (error) {
          if (isApertureCoreResponseExpiredError(error)) {
            throw new RuntimeHttpError(
              409,
              error.code,
              error.message,
              "Refresh the pending frame or republish the interaction before submitting a response.",
            );
          }
          if (isApertureCoreValidationError(error)) {
            throw new RuntimeHttpError(400, error.code, error.message);
          }
          throw error;
        }
        options.state.recordSubmittedResponse(response, new Date().toISOString());
        writeJson(res, 200, {});
      },
    },
    {
      name: "runtime.engagement",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/engagement`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.general);
        const engagement = validateOperatorEngagement(payload);
        if (!engagement) {
          throw new RuntimeHttpError(
            400,
            "invalid_engagement",
            "Invalid operator engagement payload.",
          );
        }
        options.core.engage(engagement.taskId, engagement.interactionId, {
          ...(engagement.durationMs !== undefined ? { durationMs: engagement.durationMs } : {}),
        });
        writeJson(res, 200, { engaged: true });
      },
    },
    {
      name: "runtime.events.source.publish",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/events/source`),
      mutating: true,
      rateLimitKey: "source",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.sourceEvents);
        let sourceEvents: SourceEvent[];
        try {
          sourceEvents = normalizeSourceEventPayload(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid source event payload.";
          throw new RuntimeHttpError(400, "invalid_source_event", message);
        }
        options.publishSourceEvents(sourceEvents);
        writeJson(res, 200, { published: sourceEvents.length });
      },
    },
    ...createWorkRoutes(options),
    {
      name: "runtime.adapters.register",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/adapters/register`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = (await readJson(req, options.bodyLimits.general)) as {
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
        const attached = options.state.registerAdapter({
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
      name: "runtime.adapters.heartbeat",
      method: "POST",
      match: matchPattern(
        new RegExp(`^${escapeRegExp(options.controlPathPrefix)}/adapters/([^/]+)/heartbeat$`),
        ["adapterId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        const adapterId = decodeParam(params.adapterId);
        if (!options.state.heartbeatAdapter(adapterId)) {
          throw new RuntimeHttpError(404, "unknown_adapter", "unknown adapter");
        }
        writeJson(res, 200, {});
      },
    },
    {
      name: "runtime.adapters.delete",
      method: "DELETE",
      match: matchPattern(
        new RegExp(`^${escapeRegExp(options.controlPathPrefix)}/adapters/([^/]+)$`),
        ["adapterId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        options.state.removeAdapter(decodeParam(params.adapterId));
        writeJson(res, 200, {});
      },
    },
    {
      name: "runtime.surfaces.attach",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/surfaces/attach`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = (await readJson(req, options.bodyLimits.general)) as {
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
        const attached = options.state.attachSurface({
          id: surfaceId,
          ...(payload?.label ? { label: payload.label } : {}),
          capabilities: payload?.capabilities,
        });
        options.syncSurfaceCapabilities();
        writeJson(res, 200, {
          surfaceId,
          ...attached,
        });
      },
    },
    {
      name: "runtime.surfaces.heartbeat",
      method: "POST",
      match: matchPattern(
        new RegExp(`^${escapeRegExp(options.controlPathPrefix)}/surfaces/([^/]+)/heartbeat$`),
        ["surfaceId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        const surfaceId = decodeParam(params.surfaceId);
        if (!options.state.heartbeatSurface(surfaceId)) {
          throw new RuntimeHttpError(404, "unknown_surface", "unknown surface");
        }
        writeJson(res, 200, {});
      },
    },
    {
      name: "runtime.surfaces.delete",
      method: "DELETE",
      match: matchPattern(
        new RegExp(`^${escapeRegExp(options.controlPathPrefix)}/surfaces/([^/]+)$`),
        ["surfaceId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        options.state.removeSurface(decodeParam(params.surfaceId));
        options.syncSurfaceCapabilities();
        writeJson(res, 200, {});
      },
    },
  ];
}

function createWorkRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    ...WORK_ROUTE_PATHS.map((path) => ({
      name: "work.describe",
      method: "GET" as const,
      match: matchLiteral(path),
      handler: async (context: RuntimeRouteContext) => {
        const { res } = context;
        requireListeningPort(options.getListeningPort());
        writeJson(res, 200, describeWorkEndpoint(options.state.retention));
      },
    })),
    {
      name: "work.response.read",
      method: "GET",
      match: matchPattern(WORK_RESPONSE_ROUTE, ["interactionId"]),
      handler: async ({ res, params }) => {
        const interactionId = decodeParam(params.interactionId);
        const workResponse = options.state.readWorkResponse(interactionId);
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
      name: "work.response.cancel",
      method: "DELETE",
      match: matchPattern(WORK_RESPONSE_ROUTE, ["interactionId"]),
      mutating: true,
      rateLimitKey: "work",
      handler: async ({ res, params }) => {
        const interactionId = decodeParam(params.interactionId);
        const workResponse = options.state.cancelWorkResponse(interactionId);
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
    ...WORK_ROUTE_PATHS.map((path) => ({
      name: "work.publish",
      method: "POST" as const,
      match: matchLiteral(path),
      mutating: true,
      rateLimitKey: "work",
      handler: async (context: RuntimeRouteContext) => {
        const { req, res } = context;
        const payload = await readWorkPayload(req, options.bodyLimits.work);
        let normalizedWork;
        try {
          normalizedWork = normalizeWorkPayload(payload);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new RuntimeHttpError(400, "invalid_work_payload", detail);
        }
        const sourceEvents = mapWorkPayloadToSourceEvents(normalizedWork);
        options.publishSourceEvents(sourceEvents);
        const baseUrl = requestBaseUrl(
          req,
          options.controlHost,
          options.getListeningPort() ?? (options.controlPort || 4546),
        );
        writeJson(
          res,
          200,
          describeAcceptedWork(normalizedWork, sourceEvents, {
            baseUrl,
            retention: options.state.retention,
          }),
        );
      },
    })),
  ];
}

function requireListeningPort(port: number | null): number {
  if (port === null) {
    throw new RuntimeHttpError(503, "runtime_unavailable", "Aperture runtime is not ready yet.");
  }
  return port;
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
