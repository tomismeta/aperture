import type {
  ApertureRuntimeTelemetryErrorHealthSnapshot,
  ApertureRuntimeTelemetryHealthSnapshot,
  ApertureRuntimeTelemetryRouteHealthSnapshot,
} from "./runtime-contract.js";

type RuntimeTelemetryMethod = "GET" | "POST" | "DELETE" | "UNKNOWN";

type RuntimeTelemetryRouteRecord = {
  name: string;
  method: RuntimeTelemetryMethod;
  requests: number;
  successfulResponses: number;
  failedResponses: number;
  unauthorizedResponses: number;
  rateLimitedResponses: number;
  rejectedOriginResponses: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastStatusCode: number | null;
  lastRequestAt: string | null;
  lastCompletedAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
};

type RuntimeTelemetryErrorRecord = ApertureRuntimeTelemetryErrorHealthSnapshot;

export type RuntimeTelemetryOutcome = {
  statusCode: number;
  code?: string;
  message?: string;
};

const MAX_RECENT_ERRORS = 16;

export class RuntimeTelemetry {
  private totalRequests = 0;
  private activeRequests = 0;
  private completedRequests = 0;
  private failedRequests = 0;
  private unauthorizedRequests = 0;
  private rateLimitedRequests = 0;
  private rejectedOriginRequests = 0;
  private lastRequestAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastErrorAt: string | null = null;
  private lastErrorCode: string | null = null;
  private readonly routes = new Map<string, RuntimeTelemetryRouteRecord>();
  private readonly recentErrors: RuntimeTelemetryErrorRecord[] = [];

  begin(
    routeName: string,
    method: RuntimeTelemetryMethod,
  ): {
    finish: (outcome: RuntimeTelemetryOutcome) => void;
  } {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const route = this.readRoute(routeName, method);
    this.totalRequests += 1;
    this.activeRequests += 1;
    this.lastRequestAt = startedAt;
    route.requests += 1;
    route.lastRequestAt = startedAt;

    let closed = false;

    return {
      finish: (outcome) => {
        if (closed) {
          return;
        }
        closed = true;
        const finishedAtMs = Date.now();
        const finishedAt = new Date(finishedAtMs).toISOString();
        const durationMs = Math.max(0, finishedAtMs - startedAtMs);

        this.activeRequests = Math.max(0, this.activeRequests - 1);
        this.completedRequests += 1;
        this.lastCompletedAt = finishedAt;

        route.totalDurationMs += durationMs;
        route.maxDurationMs = Math.max(route.maxDurationMs, durationMs);
        route.lastCompletedAt = finishedAt;
        route.lastStatusCode = outcome.statusCode;

        if (outcome.statusCode >= 400) {
          route.failedResponses += 1;
          this.failedRequests += 1;

          if (outcome.statusCode === 401 || outcome.code === "unauthorized") {
            route.unauthorizedResponses += 1;
            this.unauthorizedRequests += 1;
          }
          if (outcome.statusCode === 429 || outcome.code === "rate_limited") {
            route.rateLimitedResponses += 1;
            this.rateLimitedRequests += 1;
          }
          if (outcome.code === "forbidden_origin") {
            route.rejectedOriginResponses += 1;
            this.rejectedOriginRequests += 1;
          }

          const errorCode = outcome.code ?? "internal_error";
          route.lastErrorAt = finishedAt;
          route.lastErrorCode = errorCode;
          this.lastErrorAt = finishedAt;
          this.lastErrorCode = errorCode;
          this.pushRecentError({
            at: finishedAt,
            route: route.name,
            method: route.method,
            statusCode: outcome.statusCode,
            code: errorCode,
            message: outcome.message ?? "request failed",
          });
          return;
        }

        route.successfulResponses += 1;
      },
    };
  }

  snapshot(): ApertureRuntimeTelemetryHealthSnapshot {
    return {
      totalRequests: this.totalRequests,
      activeRequests: this.activeRequests,
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
      unauthorizedRequests: this.unauthorizedRequests,
      rateLimitedRequests: this.rateLimitedRequests,
      rejectedOriginRequests: this.rejectedOriginRequests,
      lastRequestAt: this.lastRequestAt,
      lastCompletedAt: this.lastCompletedAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorCode: this.lastErrorCode,
      routes: [...this.routes.values()]
        .sort((left, right) => {
          if (right.requests !== left.requests) {
            return right.requests - left.requests;
          }
          if (left.name !== right.name) {
            return left.name.localeCompare(right.name);
          }
          return left.method.localeCompare(right.method);
        })
        .map((route) => this.toRouteSnapshot(route)),
      recentErrors: [...this.recentErrors],
    };
  }

  private readRoute(name: string, method: RuntimeTelemetryMethod): RuntimeTelemetryRouteRecord {
    const key = `${method}:${name}`;
    const existing = this.routes.get(key);
    if (existing) {
      return existing;
    }
    const created: RuntimeTelemetryRouteRecord = {
      name,
      method,
      requests: 0,
      successfulResponses: 0,
      failedResponses: 0,
      unauthorizedResponses: 0,
      rateLimitedResponses: 0,
      rejectedOriginResponses: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastStatusCode: null,
      lastRequestAt: null,
      lastCompletedAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
    };
    this.routes.set(key, created);
    return created;
  }

  private pushRecentError(record: RuntimeTelemetryErrorRecord): void {
    this.recentErrors.push(record);
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.splice(0, this.recentErrors.length - MAX_RECENT_ERRORS);
    }
  }

  private toRouteSnapshot(
    route: RuntimeTelemetryRouteRecord,
  ): ApertureRuntimeTelemetryRouteHealthSnapshot {
    return {
      name: route.name,
      method: route.method,
      requests: route.requests,
      successfulResponses: route.successfulResponses,
      failedResponses: route.failedResponses,
      unauthorizedResponses: route.unauthorizedResponses,
      rateLimitedResponses: route.rateLimitedResponses,
      rejectedOriginResponses: route.rejectedOriginResponses,
      averageDurationMs:
        route.requests === 0
          ? null
          : Math.round((route.totalDurationMs / route.requests) * 100) / 100,
      maxDurationMs: route.requests === 0 ? null : route.maxDurationMs,
      lastStatusCode: route.lastStatusCode,
      lastRequestAt: route.lastRequestAt,
      lastCompletedAt: route.lastCompletedAt,
      lastErrorAt: route.lastErrorAt,
      lastErrorCode: route.lastErrorCode,
    };
  }
}
