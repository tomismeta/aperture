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
