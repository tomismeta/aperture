import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { readWorkPayload, requestBaseUrl, RuntimeHttpError, writeJson } from "./runtime-http.js";
import {
  matchLiteral,
  matchPattern,
  type RuntimeRoute,
  type RuntimeRouteContext,
} from "./runtime-router.js";
import { decodeRouteParam, requireListeningPort } from "./runtime-route-utils.js";
import {
  describeAcceptedWork,
  describeWorkEndpoint,
  describeWorkResponse,
} from "./runtime-work.js";
import {
  mapWorkPayloadToSourceEvents,
  normalizeWorkPayload,
  WorkInputError,
} from "./work-event-ingest.js";

const WORK_ROUTE_PATH = "/work" as const;
const WORK_RESPONSE_ROUTE = /^\/work\/response\/([^/]+)$/;

export function createWorkRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    {
      name: "work.describe",
      method: "GET" as const,
      match: matchLiteral(WORK_ROUTE_PATH),
      handler: async ({ res }: RuntimeRouteContext) => {
        requireListeningPort(options.getListeningPort());
        writeJson(res, 200, describeWorkEndpoint(options.state.retention));
      },
    },
    {
      name: "work.response.read",
      method: "GET",
      match: matchPattern(WORK_RESPONSE_ROUTE, ["interactionId"]),
      handler: async ({ res, params }) => {
        const interactionId = decodeRouteParam(params.interactionId);
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
        const interactionId = decodeRouteParam(params.interactionId);
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
    {
      name: "work.publish",
      method: "POST" as const,
      match: matchLiteral(WORK_ROUTE_PATH),
      mutating: true,
      rateLimitKey: "work",
      handler: async ({ req, res }: RuntimeRouteContext) => {
        const payload = await readWorkPayload(req, options.bodyLimits.work);
        let normalizedWork;
        try {
          normalizedWork = normalizeWorkPayload(payload);
        } catch (error) {
          if (error instanceof WorkInputError) {
            throw new RuntimeHttpError(
              400,
              error.code,
              error.message,
              `Send Work specVersion ${error.supportedVersion} or omit specVersion.`,
              {
                receivedVersion: error.receivedVersion,
                supportedVersion: error.supportedVersion,
                ...(error.batchIndex !== undefined ? { batchIndex: error.batchIndex } : {}),
              },
            );
          }
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
    },
  ];
}
