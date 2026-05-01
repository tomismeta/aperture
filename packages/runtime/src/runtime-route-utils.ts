import { RuntimeHttpError } from "./runtime-http.js";

export function requireListeningPort(port: number | null): number {
  if (port === null) {
    throw new RuntimeHttpError(503, "runtime_unavailable", "Aperture runtime is not ready yet.");
  }
  return port;
}

export function escapeRouteRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeRouteParam(value: string | undefined): string {
  if (!value) {
    throw new RuntimeHttpError(400, "invalid_route_parameter", "invalid route parameter");
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RuntimeHttpError(400, "invalid_route_parameter", "invalid route parameter");
  }
}
