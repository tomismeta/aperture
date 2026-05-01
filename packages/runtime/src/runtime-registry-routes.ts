import { randomUUID } from "node:crypto";

import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { readJson, RuntimeHttpError, writeJson } from "./runtime-http.js";
import { matchLiteral, matchPattern, type RuntimeRoute } from "./runtime-router.js";
import { decodeRouteParam, escapeRouteRegExp } from "./runtime-route-utils.js";

export function createRuntimeRegistryRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
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
        new RegExp(`^${escapeRouteRegExp(options.controlPathPrefix)}/adapters/([^/]+)/heartbeat$`),
        ["adapterId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        const adapterId = decodeRouteParam(params.adapterId);
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
        new RegExp(`^${escapeRouteRegExp(options.controlPathPrefix)}/adapters/([^/]+)$`),
        ["adapterId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        options.state.removeAdapter(decodeRouteParam(params.adapterId));
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
        new RegExp(`^${escapeRouteRegExp(options.controlPathPrefix)}/surfaces/([^/]+)/heartbeat$`),
        ["surfaceId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        const surfaceId = decodeRouteParam(params.surfaceId);
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
        new RegExp(`^${escapeRouteRegExp(options.controlPathPrefix)}/surfaces/([^/]+)$`),
        ["surfaceId"],
      ),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res, params }) => {
        options.state.removeSurface(decodeRouteParam(params.surfaceId));
        options.syncSurfaceCapabilities();
        writeJson(res, 200, {});
      },
    },
  ];
}
