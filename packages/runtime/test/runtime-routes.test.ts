import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APERTURE_INTERNAL_READ_HEALTH } from "@tomismeta/aperture-core/internal";

import { buildRuntimeRoutes, type BuildRuntimeRoutesOptions } from "../src/runtime-routes.js";
import { RuntimeState } from "../src/runtime-state.js";
import type { RuntimeRoute } from "../src/runtime-router.js";
import { RuntimeTelemetry } from "../src/runtime-telemetry.js";
import { WorkResponseStore } from "../src/work-response-store.js";

test("runtime route table preserves auth and rate-limit policy invariants", async () => {
  const routes = await buildRoutesForTest();

  const unauthenticatedRoutes = routes.filter((route) => route.requiresAuth === false);
  assert.equal(unauthenticatedRoutes.length, 1);
  assert.equal(unauthenticatedRoutes[0]?.method, "GET");
  assert.ok(unauthenticatedRoutes[0]?.match("/runtime/health"));

  for (const route of routes) {
    if (route !== unauthenticatedRoutes[0]) {
      assert.notEqual(route.requiresAuth, false);
    }
  }

  for (const route of routes.filter((candidate) => candidate.mutating)) {
    assert.equal(typeof route.rateLimitKey, "string");
    assert.notEqual(route.rateLimitKey?.trim(), "");
  }

  for (const route of routes) {
    assert.equal(typeof route.name, "string");
    assert.notEqual(route.name.trim(), "");
  }
});

test("runtime route table keeps public work aliases aligned with control policy", async () => {
  const routes = await buildRoutesForTest();

  const workGet = findRoute(routes, "GET", "/work");
  const v1WorkGet = findRoute(routes, "GET", "/v1/work");
  const workPost = findRoute(routes, "POST", "/work");
  const v1WorkPost = findRoute(routes, "POST", "/v1/work");
  const workResponseGet = findRoute(routes, "GET", "/work/response/interaction%3Atest%3Aapproval");
  const workResponseDelete = findRoute(
    routes,
    "DELETE",
    "/work/response/interaction%3Atest%3Aapproval",
  );
  const sourceEventsPost = findRoute(routes, "POST", "/runtime/events/source");

  assert.ok(workGet);
  assert.ok(v1WorkGet);
  assert.ok(workPost);
  assert.ok(v1WorkPost);
  assert.ok(workResponseGet);
  assert.ok(workResponseDelete);
  assert.ok(sourceEventsPost);

  assertRoutePolicy(workGet, { mutating: undefined, rateLimitKey: undefined });
  assertRoutePolicy(v1WorkGet, { mutating: undefined, rateLimitKey: undefined });
  assertRoutePolicy(workPost, { mutating: true, rateLimitKey: "work" });
  assertRoutePolicy(v1WorkPost, { mutating: true, rateLimitKey: "work" });
  assertRoutePolicy(workResponseGet, { mutating: undefined, rateLimitKey: undefined });
  assertRoutePolicy(workResponseDelete, { mutating: true, rateLimitKey: "work" });
  assertRoutePolicy(sourceEventsPost, { mutating: true, rateLimitKey: "source" });
});

async function buildRoutesForTest(): Promise<RuntimeRoute[]> {
  const stateDir = await mkdtemp(join(tmpdir(), "aperture-runtime-routes-"));
  const workResponses = await WorkResponseStore.open({
    stateDir,
    maxEntries: 16,
    pendingTtlMs: 60_000,
    retentionMs: 60_000,
  });
  const state = new RuntimeState({
    runtimeId: "runtime:test",
    kind: "test",
    startedAt: "2026-04-11T00:00:00.000Z",
    eventLogLimit: 8,
    captureLogLimit: 8,
    adapterTtlMs: 60_000,
    surfaceTtlMs: 60_000,
    workResponses,
    telemetry: new RuntimeTelemetry(),
  });
  const core = {
    checkpointMemory: async () => null,
    reloadMarkdown: async () => false,
    submit: () => undefined,
    engage: () => undefined,
    getAttentionView: () => {
      throw new Error("unused in route-table tests");
    },
    getSignalSummary: () => {
      throw new Error("unused in route-table tests");
    },
    getAttentionState: () => {
      throw new Error("unused in route-table tests");
    },
    [APERTURE_INTERNAL_READ_HEALTH]: () => {
      throw new Error("unused in route-table tests");
    },
  } as BuildRuntimeRoutesOptions["core"];

  return buildRuntimeRoutes({
    runtimeId: "runtime:test",
    kind: "test",
    controlHost: "127.0.0.1",
    controlPort: 4546,
    controlPathPrefix: "/runtime",
    bodyLimits: {
      general: 16 * 1024,
      work: 64 * 1024,
      sourceEvents: 256 * 1024,
    },
    core,
    state,
    getListeningPort: () => 4546,
    publishSourceEvents: () => undefined,
    syncSurfaceCapabilities: () => undefined,
    exportSessionCapture: () =>
      state.exportSessionCapture(core, {
        targetInteractionId: null,
        targetLane: "none",
        headline: null,
        whyNow: null,
        routingAuthority: null,
        semanticImpact: null,
        semanticInfluence: [],
        coordinationReasons: [],
        plannerReasons: [],
        policyRationale: [],
        criterionRationale: [],
        continuityRationale: [],
        attentionRationale: [],
      }),
    setLearningPersistence: () => undefined,
    readLearningPersistence: () => undefined,
  });
}

function findRoute(
  routes: RuntimeRoute[],
  method: RuntimeRoute["method"],
  path: string,
): RuntimeRoute | undefined {
  return routes.find((route) => route.method === method && route.match(path) !== null);
}

function assertRoutePolicy(
  route: RuntimeRoute,
  expected: { mutating: boolean | undefined; rateLimitKey: string | undefined },
): void {
  assert.notEqual(route.requiresAuth, false);
  assert.equal(route.mutating, expected.mutating);
  assert.equal(route.rateLimitKey, expected.rateLimitKey);
}
