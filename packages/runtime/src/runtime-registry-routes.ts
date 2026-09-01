import { randomUUID } from "node:crypto";

import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { readJson, RuntimeHttpError, writeJson } from "./runtime-http.js";
import { matchLiteral, matchPattern, type RuntimeRoute } from "./runtime-router.js";
import { decodeRouteParam, escapeRouteRegExp } from "./runtime-route-utils.js";
import { createRuntimeSurfaceRoutes } from "./runtime-surface-routes.js";

export function createRuntimeRegistryRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [...createRuntimeAdapterRoutes(options), ...createRuntimeSurfaceRoutes(options)];
}

function createRuntimeAdapterRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
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
  ];
}
