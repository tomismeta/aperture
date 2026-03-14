import test from "node:test";
import assert from "node:assert/strict";

import type { AttentionResponse as FrameResponse, AdapterEvent } from "@aperture/core";

import {
  createCodexAdapter,
  type CodexCommandApprovalRequest,
} from "../src/index.js";

test("Codex adapter publishes approval requests into the host", async () => {
  const published: AdapterEvent[] = [];
  const responses: unknown[] = [];
  const host = createHost({
    publishAdapterEvent(event) {
      published.push(event);
    },
  });
  const adapter = createCodexAdapter(host, {
    sendCodexResponse(response) {
      responses.push(response);
    },
  });

  try {
    await adapter.handleCodexRequest(commandApprovalRequest());

    assert.equal(published.length, 1);
    assert.equal(published[0]?.type, "human.input.requested");
    if (published[0]?.type === "human.input.requested") {
      assert.equal(published[0].source?.kind, "codex");
      assert.equal(published[0].title, "Approve Codex command");
      assert.equal(published[0].context?.items?.[0]?.value, "git push origin main");
    }
    assert.deepEqual(responses, []);
  } finally {
    adapter.close();
  }
});

test("Codex adapter maps aperture responses back to Codex results", async () => {
  const responses: unknown[] = [];
  const host = createHost();
  const adapter = createCodexAdapter(host, {
    sendCodexResponse(response) {
      responses.push(response);
    },
  });

  try {
    host.emitResponse({
      taskId: "codex:thread:thread-1:turn:turn-1",
      interactionId: "codex:approval:17:item%3Acmd%3A1",
      response: { kind: "approved" },
    });

    const response = await waitFor(() => responses[0] ?? null);
    assert.deepEqual(response, {
      id: 17,
      result: {
        decision: "approved",
      },
    });
  } finally {
    adapter.close();
  }
});

function commandApprovalRequest(): CodexCommandApprovalRequest {
  return {
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "item:cmd:1",
      threadId: "thread-1",
      turnId: "turn-1",
      command: "git push origin main",
      cwd: "/repo",
      reason: "Network access required",
    },
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
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

function createHost(overrides: {
  publishAdapterEvent?(event: AdapterEvent): void;
} = {}) {
  const listeners = new Set<(response: FrameResponse) => void>();

  return {
    publishAdapterEvent(event: AdapterEvent) {
      overrides.publishAdapterEvent?.(event);
    },
    publishAdapterEventBatch(events: AdapterEvent[]) {
      for (const event of events) {
        overrides.publishAdapterEvent?.(event);
      }
    },
    onResponse(listener: (response: FrameResponse) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitResponse(response: FrameResponse) {
      for (const listener of listeners) {
        listener(response);
      }
    },
  };
}
