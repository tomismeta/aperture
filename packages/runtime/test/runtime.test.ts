import test from "node:test";
import assert from "node:assert/strict";

import type { ConformedEvent } from "@aperture/core";

import { createApertureRuntime } from "../src/runtime.js";
import { ApertureRuntimeAdapterClient } from "../src/adapter-client.js";
import type { ApertureRuntimeSnapshot } from "../src/index.js";

test("runtime adapter client publishes conformed events into the shared core", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl: controlUrl,
    kind: "paperclip",
    label: "Paperclip VPS",
  });

  try {
    await client.publishConformed(blockedEvent("task-1"));

    const active = await waitFor(() => runtime.getCore().getAttentionView().active);
    assert.ok(active);
    assert.equal(active?.title, "Remote approval needed");
    assert.equal(runtime.getCore().getAttentionView().queued.length, 0);
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime tracks registered adapters in the snapshot", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl: controlUrl,
    kind: "custom-agent",
    label: "Mac mini",
    metadata: {
      location: "lan",
    },
  });

  try {
    const health = await fetch(`${controlUrl}/health`);
    assert.equal(health.status, 200);
    const healthJson = await health.json() as { adapterCount: number };
    assert.equal(healthJson.adapterCount, 1);

    const state = await fetch(`${controlUrl}/state`);
    assert.equal(state.status, 200);
    const snapshot = await state.json() as ApertureRuntimeSnapshot;
    assert.equal(snapshot.adapters.length, 1);
    assert.equal(snapshot.adapters[0]?.kind, "custom-agent");
    assert.equal(snapshot.adapters[0]?.label, "Mac mini");
    assert.equal(snapshot.adapters[0]?.metadata?.location, "lan");
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime conformed event endpoint accepts batches directly", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();

  try {
    const response = await fetch(`${controlUrl}/events/conformed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [blockedEvent("task-1"), completedEvent("task-1")],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { published: 2 });
    assert.equal(runtime.getCore().getAttentionView().active, null);
  } finally {
    await runtime.close();
  }
});

function blockedEvent(taskId: string): ConformedEvent {
  return {
    id: `${taskId}:blocked`,
    type: "task.updated",
    taskId,
    timestamp: new Date().toISOString(),
    source: {
      id: "paperclip:vps",
      kind: "paperclip",
      label: "Paperclip VPS",
    },
    title: "Remote approval needed",
    summary: "A remote agent needs a human decision.",
    status: "blocked",
  };
}

function completedEvent(taskId: string): ConformedEvent {
  return {
    id: `${taskId}:completed`,
    type: "task.completed",
    taskId,
    timestamp: new Date().toISOString(),
    source: {
      id: "paperclip:vps",
      kind: "paperclip",
      label: "Paperclip VPS",
    },
    summary: "Handled.",
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
  const timeoutMs = options.timeoutMs ?? 250;
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
