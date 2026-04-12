import type { IncomingMessage, ServerResponse } from "node:http";

import { assertAllowedOrigin, isAuthorizedRequest } from "./runtime-auth.js";
import { describeRuntimeError, RuntimeHttpError, writeError } from "./runtime-http.js";
import { RuntimeRateLimiter } from "./runtime-rate-limit.js";
import { RuntimeTelemetry } from "./runtime-telemetry.js";

export type RuntimeRouteMatch = {
  params?: Record<string, string>;
};

export type RuntimeRouteContext = {
  req: IncomingMessage;
  res: ServerResponse<IncomingMessage>;
  url: URL;
  path: string;
  params: Record<string, string>;
};

export type RuntimeRoute = {
  name: string;
  method: "GET" | "POST" | "DELETE";
  match: (path: string) => RuntimeRouteMatch | null;
  requiresAuth?: boolean;
  mutating?: boolean;
  rateLimitKey?: string;
  handler: (context: RuntimeRouteContext) => Promise<void>;
};

export function createRuntimeRouteHandler(options: {
  routes: RuntimeRoute[];
  authToken: string;
  rateLimiter: RuntimeRateLimiter;
  telemetry: RuntimeTelemetry;
}) {
  return async (
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    url: URL,
    path: string,
  ): Promise<void> => {
    const method = req.method;
    const telemetryMethod =
      method === "GET" || method === "POST" || method === "DELETE" ? method : "UNKNOWN";
    let telemetryRequest: ReturnType<RuntimeTelemetry["begin"]> | null = null;
    try {
      if (method !== "GET" && method !== "POST" && method !== "DELETE") {
        telemetryRequest = options.telemetry.begin("runtime.unmatched", telemetryMethod);
        throw new RuntimeHttpError(404, "not_found", "not found");
      }

      const matchedRoute = findRoute(options.routes, method, path);
      if (!matchedRoute) {
        telemetryRequest = options.telemetry.begin("runtime.unmatched", method);
        throw new RuntimeHttpError(404, "not_found", "not found");
      }
      const { route, params } = matchedRoute;
      telemetryRequest = options.telemetry.begin(route.name, route.method);

      assertAllowedOrigin(req.headers.origin, { allowBrowserOrigin: false });

      if (
        route.requiresAuth !== false &&
        !isAuthorizedRequest(req.headers.authorization, options.authToken)
      ) {
        throw new RuntimeHttpError(
          401,
          "unauthorized",
          "This Aperture runtime route requires a bearer token.",
        );
      }

      if (route.mutating) {
        const remoteKey = req.socket.remoteAddress ?? "local";
        const ok = options.rateLimiter.check(remoteKey, route.rateLimitKey ?? "mutating");
        if (!ok) {
          throw new RuntimeHttpError(
            429,
            "rate_limited",
            "Too many requests for this Aperture runtime route.",
          );
        }
      }

      await route.handler({
        req,
        res,
        url,
        path,
        params,
      });
      telemetryRequest.finish({ statusCode: res.statusCode });
    } catch (error) {
      const described = describeRuntimeError(error);
      telemetryRequest?.finish(described);
      writeError(res, error);
    }
  };
}

export function matchLiteral(expectedPath: string): RuntimeRoute["match"] {
  return (path) => (path === expectedPath ? {} : null);
}

export function matchPattern(pattern: RegExp, parameterNames: string[]): RuntimeRoute["match"] {
  return (path) => {
    const match = path.match(pattern);
    if (!match) {
      return null;
    }
    const params: Record<string, string> = {};
    for (const [index, name] of parameterNames.entries()) {
      const raw = match[index + 1];
      if (raw !== undefined) {
        params[name] = raw;
      }
    }
    return { params };
  };
}

function findRoute(
  routes: RuntimeRoute[],
  method: RuntimeRoute["method"],
  path: string,
): { route: RuntimeRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = route.match(path);
    if (match) {
      return {
        route,
        params: match.params ?? {},
      };
    }
  }
  return null;
}
