import test from "node:test";
import assert from "node:assert/strict";

import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";

import { createCodexBridge, type CodexBridgeClient, type CodexRuntimeClient } from "../src/index.js";
import type { CodexServerNotification, CodexServerRequest, JsonRpcId } from "../src/protocol.js";

test("bridge publishes mapped codex requests into runtime and routes responses back", async () => {
  const published: SourceEvent[][] = [];
  const sentResponses: Array<{ id: JsonRpcId; result: unknown }> = [];
  const responseListeners = new Set<(response: AttentionResponse) => void>();
  let requestListener: ((request: CodexServerRequest) => void) | null = null;
  let notificationListener: ((notification: CodexServerNotification) => void) | null = null;

  const fakeClient: CodexBridgeClient = {
    async start() {
      return { userAgent: "codex-test" };
    },
    onServerRequest(listener: (request: CodexServerRequest) => void) {
      requestListener = listener;
      return () => {
        requestListener = null;
      };
    },
    onNotification(listener: (notification: CodexServerNotification) => void) {
      notificationListener = listener;
      return () => {
        notificationListener = null;
      };
    },
    onExit() {
      return () => {};
    },
    onStderr() {
      return () => {};
    },
    respond(id: JsonRpcId, result: unknown) {
      sentResponses.push({ id, result });
    },
    respondError() {},
    async threadStart() {
      throw new Error("not implemented");
    },
    async threadResume() {
      throw new Error("not implemented");
    },
    async turnStart() {
      throw new Error("not implemented");
    },
    async turnSteer() {
      throw new Error("not implemented");
    },
    async turnInterrupt() {
      throw new Error("not implemented");
    },
    async reviewStart() {
      throw new Error("not implemented");
    },
    async close() {},
  };

  const fakeRuntimeClient: CodexRuntimeClient = {
    onResponse(listener: (response: AttentionResponse) => void) {
      responseListeners.add(listener);
      return () => {
        responseListeners.delete(listener);
      };
    },
    async publishSourceEventBatch(events: SourceEvent[]) {
      published.push(events);
    },
    async close() {},
  };

  const bridge = createCodexBridge({
    runtimeBaseUrl: "http://127.0.0.1:4546/runtime",
    client: fakeClient,
    runtimeClientFactory: async () => fakeRuntimeClient,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  await bridge.start();

  if (!requestListener) {
    assert.fail("expected codex bridge to register a server request listener");
  }
  const currentRequestListener: (request: CodexServerRequest) => void = requestListener;
  currentRequestListener({
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item:cmd:1",
      command: "pnpm test",
      cwd: "/repo",
    },
  });

  assert.equal(published[0]?.[0]?.type, "human.input.requested");

  const response: AttentionResponse = {
    taskId: "codex:thread:thread-1:turn:turn-1",
    interactionId: "codex:commandApproval:17:thread-1:turn-1:item%3Acmd%3A1",
    response: { kind: "approved" },
  };
  for (const listener of responseListeners) {
    listener(response);
  }

  assert.deepEqual(sentResponses[0], {
    id: 17,
    result: { decision: "accept" },
  });

  if (!notificationListener) {
    assert.fail("expected codex bridge to register a notification listener");
  }
  const currentNotificationListener: (notification: CodexServerNotification) => void = notificationListener;
  currentNotificationListener({
    method: "serverRequest/resolved",
    params: {
      threadId: "thread-1",
      requestId: 17,
    },
  });

  await bridge.close();
});

test("bridge rejects unsupported server requests explicitly", async () => {
  const errors: Array<{ id: JsonRpcId | null; error: { code: number; message: string } }> = [];
  let requestListener: ((request: { method: string; id: JsonRpcId; params?: unknown }) => void) | null = null;

  const fakeClient: CodexBridgeClient = {
    async start() {
      return { userAgent: "codex-test" };
    },
    onServerRequest(listener: (request: { method: string; id: JsonRpcId; params?: unknown }) => void) {
      requestListener = listener;
      return () => {
        requestListener = null;
      };
    },
    onNotification() {
      return () => {};
    },
    onExit() {
      return () => {};
    },
    onStderr() {
      return () => {};
    },
    respond() {},
    respondError(id: JsonRpcId | null, error: { code: number; message: string }) {
      errors.push({ id, error });
    },
    async threadStart() {
      throw new Error("not implemented");
    },
    async threadResume() {
      throw new Error("not implemented");
    },
    async turnStart() {
      throw new Error("not implemented");
    },
    async turnSteer() {
      throw new Error("not implemented");
    },
    async turnInterrupt() {
      throw new Error("not implemented");
    },
    async reviewStart() {
      throw new Error("not implemented");
    },
    async close() {},
  };

  const fakeRuntimeClient: CodexRuntimeClient = {
    onResponse() {
      return () => {};
    },
    async publishSourceEventBatch() {},
    async close() {},
  };

  const bridge = createCodexBridge({
    runtimeBaseUrl: "http://127.0.0.1:4546/runtime",
    client: fakeClient,
    runtimeClientFactory: async () => fakeRuntimeClient,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  await bridge.start();

  if (!requestListener) {
    assert.fail("expected codex bridge to register a server request listener");
  }
  const currentRequestListener: (request: { method: string; id: JsonRpcId; params?: unknown }) => void = requestListener;
  currentRequestListener({
    id: "unsupported-1",
    method: "item/tool/requestConfirmation",
    params: { threadId: "thread-1" },
  });

  assert.deepEqual(errors[0], {
    id: "unsupported-1",
    error: {
      code: -32601,
      message: "Unsupported Codex server request: item/tool/requestConfirmation",
    },
  });

  await bridge.close();
});

test("bridge reconnects after the codex app server exits", async () => {
  const published: SourceEvent[][] = [];
  const responseListeners = new Set<(response: AttentionResponse) => void>();
  const exitListeners = new Set<(error: Error) => void>();
  let startCount = 0;

  const fakeClient: CodexBridgeClient = {
    async start() {
      startCount += 1;
      return { userAgent: "codex-test" };
    },
    onServerRequest() {
      return () => {};
    },
    onNotification() {
      return () => {};
    },
    onExit(listener: (error: Error) => void) {
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    onStderr() {
      return () => {};
    },
    respond() {},
    respondError() {},
    async threadStart() {
      throw new Error("not implemented");
    },
    async threadResume() {
      throw new Error("not implemented");
    },
    async turnStart() {
      throw new Error("not implemented");
    },
    async turnSteer() {
      throw new Error("not implemented");
    },
    async turnInterrupt() {
      throw new Error("not implemented");
    },
    async reviewStart() {
      throw new Error("not implemented");
    },
    async close() {},
  };

  const fakeRuntimeClient: CodexRuntimeClient = {
    onResponse(listener: (response: AttentionResponse) => void) {
      responseListeners.add(listener);
      return () => {
        responseListeners.delete(listener);
      };
    },
    async publishSourceEventBatch(events: SourceEvent[]) {
      published.push(events);
    },
    async close() {},
  };

  const bridge = createCodexBridge({
    runtimeBaseUrl: "http://127.0.0.1:4546/runtime",
    client: fakeClient,
    runtimeClientFactory: async () => fakeRuntimeClient,
    reconnect: {
      initialDelayMs: 1,
      maxDelayMs: 1,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  await bridge.start();

  assert.equal(startCount, 1);

  for (const listener of exitListeners) {
    listener(new Error("Codex App Server exited with code 1"));
  }

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(startCount, 2);
  const lastEvent = published.at(-1)?.[0];
  assert.equal(lastEvent?.type, "task.updated");
  if (lastEvent?.type === "task.updated") {
    assert.equal(lastEvent.title, "Codex App Server connected");
  }

  await bridge.close();
});
