import { randomUUID } from "node:crypto";

import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { readJson, RuntimeHttpError, writeJson } from "./runtime-http.js";
import { matchLiteral, matchPattern, type RuntimeRoute } from "./runtime-router.js";
import { decodeRouteParam, escapeRouteRegExp } from "./runtime-route-utils.js";

export function createRuntimeSurfaceRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    {
      name: "runtime.surfaces.attach",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/surfaces/attach`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const rawPayload = await readJson(req, options.bodyLimits.general);
        if (!isRecord(rawPayload)) {
          throw new RuntimeHttpError(
            400,
            "invalid_surface_payload",
            "surface attachment payload must be an object",
          );
        }
        const payload = rawPayload as {
          label?: unknown;
          role?: unknown;
          acceptsResponses?: unknown;
          capabilities?: unknown;
        };
        assertSurfaceCapabilities(payload.capabilities);
        if (
          payload.label !== undefined &&
          (typeof payload.label !== "string" ||
            payload.label.trim().length === 0 ||
            payload.label.length > 120)
        ) {
          throw new RuntimeHttpError(
            400,
            "invalid_surface_label",
            "surface label must contain 1 to 120 visible characters",
          );
        }
        if (
          payload.role !== undefined &&
          payload.role !== "participant" &&
          payload.role !== "companion"
        ) {
          throw new RuntimeHttpError(
            400,
            "invalid_surface_role",
            "surface role must be participant or companion",
          );
        }
        if (
          payload.acceptsResponses !== undefined &&
          typeof payload.acceptsResponses !== "boolean"
        ) {
          throw new RuntimeHttpError(
            400,
            "invalid_surface_response_capability",
            "surface acceptsResponses must be a boolean",
          );
        }
        const surfaceId = randomUUID();
        const attached = options.state.attachSurface({
          id: surfaceId,
          ...(typeof payload.label === "string" ? { label: payload.label.trim() } : {}),
          ...(payload.role ? { role: payload.role } : {}),
          ...(typeof payload.acceptsResponses === "boolean"
            ? { acceptsResponses: payload.acceptsResponses }
            : {}),
          capabilities: payload.capabilities,
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

type SurfaceCapabilitiesPayload = {
  topology?: { supportsAmbient?: boolean };
  responses?: {
    supportsSingleChoice?: boolean;
    supportsMultipleChoice?: boolean;
    supportsForm?: boolean;
    supportsTextResponse?: boolean;
  };
};

function assertSurfaceCapabilities(
  capabilities: unknown,
): asserts capabilities is SurfaceCapabilitiesPayload | undefined {
  if (capabilities === undefined) return;
  if (!isRecord(capabilities)) {
    throw invalidSurfaceCapabilities();
  }

  if (capabilities.topology !== undefined) {
    if (!isRecord(capabilities.topology)) throw invalidSurfaceCapabilities();
    assertOptionalBoolean(capabilities.topology, "supportsAmbient");
  }

  if (capabilities.responses !== undefined) {
    if (!isRecord(capabilities.responses)) throw invalidSurfaceCapabilities();
    assertOptionalBoolean(capabilities.responses, "supportsSingleChoice");
    assertOptionalBoolean(capabilities.responses, "supportsMultipleChoice");
    assertOptionalBoolean(capabilities.responses, "supportsForm");
    assertOptionalBoolean(capabilities.responses, "supportsTextResponse");
  }
}

function assertOptionalBoolean(value: Record<string, unknown>, key: string): void {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    throw invalidSurfaceCapabilities();
  }
}

function invalidSurfaceCapabilities(): RuntimeHttpError {
  return new RuntimeHttpError(
    400,
    "invalid_surface_capabilities",
    "surface capabilities must contain boolean values",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
