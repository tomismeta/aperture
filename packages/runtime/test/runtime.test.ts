import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConformedEvent } from "@aperture/core";

import { bootstrapLearningPersistence } from "../src/learning-persistence.js";
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

test("runtime adapter client observes attached surfaces through snapshot state", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl: controlUrl,
    kind: "claude-code",
    label: "Claude adapter",
    pollIntervalMs: 25,
  });

  try {
    assert.equal(client.getSurfaceCount(), 0);

    const attach = await fetch(`${controlUrl}/surfaces/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "tui" }),
    });
    assert.equal(attach.status, 200);

    const surfaceCount = await waitFor(() => {
      const count = client.getSurfaceCount();
      return count > 0 ? count : null;
    }, { timeoutMs: 750 });
    assert.equal(surfaceCount, 1);
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime bootstraps learning persistence and checkpoints memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-runtime-learning-"));
  const learning = await bootstrapLearningPersistence(root);
  const runtime = createApertureRuntime({
    controlPort: 0,
    core: learning.core,
    learningPersistence: learning.state,
  });
  const { controlUrl } = await runtime.listen();

  try {
    const memoryRaw = await readFile(join(root, ".aperture", "MEMORY.md"), "utf8");
    const judgmentRaw = await readFile(join(root, ".aperture", "JUDGMENT.md"), "utf8");
    assert.match(memoryRaw, /^# Memory/m);
    assert.match(judgmentRaw, /^# Judgment/m);
    assert.match(judgmentRaw, /Accepted rule names today:/);
    assert.match(judgmentRaw, /auto approve: true \| false/);
    assert.match(judgmentRaw, /lowRiskWeb/);
    assert.match(judgmentRaw, /fileWrite/);

    const client = await ApertureRuntimeAdapterClient.connect({
      baseUrl: controlUrl,
      kind: "claude-code",
      label: "Claude",
    });

    try {
      await client.publishConformed(approvalEvent("task:learn"));
      await fetch(`${controlUrl}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: "task:learn",
          interactionId: "interaction:learn",
          response: { kind: "approved" },
        }),
      });

      const checkpoint = await fetch(`${controlUrl}/learning/checkpoint`, {
        method: "POST",
      });
      assert.equal(checkpoint.status, 200);
      assert.deepEqual(await checkpoint.json(), {
        checkpointed: true,
        updatedAt: await readCheckpointUpdatedAt(join(root, ".aperture", "MEMORY.md")),
        sessionCount: 1,
      });

      const state = await fetch(`${controlUrl}/state`);
      const snapshot = await state.json() as ApertureRuntimeSnapshot;
      assert.equal(snapshot.learningPersistence?.enabled, true);
      assert.equal(snapshot.learningPersistence?.rootDir, join(root, ".aperture"));
      assert.equal(snapshot.learningPersistence?.memoryPath, join(root, ".aperture", "MEMORY.md"));
      assert.equal(snapshot.learningPersistence?.judgmentPath, join(root, ".aperture", "JUDGMENT.md"));
      assert.ok(snapshot.learningPersistence?.lastCheckpointAt);
    } finally {
      await client.close();
    }
  } finally {
    await runtime.close();
  }
});

test("runtime loads scaffolded judgment config and can reload it on demand", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-runtime-judgment-"));
  const learning = await bootstrapLearningPersistence(root);
  const runtime = createApertureRuntime({
    controlPort: 0,
    core: learning.core,
    learningPersistence: learning.state,
  });
  const { controlUrl } = await runtime.listen();

  try {
    await fetch(`${controlUrl}/events/conformed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: lowRiskReadEvent("task:read:1", "interaction:read:1"),
      }),
    });

    const initialTaskView = runtime.getCore().getTaskView("task:read:1");
    assert.equal(initialTaskView.active, null);
    const initialSignal = runtime.getCore().getSignals("task:read:1")[0];
    assert.equal(initialSignal?.kind, "responded");

    await writeFile(
      join(root, ".aperture", "JUDGMENT.md"),
      [
        "# Judgment",
        "",
        "## Meta",
        "- version: 1",
        "- updated at: 2026-03-13T12:00:00.000Z",
        "",
        "## Policy",
        "",
        "### lowRiskRead",
        "- may interrupt: true",
        "- minimum presentation: active",
        "",
        "## Planner Defaults",
        "- batch status bursts: true",
        "- defer low value during pressure: true",
        "",
      ].join("\n"),
      "utf8",
    );

    const reload = await fetch(`${controlUrl}/learning/reload`, {
      method: "POST",
    });
    assert.equal(reload.status, 200);
    const reloadPayload = await reload.json() as { reloaded: boolean; loadedAt: string };
    assert.equal(reloadPayload.reloaded, true);
    assert.ok(reloadPayload.loadedAt);

    await fetch(`${controlUrl}/events/conformed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: lowRiskReadEvent("task:read:2", "interaction:read:2"),
      }),
    });

    const reloadedFrame = await waitFor(() => runtime.getCore().getTaskView("task:read:2").active);
    assert.equal(reloadedFrame?.interactionId, "interaction:read:2");

    const state = await fetch(`${controlUrl}/state`);
    const snapshot = await state.json() as ApertureRuntimeSnapshot;
    assert.ok(snapshot.learningPersistence?.lastLoadedAt);
  } finally {
    await runtime.close();
  }
});

test("runtime rejects oversized request bodies", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();

  try {
    const response = await fetch(`${controlUrl}/events/conformed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          ...blockedEvent("task-oversized"),
          summary: "x".repeat(70_000),
        },
      }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json() as { error: string };
    assert.match(payload.error, /request body exceeded/i);
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

function approvalEvent(taskId: string): ConformedEvent {
  return {
    id: `${taskId}:approval`,
    type: "human.input.requested",
    taskId,
    interactionId: "interaction:learn",
    timestamp: new Date().toISOString(),
    source: {
      id: "claude-code:workspace",
      kind: "claude-code",
      label: "Claude",
    },
    title: "Read config",
    summary: "Read config.ts",
    request: { kind: "approval" },
    riskHint: "low",
  };
}

function lowRiskReadEvent(taskId: string, interactionId: string): ConformedEvent {
  return {
    id: `${taskId}:read`,
    type: "human.input.requested",
    taskId,
    interactionId,
    timestamp: new Date().toISOString(),
    source: {
      id: "claude-code:workspace",
      kind: "claude-code",
      label: "Claude Code aperture",
    },
    title: "Claude Code wants to read config.ts",
    summary: "config.ts",
    request: { kind: "approval" },
    riskHint: "low",
  };
}

async function readCheckpointUpdatedAt(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const line = raw.split("\n").find((entry) => entry.startsWith("- updated at: "));
  return line?.slice("- updated at: ".length) ?? "";
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
