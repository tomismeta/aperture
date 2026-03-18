import test from "node:test";
import assert from "node:assert/strict";

import {
  CodexAppServerClient,
  type CodexTransport,
} from "../src/index.js";
import type { CodexJsonRpcRequest } from "../src/protocol.js";

test("CodexAppServerClient can run against an injected transport", async () => {
  const requests: Array<CodexJsonRpcRequest<string, unknown>> = [];
  const notifications: Array<{ method: string; params?: unknown }> = [];

  const transport: CodexTransport = {
    async start() {},
    onNotification() {
      return () => {};
    },
    onServerRequest() {
      return () => {};
    },
    onExit() {
      return () => {};
    },
    onStderr() {
      return () => {};
    },
    async request<TResult>(
      request: CodexJsonRpcRequest<string, unknown>,
    ): Promise<TResult> {
      requests.push(request);
      switch (request.method) {
        case "initialize":
          return {
            userAgent: "codex-test",
            platformFamily: "unix",
            platformOs: "macos",
          } as TResult;
        case "thread/start":
          return {
            thread: {
              id: "thread-1",
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
          } as TResult;
        default:
          throw new Error(`Unexpected method: ${request.method}`);
      }
    },
    notify(notification) {
      notifications.push(notification);
    },
    respond() {},
    respondError() {},
    async close() {},
  };

  const client = new CodexAppServerClient({ transport });
  const initialized = await client.start();
  assert.equal(initialized.userAgent, "codex-test");
  assert.equal(notifications[0]?.method, "initialized");

  const result = await client.threadStart({ cwd: "/repo", model: "gpt-5.4" });
  assert.equal(result.thread.id, "thread-1");

  assert.equal(requests[0]?.method, "initialize");
  assert.equal(requests[1]?.method, "thread/start");
});
