import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApertureRuntime } from "../../runtime/src/index.js";
import { createOpencodeBridge } from "../src/index.js";

test("bootstraps pending permissions and routes runtime responses back to OpenCode", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const sseClients = new Set<import("node:http").ServerResponse>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/permission") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([
        {
          id: "perm-1",
          sessionID: "ses-1",
          message: "Run bash tool",
          metadata: { tool: "bash" },
          createdAt: "2026-03-14T12:00:00.000Z",
        },
      ]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/question") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "POST" && url.pathname === "/permission/perm-1/reply") {
      requests.push({ method: req.method, path: url.pathname, body: await readJson(req) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/event") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseClients.add(res);
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const bridge = createOpencodeBridge({
    runtimeBaseUrl: controlUrl,
    client: {
      baseUrl,
      scope: {
        directory: "/workspace/project",
      },
    },
  });

  try {
    await bridge.start();

    const active = await waitFor(() => runtime.getCore().getAttentionView().active);
    assert.ok(active);
    assert.equal(active?.responseSpec?.kind, "approval");

    runtime.getCore().submit({
      taskId: active.taskId,
      interactionId: active.interactionId,
      response: { kind: "approved" },
    });

    await waitFor(() => requests[0] ?? null);
    assert.deepEqual(requests[0], {
      method: "POST",
      path: "/permission/perm-1/reply",
      body: { reply: "once" },
    });

    for (const client of sseClients) {
      client.write(`data: ${JSON.stringify({
        type: "permission.replied",
        properties: {
          id: "perm-1",
          sessionID: "ses-1",
          reply: "once",
        },
      })}\n\n`);
    }

    const cleared = await waitFor(() => runtime.getCore().getAttentionView().active === null ? true : null);
    assert.equal(cleared, true);
  } finally {
    await bridge.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("reconnects when the OpenCode event stream closes unexpectedly", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  let eventConnections = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/permission") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/question") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/event") {
      eventConnections += 1;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);

      if (eventConnections === 1) {
        setTimeout(() => {
          res.end();
        }, 25);
        return;
      }

      res.write(`data: ${JSON.stringify({
        type: "permission.asked",
        properties: {
          id: "perm-reconnect",
          sessionID: "ses-reconnect",
          message: "Reconnect permission",
          metadata: { tool: "bash" },
          createdAt: "2026-03-14T12:00:00.000Z",
        },
      })}\n\n`);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind");
  }

  const bridge = createOpencodeBridge({
    runtimeBaseUrl: controlUrl,
    client: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      reconnect: {
        initialDelayMs: 10,
        maxDelayMs: 20,
        maxAttempts: 3,
      },
    },
  });

  try {
    await bridge.start();

    const active = await waitFor(() => runtime.getCore().getAttentionView().active, { timeoutMs: 1_000 });
    assert.ok(active);
    assert.equal(active?.responseSpec?.kind, "approval");
    assert.ok(eventConnections >= 2);
  } finally {
    await bridge.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("reconnects when the OpenCode event stream stops heartbeating", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  let eventConnections = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/permission") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/question") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([]));
      return;
    }

    if (req.method === "GET" && url.pathname === "/event") {
      eventConnections += 1;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);

      if (eventConnections === 1) {
        return;
      }

      res.write(`data: ${JSON.stringify({
        type: "permission.asked",
        properties: {
          id: "perm-heartbeat",
          sessionID: "ses-heartbeat",
          message: "Heartbeat permission",
          metadata: { tool: "bash" },
          createdAt: "2026-03-14T12:00:00.000Z",
        },
      })}\n\n`);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind");
  }

  const bridge = createOpencodeBridge({
    runtimeBaseUrl: controlUrl,
    client: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      reconnect: {
        initialDelayMs: 10,
        maxDelayMs: 20,
        heartbeatTimeoutMs: 40,
        maxAttempts: 4,
      },
    },
  });

  try {
    await bridge.start();

    const active = await waitFor(() => runtime.getCore().getAttentionView().active, { timeoutMs: 1_000 });
    assert.ok(active);
    assert.equal(active?.responseSpec?.kind, "approval");
    assert.ok(eventConnections >= 2);
  } finally {
    await bridge.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor<T>(
  read: () => T | null,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = read();
    if (value !== null) {
      return value;
    }
    await sleep(intervalMs);
  }

  return read() as T;
}
