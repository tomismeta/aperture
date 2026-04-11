import type { IncomingMessage, ServerResponse } from "node:http";

import { assertAllowedOrigin, isAuthorizedRequest } from "./runtime-auth.js";
import { RuntimeHttpError, writeError } from "./runtime-http.js";
import { RuntimeRateLimiter } from "./runtime-rate-limit.js";

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
}) {
  return async (
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    url: URL,
    path: string,
  ): Promise<void> => {
    try {
      const method = req.method;
      if (method !== "GET" && method !== "POST" && method !== "DELETE") {
        throw new RuntimeHttpError(404, "not_found", "not found");
      }

      const route = findRoute(options.routes, method, path);
      if (!route) {
        throw new RuntimeHttpError(404, "not_found", "not found");
      }

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
        params: route.match(path)?.params ?? {},
      });
    } catch (error) {
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
): RuntimeRoute | null {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    if (route.match(path)) {
      return route;
    }
  }
  return null;
}
