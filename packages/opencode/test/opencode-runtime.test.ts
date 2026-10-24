import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import test from "node:test";

import { createApertureRuntime } from "@aperture/runtime";
import { ApertureCore, type AttentionResponse, type SourceEvent } from "@tomismeta/aperture-core";
import { createOpencodeBridge, createOpencodeInstanceKey } from "../src/index.js";

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

    if (req.method === "POST" && url.pathname === "/session/ses-1/permissions/perm-1") {
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

    const active = await waitFor(() => runtime.getCore().getAttentionView().now);
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
      path: "/session/ses-1/permissions/perm-1",
      body: { response: "once" },
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

    const cleared = await waitFor(() => runtime.getCore().getAttentionView().now === null ? true : null);
    assert.equal(cleared, true);
  } finally {
    await bridge.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("bridges isolate broadcast responses when native request and session IDs overlap", async (t) => {
  for (const scenario of [
    {
      name: "different servers",
      clients: [
        { baseUrl: "http://127.0.0.1:4096" },
        { baseUrl: "http://127.0.0.1:4097" },
      ],
    },
    {
      name: "different directories on one server",
      clients: [
        { baseUrl: "http://127.0.0.1:4096", scope: { directory: "/workspace/a" } },
        { baseUrl: "http://127.0.0.1:4096", scope: { directory: "/workspace/b" } },
      ],
    },
  ]) {
    await t.test(scenario.name, async () => {
      const listeners = new Set<(response: AttentionResponse) => void>();
      const fixtures = scenario.clients.map((client) => {
        const published: SourceEvent[] = [];
        const replies: Array<{ kind: string; id: string }> = [];
        const bridge = createOpencodeBridge({
          runtimeBaseUrl: "http://runtime.invalid",
          client,
          bridgeClient: {
            async listPermissions() {
              return [{ id: "shared-request", sessionID: "shared-session", message: "Approve deploy" }];
            },
            async listQuestions() { return []; },
            async replyToPermission(id) { replies.push({ kind: "permission", id }); },
            async replyToQuestion(id) { replies.push({ kind: "question", id }); },
            async rejectQuestion(id) { replies.push({ kind: "reject", id }); },
            async promptSession(id) { replies.push({ kind: "prompt", id }); },
            async *streamEvents({ signal } = {}) {
              yield { type: "server.connected", properties: {} };
              if (signal && !signal.aborted) {
                await new Promise<void>((resolve) => {
                  signal.addEventListener("abort", () => resolve(), { once: true });
                });
              }
            },
          },
          runtimeClientFactory: async () => ({
            async publishSourceEvent(event) { published.push(event); },
            async publishSourceEventBatch(events) { published.push(...events); },
            async submit() {},
            async retract() { return false; },
            async close() {},
            onResponse(listener) {
              listeners.add(listener);
              return () => { listeners.delete(listener); };
            },
          }),
        });
        return { bridge, client, published, replies };
      });

      try {
        for (const fixture of fixtures) {
          await fixture.bridge.start();
        }
        assert.equal(listeners.size, 2);
        assert.notEqual(fixtures[0]?.published[0]?.taskId, fixtures[1]?.published[0]?.taskId);

        for (const [index, fixture] of fixtures.entries()) {
          const permission = fixture.published[0];
          assert.equal(permission?.type, "human.input.requested");
          if (permission?.type !== "human.input.requested") {
            throw new Error("Expected a bootstrapped permission.");
          }
          const instanceKey = createOpencodeInstanceKey(fixture.client);
          const responses: AttentionResponse[] = [
            { taskId: permission.taskId, interactionId: permission.interactionId, response: { kind: "approved" } },
            {
              taskId: permission.taskId,
              interactionId: `opencode:${instanceKey}:question:shared-request`,
              response: { kind: "option_selected", optionIds: ["yes"] },
            },
            {
              taskId: permission.taskId,
              interactionId: `opencode:${instanceKey}:question:shared-request`,
              response: { kind: "rejected" },
            },
            {
              taskId: permission.taskId,
              interactionId: `opencode:${instanceKey}:followup:shared-session|shared-part`,
              response: { kind: "text_submitted", text: "Continue." },
            },
          ];
          for (const response of responses) {
            for (const listener of listeners) {
              listener(response);
            }
          }
          await Promise.resolve();

          assert.deepEqual(fixture.replies, [
            { kind: "permission", id: "shared-request" },
            { kind: "question", id: "shared-request" },
            { kind: "reject", id: "shared-request" },
            { kind: "prompt", id: "shared-session" },
          ]);
          assert.equal(fixtures[1 - index]?.replies.length, index === 0 ? 0 : 4);
        }
      } finally {
        for (const fixture of fixtures) {
          await fixture.bridge.close();
        }
      }
    });
  }
});

test("native question resolutions retract exact choice and form frames without responses or echoes", async (t) => {
  for (const kind of ["choice", "form"] as const) {
    for (const resolution of ["question.replied", "question.rejected"] as const) {
      await t.test(`${kind}: ${resolution}`, async () => {
        const runtime = createApertureRuntime({ controlPort: 0 });
        const { controlUrl } = await runtime.listen();
        const core = runtime.getCore();
        const responses: AttentionResponse[] = [];
        const issues: string[] = [];
        core.onResponse((response) => { responses.push(response); });
        core.subscribeAttentionView((view) => {
          for (const frame of [view.now, ...view.next, ...view.ambient]) {
            if (frame?.title.includes("OpenCode event stream") || frame?.title === "OpenCode reply failed") {
              issues.push(frame.title);
            }
          }
        });
        const requests: string[] = [];
        const sseClients = new Set<ServerResponse>();
        let connections = 0;
        const questions = kind === "choice"
          ? [{ header: "Choose destination", question: "Where?", options: [{ label: "Local" }, { label: "Remote" }] }]
          : [{ header: "Destination", question: "Where?" }, { header: "Reason", question: "Why?" }];
        const server = createServer(async (req, res) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          if (req.method === "GET" && url.pathname === "/permission") {
            res.setHeader("Content-Type", "application/json");
            res.end("[]");
            return;
          }
          if (req.method === "GET" && url.pathname === "/question") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(["target", "sibling"].map((id) => ({
              id, sessionID: "shared-session", questions,
            }))));
            return;
          }
          if (req.method === "GET" && url.pathname === "/event") {
            connections += 1;
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            sseClients.add(res);
            res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
            req.on("close", () => { sseClients.delete(res); });
            return;
          }
          if (req.method === "POST") {
            requests.push(url.pathname);
            await readJson(req);
            res.setHeader("Content-Type", "application/json");
            res.end("{}");
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
        const instanceKey = createOpencodeInstanceKey({ baseUrl });
        const taskId = `opencode:${instanceKey}:session:shared-session`;
        const interactionId = (id: string) => `opencode:${instanceKey}:question:${id}`;
        const frames = () => {
          const view = core.getTaskView(taskId);
          return [...(view.now ? [view.now] : []), ...view.next, ...view.ambient];
        };
        const send = (type: string, properties: Record<string, unknown>) => {
          for (const client of sseClients) {
            client.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
          }
        };
        const bridge = createOpencodeBridge({ runtimeBaseUrl: controlUrl, client: { baseUrl } });
        try {
          await bridge.start();
          assert.ok(await waitFor(() => sseClients.size === 1 ? true : null));
          assert.deepEqual(frames().map((frame) => frame.interactionId).sort(),
            [interactionId("target"), interactionId("sibling")].sort());
          assert.ok(frames().every((frame) => frame.responseSpec?.kind === kind));

          send(resolution, { requestID: "target", sessionID: "shared-session", answers: [["Local"]] });
          assert.ok(await waitFor(() => frames().length === 1 ? true : null));
          assert.equal(frames()[0]?.interactionId, interactionId("sibling"));
          assert.deepEqual(responses, []);
          assert.deepEqual(requests, []);

          send(resolution, { requestID: "sibling", sessionID: "shared-session" });
          assert.ok(await waitFor(() => frames().length === 0 ? true : null));
          send(resolution, { requestID: "target", sessionID: "shared-session" });
          send(resolution, { requestID: "unknown", sessionID: "unknown-session" });
          send("permission.asked", {
            id: "native-permission", sessionID: "shared-session", message: "Approve deployment",
          });
          const permissionId = `opencode:${instanceKey}:permission:native-permission`;
          assert.ok(await waitFor(() => frames().find((frame) => frame.interactionId === permissionId) ?? null));
          const reply = resolution === "question.replied" ? "once" : "reject";
          send("permission.replied", {
            requestID: "native-permission", sessionID: "shared-session", reply, message: "Not now",
          });
          assert.ok(await waitFor(() => responses.length === 1 && frames().length === 0 ? true : null));
          assert.deepEqual(responses, [{
            taskId,
            interactionId: permissionId,
            response: reply === "once" ? { kind: "approved" } : { kind: "rejected", reason: "Not now" },
          }]);

          // A subsequent real response proves the poll loop reached the native response
          // without echoing it, and that suppression does not affect other interactions.
          send("permission.asked", {
            id: "outbound-permission", sessionID: "shared-session", message: "Approve release",
          });
          const outboundId = `opencode:${instanceKey}:permission:outbound-permission`;
          assert.ok(await waitFor(() => frames().find((frame) => frame.interactionId === outboundId) ?? null));
          core.submit({ taskId, interactionId: outboundId, response: { kind: "approved" } });
          assert.ok(await waitFor(() => requests.length > 0 ? true : null, { timeoutMs: 1_000 }));
          assert.deepEqual(requests, ["/session/shared-session/permissions/outbound-permission"]);
          assert.equal(responses.length, 2);
          assert.deepEqual(issues, []);
          assert.equal(connections, 1);
        } finally {
          await bridge.close();
          await runtime.close();
          await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        }
      });
    }
  }
});

test("question requests with read wording stay interactive under lowRiskRead auto-approve policy", async () => {
  const runtime = createApertureRuntime({
    controlPort: 0,
    core: new ApertureCore({
      policyConfig: {
        version: 1,
        updatedAt: "2026-03-16T12:00:00.000Z",
        policy: {
          lowRiskRead: {
            autoApprove: true,
          },
        },
      },
    }),
  });
  const { controlUrl } = await runtime.listen();
  const sseClients = new Set<import("node:http").ServerResponse>();

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

    for (const client of sseClients) {
      client.write(`data: ${JSON.stringify({
        directory: "/workspace/project",
        payload: {
          type: "question.asked",
          properties: {
            id: "question-read-1",
            sessionID: "ses-question-1",
            questions: [
              {
                header: "Read first?",
                question: "Should I read the config before continuing?",
                options: [
                  { label: "Yes", description: "Read config first" },
                  { label: "No", description: "Skip the read step" },
                ],
              },
            ],
          },
        },
      })}\n\n`);
    }

    const active = await waitFor(() => runtime.getCore().getAttentionView().now, { timeoutMs: 1_000 });
    assert.ok(active);
    assert.equal(active?.mode, "choice");
    assert.equal(active?.responseSpec?.kind, "choice");
    assert.equal(active?.title, "Read first?");
  } finally {
    await bridge.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("follow-up text questions can be answered back into the OpenCode session", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const sseClients = new Set<import("node:http").ServerResponse>();

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

    if (req.method === "POST" && url.pathname === "/session/ses-follow-up/message") {
      requests.push({ method: req.method, path: url.pathname, body: await readJson(req) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ info: { id: "msg-1" }, parts: [] }));
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

    for (const client of sseClients) {
      client.write(`data: ${JSON.stringify({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-user-1",
            sessionID: "ses-follow-up",
            role: "user",
          },
        },
      })}\n\n`);
      client.write(`data: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          messageID: "msg-user-1",
          part: {
            id: "part-user-1",
            sessionID: "ses-follow-up",
            type: "text",
            text: "Can you ask me a single question?",
          },
        },
      })}\n\n`);
      client.write(`data: ${JSON.stringify({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-assistant-1",
            sessionID: "ses-follow-up",
            role: "assistant",
          },
        },
      })}\n\n`);
      client.write(`data: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          messageID: "msg-assistant-1",
          part: {
            id: "part-follow-up-1",
            sessionID: "ses-follow-up",
            type: "text",
            text: "What should I name the new directory?",
          },
        },
      })}\n\n`);
    }

    const active = await waitFor(() => runtime.getCore().getAttentionView().now, { timeoutMs: 1_000 });
    assert.ok(active);
    assert.equal(active?.responseSpec?.kind, "form");
    assert.equal(active?.title, "OpenCode is waiting for your reply");

    runtime.getCore().submit({
      taskId: active.taskId,
      interactionId: active.interactionId,
      response: {
        kind: "form_submitted",
        values: {
          reply: "notes",
        },
      },
    });

    await waitFor(() => requests[0] ?? null, { timeoutMs: 1_000 });
    assert.deepEqual(requests[0], {
      method: "POST",
      path: "/session/ses-follow-up/message",
      body: {
        parts: [
          {
            type: "text",
            text: "notes",
            metadata: {
              source: "aperture",
              interaction: "follow_up",
            },
          },
        ],
      },
    });
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

    const active = await waitFor(() => runtime.getCore().getAttentionView().now, { timeoutMs: 1_000 });
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

    const active = await waitFor(() => runtime.getCore().getAttentionView().now, { timeoutMs: 1_000 });
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
