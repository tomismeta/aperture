import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import WebSocket, { WebSocketServer } from "ws";

import { CodexAppServerClient, CodexAppServerWebSocket } from "../src/index.js";
import type { CodexJsonRpcRequest } from "../src/protocol.js";

test("CodexAppServerClient can run against the built-in websocket transport", async (t) => {
  const sockets = new Set<WebSocket>();
  const serverRequests: Array<CodexJsonRpcRequest<string, unknown>> = [];
  const serverNotifications: Array<{ method: string; params?: unknown }> = [];
  const clientNotifications: Array<{ method: string; params?: unknown }> = [];
  const clientServerRequests: Array<{ id: string | number; method: string; params?: unknown }> = [];
  let resolveNotification: (() => void) | null = null;
  let resolveServerRequest: (() => void) | null = null;
  const notificationSeen = new Promise<void>((resolve) => {
    resolveNotification = resolve;
  });
  const serverRequestSeen = new Promise<void>((resolve) => {
    resolveServerRequest = resolve;
  });

  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");

  t.after(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString("utf8")) as {
        id?: string | number;
        method?: string;
        params?: unknown;
      };
      if (payload.method === "initialize") {
        serverRequests.push(payload as CodexJsonRpcRequest<string, unknown>);
        socket.send(JSON.stringify({
          id: payload.id,
          result: {
            userAgent: "codex-ws-test",
            platformFamily: "unix",
            platformOs: "macos",
          },
        }));
        socket.send(JSON.stringify({
          method: "demo/notification",
          params: { status: "ready" },
        }));
        socket.send(JSON.stringify({
          id: "demo-request-1",
          method: "demo/request",
          params: { prompt: "Need approval" },
        }));
        return;
      }
      if (payload.method === "initialized") {
        serverNotifications.push(payload as { method: string; params?: unknown });
        return;
      }
      if (payload.method === "thread/start") {
        serverRequests.push(payload as CodexJsonRpcRequest<string, unknown>);
        socket.send(JSON.stringify({
          id: payload.id,
          result: {
            thread: {
              id: "thread-ws-1",
              preview: "hello",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 0,
              updatedAt: 0,
              status: { type: "idle" },
              path: null,
              cwd: "/repo",
              cliVersion: "0.0.0",
              source: "appServer",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          },
        }));
      }
    });
  });

  const address = server.address() as AddressInfo;
  const client = new CodexAppServerClient({
    transportKind: "websocket",
    websocket: {
      url: `ws://127.0.0.1:${address.port}`,
    },
  });

  client.onNotification((notification) => {
    clientNotifications.push(notification);
    resolveNotification?.();
    resolveNotification = null;
  });
  client.onServerRequest((request) => {
    clientServerRequests.push(request);
    resolveServerRequest?.();
    resolveServerRequest = null;
  });

  const initialized = await client.start();
  assert.equal(initialized.userAgent, "codex-ws-test");
  await Promise.all([notificationSeen, serverRequestSeen]);

  const result = await client.threadStart({ cwd: "/repo", model: "gpt-5.4" });
  assert.equal(result.thread.id, "thread-ws-1");

  assert.equal(serverRequests[0]?.method, "initialize");
  assert.equal(serverRequests[1]?.method, "thread/start");
  assert.equal(serverNotifications[0]?.method, "initialized");
  assert.equal(clientNotifications[0]?.method, "demo/notification");
  assert.equal(clientServerRequests[0]?.method, "demo/request");

  await client.close();
});

test("CodexAppServerWebSocket resolves requests and dispatches notifications and server requests", async (t) => {
  const sockets = new Set<WebSocket>();
  const observedNotifications: string[] = [];
  const observedRequests: string[] = [];

  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");

  t.after(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString("utf8")) as { id?: string | number; method?: string };
      if (payload.method === "demo/request") {
        socket.send(JSON.stringify({
          id: payload.id,
          result: { ok: true },
        }));
        socket.send(JSON.stringify({
          method: "demo/notification",
          params: { phase: "after-request" },
        }));
        socket.send(JSON.stringify({
          id: "server-request-1",
          method: "demo/serverRequest",
          params: { question: "continue?" },
        }));
      }
    });
  });

  const address = server.address() as AddressInfo;
  const transport = new CodexAppServerWebSocket({
    url: `ws://127.0.0.1:${address.port}`,
  });

  transport.onNotification((notification) => {
    observedNotifications.push(notification.method);
  });
  transport.onServerRequest((request) => {
    observedRequests.push(request.method);
  });

  await transport.start();
  const result = await transport.request<{ ok: boolean }>({
    id: 1,
    method: "demo/request",
    params: { value: 1 },
  });

  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(observedNotifications, ["demo/notification"]);
  assert.deepEqual(observedRequests, ["demo/serverRequest"]);

  await transport.close();
});

test("CodexAppServerWebSocket rejects pending requests on server errors and unexpected disconnects", async (t) => {
  const sockets = new Set<WebSocket>();
  let connectedSocket: WebSocket | null = null;
  const exitErrors: Error[] = [];

  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");

  t.after(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  server.on("connection", (socket) => {
    connectedSocket = socket;
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString("utf8")) as { id?: string | number; method?: string };
      if (payload.method === "demo/error") {
        socket.send(JSON.stringify({
          id: payload.id,
          error: {
            code: -32000,
            message: "nope",
          },
        }));
        return;
      }
      if (payload.method === "demo/pending-disconnect") {
        setTimeout(() => {
          socket.close(1011, "boom");
        }, 10);
      }
    });
  });

  const address = server.address() as AddressInfo;
  const transport = new CodexAppServerWebSocket({
    url: `ws://127.0.0.1:${address.port}`,
  });
  transport.onExit((error) => {
    exitErrors.push(error);
  });

  await transport.start();

  await assert.rejects(
    transport.request({
      id: 1,
      method: "demo/error",
      params: {},
    }),
    /nope/,
  );

  await assert.rejects(
    transport.request({
      id: 2,
      method: "demo/pending-disconnect",
      params: {},
    }),
    /closed with code 1011/,
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(exitErrors.length, 1);
  assert.equal(sockets.size, 0);

  await transport.close();
});
