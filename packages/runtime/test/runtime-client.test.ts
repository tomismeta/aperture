import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";
import { ApertureRuntimeClient } from "../src/runtime-client.js";
import { createApertureRuntime } from "../src/runtime.js";

for (const mode of ["failure", "race"] as const) {
  test(
    mode === "failure"
      ? "accepted responses stay accepted when state refresh fails"
      : "concurrent engagement and response refreshes never regress the surface",
    { timeout: 5_000 },
    async () => {
      const core = new ApertureCore();
      core.publishSourceEvent(approval("first"));
      const runtime = createApertureRuntime({ controlPort: 0, core });
      const { controlUrl, authToken } = await runtime.listen();
      const held = barrier();
      const release = barrier();
      let armed = false;
      let injected = false;
      let accepted = 0;
      const proxy = createServer(async (request, response) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const url = new URL(request.url!, controlUrl);
          const path = url.pathname.slice(new URL(controlUrl).pathname.length);
          const method = request.method ?? "GET";
          const upstream = await fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            ...(method === "GET" ? {} : { body: Buffer.concat(chunks) }),
          });
          const body = await upstream.text();
          if (path === "/response" && upstream.ok) accepted += 1;
          if (path === "/state" && armed && !injected) {
            injected = true;
            if (mode === "failure") {
              response.writeHead(503, { "Content-Type": "application/json" });
              response.end(
                JSON.stringify({
                  error: { code: "injected_outage", message: "State unavailable" },
                }),
              );
              return;
            }
            held.resolve();
            await release.promise;
          }
          response.writeHead(upstream.status, { "Content-Type": "application/json" });
          response.end(body);
        } catch (error) {
          response.writeHead(500);
          response.end(String(error));
        }
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const address = proxy.address();
      assert.ok(address && typeof address !== "string");
      let client: ApertureRuntimeClient | undefined;
      try {
        client = await ApertureRuntimeClient.connect({
          baseUrl: `http://127.0.0.1:${address.port}`,
          authToken,
          pollIntervalMs: 60_000,
        });
        const errors: Error[] = [];
        const refreshed = barrier();
        client.onError((error) => {
          errors.push(error);
          if (mode === "failure") refreshed.resolve();
        });
        const versions: number[] = [];
        client.subscribeSnapshot((snapshot) => {
          versions.push(snapshot.version);
          if (mode === "race" && versions.length >= 3) refreshed.resolve();
        });
        armed = true;
        if (mode === "race") {
          core.publishSourceEvent(approval("second"));
          client.engage("first", "first");
          await held.promise;
        }
        await client.submit({
          taskId: "first",
          interactionId: "first",
          response: { kind: "approved" },
        });
        release.resolve();
        assert.equal(accepted, 1);
        assert.equal(core.getFrame("first"), null);
        await refreshed.promise;
        if (mode === "failure") {
          assert.equal(client.getLastError(), errors[0]);
          assert.equal(errors[0]?.message, "State unavailable");
        } else {
          assert.deepEqual(
            versions,
            [...versions].sort((left, right) => left - right),
          );
          assert.equal(client.getAttentionView().now?.interactionId, "second");
          assert.deepEqual(errors, []);
        }
      } finally {
        release.resolve();
        await client?.close();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        await runtime.close();
      }
    },
  );
}

function approval(id: string): SourceEvent {
  return {
    id,
    type: "human.input.requested",
    taskId: id,
    interactionId: id,
    timestamp: new Date().toISOString(),
    title: `Approve ${id}`,
    summary: "Review an ordinary operation",
    request: { kind: "approval" },
  };
}

function barrier(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
