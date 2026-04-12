import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";

import { bootstrapLearningPersistence } from "../src/learning-persistence.js";
import { createApertureRuntime } from "../src/runtime.js";
import { ApertureRuntimeAdapterClient } from "../src/adapter-client.js";
import type { ApertureRuntimeSnapshot } from "../src/index.js";

test("runtime adapter client publishes source events into the shared core", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl: controlUrl,
    kind: "custom-agent",
    label: "Edge worker",
  });

  try {
    await client.publishSourceEvent(blockedEvent("task-1"));

    const active = await waitFor(() => runtime.getCore().getAttentionView().now);
    assert.ok(active);
    assert.equal(active?.title, "Remote approval needed");
    assert.equal(runtime.getCore().getAttentionView().next.length, 0);
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime tracks registered adapters in the snapshot", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();
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
    const healthJson = (await health.json()) as {
      adapterCount: number;
      health: {
        adapters: { count: number };
        core: { stores: { taskViews: { taskCount: number } } };
      };
    };
    assert.equal(healthJson.adapterCount, 1);
    assert.equal(healthJson.health.adapters.count, 1);
    assert.equal(healthJson.health.core.stores.taskViews.taskCount, 0);

    const state = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    assert.equal(state.status, 200);
    const snapshot = (await state.json()) as ApertureRuntimeSnapshot;
    assert.equal(typeof snapshot.version, "number");
    assert.equal(snapshot.adapters.length, 1);
    assert.equal(snapshot.adapters[0]?.kind, "custom-agent");
    assert.equal(snapshot.adapters[0]?.label, "Mac mini");
    assert.equal(snapshot.adapters[0]?.metadata?.location, "lan");
    assert.equal(snapshot.health.adapters.count, 1);
    assert.equal(snapshot.health.capture.eventFeedCount, 0);
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime health exposes capture, work-response, and core health details", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl, controlUrl, authToken } = await runtime.listen();

  try {
    const publish = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        kind: "input.requested",
        interaction: { id: "interaction:health" },
        work: {
          id: "task:health",
          title: "Approve health check",
          summary: "A health check approval is pending.",
        },
        request: {
          kind: "approval",
        },
      }),
    });
    assert.equal(publish.status, 200);

    const health = await fetch(`${controlUrl}/health`);
    assert.equal(health.status, 200);
    const payload = (await health.json()) as {
      health: {
        capture: { publishedSourceEvents: number };
        workResponses: { counts: { pending: number } };
        core: { stores: { taskViews: { taskCount: number } }; listeners: { totalActive: number } };
      };
    };

    assert.equal(payload.health.capture.publishedSourceEvents, 1);
    assert.equal(payload.health.workResponses.counts.pending, 1);
    assert.equal(payload.health.core.stores.taskViews.taskCount, 1);
    assert.equal(payload.health.core.listeners.totalActive >= 1, true);
  } finally {
    await runtime.close();
  }
});

test("runtime increments snapshot version when source events change state", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const before = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    assert.equal(before.status, 200);
    const beforeSnapshot = (await before.json()) as ApertureRuntimeSnapshot;

    const publish = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: blockedEvent("task-version"),
      }),
    });
    assert.equal(publish.status, 200);

    const eventPoll = await authorizedRuntimeFetch(controlUrl, authToken, "/events?since=0");
    assert.equal(eventPoll.status, 200);
    const eventPayload = (await eventPoll.json()) as { stateVersion: number; nextSequence: number };

    const after = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    assert.equal(after.status, 200);
    const afterSnapshot = (await after.json()) as ApertureRuntimeSnapshot;

    assert.ok(afterSnapshot.version > beforeSnapshot.version);
    assert.equal(eventPayload.stateVersion, afterSnapshot.version);
    assert.equal(typeof eventPayload.nextSequence, "number");
  } finally {
    await runtime.close();
  }
});

test("runtime engagement route preserves current focus during active operator interaction", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const engaged: SourceEvent = {
      id: "task-engaged:approval",
      type: "human.input.requested",
      taskId: "task-engaged",
      interactionId: "interaction:engaged",
      timestamp: "2026-03-08T12:00:00.000Z",
      source: {
        id: "claude-code:workspace",
        kind: "claude-code",
        label: "Claude Code aperture",
      },
      title: "Approve engaged deploy",
      summary: "The current deploy is waiting for approval.",
      request: { kind: "approval" },
      riskHint: "low",
    };
    const challenger: SourceEvent = {
      id: "task-challenger:approval",
      type: "human.input.requested",
      taskId: "task-challenger",
      interactionId: "interaction:challenger",
      timestamp: "2026-03-08T12:01:00.000Z",
      source: {
        id: "claude-code:workspace",
        kind: "claude-code",
        label: "Claude Code aperture",
      },
      title: "Approve fresher deploy",
      summary: "A stronger follow-up deploy is waiting for approval.",
      request: { kind: "approval" },
      riskHint: "medium",
    };

    const publishEngaged = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: engaged }),
    });
    assert.equal(publishEngaged.status, 200);

    const engage = await authorizedRuntimeFetch(controlUrl, authToken, "/engagement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: engaged.taskId,
        interactionId: engaged.interactionId,
        durationMs: 200,
      }),
    });
    assert.equal(engage.status, 200);

    const publishChallenger = await authorizedRuntimeFetch(
      controlUrl,
      authToken,
      "/events/source",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: challenger }),
      },
    );
    assert.equal(publishChallenger.status, 200);

    assert.equal(runtime.getCore().getAttentionView().now?.interactionId, "interaction:engaged");

    await sleep(260);

    assert.equal(runtime.getCore().getAttentionView().now?.interactionId, "interaction:challenger");
  } finally {
    await runtime.close();
  }
});

test("runtime source event endpoint accepts batches directly", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const response = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [blockedEvent("task-1"), completedEvent("task-1")],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { published: 2 });
    assert.equal(runtime.getCore().getAttentionView().now, null);
  } finally {
    await runtime.close();
  }
});

test("runtime rejects malformed source event payloads", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const response = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          id: "evt:invalid",
          type: "task.updated",
          taskId: "task:invalid",
          timestamp: "2026-03-21T18:00:00.000Z",
          title: "Missing status",
        },
      }),
    });

    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { message: string } };
    assert.match(payload.error.message, /invalid source event payload/i);
  } finally {
    await runtime.close();
  }
});

test("runtime exports a local session capture with source events, responses, and traces", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const event = blockedEvent("task-session-export");
    const publish = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    });
    assert.equal(publish.status, 200);

    await waitFor(() => runtime.getCore().getAttentionView().now);
    await waitFor(() =>
      runtime.exportSessionCapture().attentionViewSnapshots.length > 0 ? true : null,
    );

    const submit = await authorizedRuntimeFetch(controlUrl, authToken, "/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: event.taskId,
        interactionId: `interaction:${event.taskId}:status`,
        response: { kind: "acknowledged" },
      }),
    });
    assert.equal(submit.status, 200);

    const capture = runtime.exportSessionCapture();

    assert.equal(capture.captureSteps.length, 2);
    assert.equal(capture.captureSteps[0]?.kind, "publishSource");
    assert.equal(capture.captureSteps[1]?.kind, "submit");
    assert.equal(capture.publishedSourceEvents.length, 1);
    assert.equal(
      capture.submittedResponses.some((response) => response.taskId === event.taskId),
      true,
    );
    assert.equal(
      capture.traces.some((trace) => trace.event.id === event.id),
      true,
    );
    assert.equal(
      capture.signals.some((signal) => signal.taskId === event.taskId),
      true,
    );
    assert.ok(capture.attentionViewSnapshots.length >= 1);
    assert.equal(typeof capture.currentExplanation.targetLane, "string");
    assert.equal(Array.isArray(capture.currentExplanation.attentionRationale), true);
    assert.equal("steps" in capture, false);
    assert.equal("sourceEvents" in capture, false);
    assert.equal("responses" in capture, false);
    assert.equal("viewSnapshots" in capture, false);
    assert.equal("attentionView" in capture, false);
  } finally {
    await runtime.close();
  }
});

test("runtime session endpoint exposes the same local capture shape over HTTP", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: blockedEvent("task-session-http") }),
    });

    const response = await authorizedRuntimeFetch(controlUrl, authToken, "/session");
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      runtimeId: string;
      captureSteps: Array<{ kind: string }>;
      publishedSourceEvents: Array<{ taskId: string }>;
      traces: Array<{ event: { taskId: string } }>;
      currentExplanation: {
        targetInteractionId: string | null;
        targetLane: string;
        headline: string | null;
        routingAuthority: string | null;
      };
    };

    assert.equal(payload.runtimeId.length > 0, true);
    assert.equal(payload.captureSteps[0]?.kind, "publishSource");
    assert.equal(payload.publishedSourceEvents[0]?.taskId, "task-session-http");
    assert.equal(
      payload.traces.some((trace) => trace.event.taskId === "task-session-http"),
      true,
    );
    assert.equal(
      payload.currentExplanation.targetInteractionId,
      "interaction:task-session-http:status",
    );
    assert.equal(payload.currentExplanation.targetLane, "now");
    assert.match(payload.currentExplanation.headline ?? "", /blocked|operator attention/i);
    assert.equal(payload.currentExplanation.routingAuthority, "status");
  } finally {
    await runtime.close();
  }
});

test("runtime adapter client observes attached surfaces through snapshot state", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl: controlUrl,
    kind: "claude-code",
    label: "Claude adapter",
    pollIntervalMs: 25,
  });

  try {
    assert.equal(client.getSurfaceCount(), 0);

    const attach = await authorizedRuntimeFetch(controlUrl, authToken, "/surfaces/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "tui",
        capabilities: {
          topology: {
            supportsAmbient: false,
          },
          responses: {
            supportsSingleChoice: true,
            supportsMultipleChoice: false,
            supportsForm: true,
            supportsTextResponse: false,
          },
        },
      }),
    });
    assert.equal(attach.status, 200);

    const surfaceCount = await waitFor(
      () => {
        const count = client.getSurfaceCount();
        return count > 0 ? count : null;
      },
      { timeoutMs: 750 },
    );
    assert.equal(surfaceCount, 1);

    const state = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    const snapshot = (await state.json()) as ApertureRuntimeSnapshot;
    assert.equal(snapshot.surfaceCapabilities.topology.supportsAmbient, false);
    assert.equal(snapshot.surfaceCapabilities.responses.supportsForm, true);
    assert.equal(runtime.getCore().getSurfaceCapabilities().topology.supportsAmbient, false);
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
  const { controlUrl, authToken } = await runtime.listen();

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
      await client.publishSourceEvent(approvalEvent("task:learn"));
      await authorizedRuntimeFetch(controlUrl, authToken, "/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: "task:learn",
          interactionId: "interaction:learn",
          response: { kind: "approved" },
        }),
      });

      const checkpoint = await authorizedRuntimeFetch(
        controlUrl,
        authToken,
        "/learning/checkpoint",
        {
          method: "POST",
        },
      );
      assert.equal(checkpoint.status, 200);
      assert.deepEqual(await checkpoint.json(), {
        checkpointed: true,
        updatedAt: await readCheckpointUpdatedAt(join(root, ".aperture", "MEMORY.md")),
        sessionCount: 1,
      });

      const state = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
      const snapshot = (await state.json()) as ApertureRuntimeSnapshot;
      assert.equal(snapshot.learningPersistence?.enabled, true);
      assert.equal(snapshot.learningPersistence?.rootDir, join(root, ".aperture"));
      assert.equal(snapshot.learningPersistence?.memoryPath, join(root, ".aperture", "MEMORY.md"));
      assert.equal(
        snapshot.learningPersistence?.judgmentPath,
        join(root, ".aperture", "JUDGMENT.md"),
      );
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
  const { controlUrl, authToken } = await runtime.listen();

  try {
    await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: lowRiskReadEvent("task:read:1", "interaction:read:1"),
      }),
    });

    const initialTaskView = await waitFor(() => runtime.getCore().getTaskView("task:read:1").now);
    assert.equal(initialTaskView?.interactionId, "interaction:read:1");
    const initialSignals = runtime.getCore().getSignals("task:read:1");
    assert.equal(
      initialSignals.some((signal) => signal.kind === "responded"),
      false,
    );

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
        "- minimum lane: now",
        "",
        "## Planner Defaults",
        "- batch status bursts: true",
        "- defer low value during pressure: true",
        "",
      ].join("\n"),
      "utf8",
    );

    const reload = await authorizedRuntimeFetch(controlUrl, authToken, "/learning/reload", {
      method: "POST",
    });
    assert.equal(reload.status, 200);
    const reloadPayload = (await reload.json()) as { reloaded: boolean; loadedAt: string };
    assert.equal(reloadPayload.reloaded, true);
    assert.ok(reloadPayload.loadedAt);

    await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: lowRiskReadEvent("task:read:2", "interaction:read:2"),
      }),
    });

    const reloadedFrame = await waitFor(() => runtime.getCore().getTaskView("task:read:2").now);
    assert.equal(reloadedFrame?.interactionId, "interaction:read:2");

    const state = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    const snapshot = (await state.json()) as ApertureRuntimeSnapshot;
    assert.ok(snapshot.learningPersistence?.lastLoadedAt);
  } finally {
    await runtime.close();
  }
});

test("runtime rejects oversized request bodies", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const response = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          ...blockedEvent("task-oversized"),
          summary: "x".repeat(300_000),
        },
      }),
    });

    assert.equal(response.status, 413);
    const payload = (await response.json()) as { error: { message: string } };
    assert.match(payload.error.message, /request body exceeded/i);
  } finally {
    await runtime.close();
  }
});

test("runtime control routes require bearer auth while health stays open", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const health = await fetch(`${controlUrl}/health`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${controlUrl}/state`);
    assert.equal(unauthorized.status, 401);

    const authorized = await authorizedRuntimeFetch(controlUrl, authToken, "/state");
    assert.equal(authorized.status, 200);
  } finally {
    await runtime.close();
  }
});

test("runtime returns a typed conflict when an approval response has expired", async () => {
  let nowMs = Date.parse("2026-03-08T12:00:00.000Z");
  const core = new ApertureCore({
    responseExpiryMs: 1_000,
    timeSource: () => nowMs,
  });
  const runtime = createApertureRuntime({ controlPort: 0, core });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    const publish = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          id: "evt:expired-response",
          type: "human.input.requested",
          taskId: "task:expired-response",
          interactionId: "interaction:expired-response",
          timestamp: "2026-03-08T12:00:00.000Z",
          title: "Approve expired deploy",
          summary: "This approval should expire.",
          request: { kind: "approval" },
        } satisfies SourceEvent,
      }),
    });
    assert.equal(publish.status, 200);

    nowMs = Date.parse("2026-03-08T12:00:02.000Z");

    const response = await authorizedRuntimeFetch(controlUrl, authToken, "/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "task:expired-response",
        interactionId: "interaction:expired-response",
        response: { kind: "approved" },
      }),
    });
    assert.equal(response.status, 409);
    const payload = (await response.json()) as {
      error: { code: string; message: string; hint?: string };
    };
    assert.equal(payload.error.code, "response_expired");
    assert.match(payload.error.message, /must be revalidated/i);
    assert.match(payload.error.hint ?? "", /refresh the pending frame/i);
  } finally {
    await runtime.close();
  }
});

test("runtime separates live event retention from session capture retention", async () => {
  const runtime = createApertureRuntime({
    controlPort: 0,
    eventLogLimit: 2,
    captureLogLimit: 6,
  });
  const { controlUrl, authToken } = await runtime.listen();

  try {
    for (const taskId of ["task-retain-1", "task-retain-2", "task-retain-3", "task-retain-4"]) {
      const response = await authorizedRuntimeFetch(controlUrl, authToken, "/events/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: blockedEvent(taskId) }),
      });
      assert.equal(response.status, 200);
    }

    const eventsResponse = await authorizedRuntimeFetch(controlUrl, authToken, "/events?since=0");
    const eventsPayload = (await eventsResponse.json()) as { events: Array<{ type: string }> };
    assert.equal(eventsPayload.events.length <= 2, true);

    const capture = runtime.exportSessionCapture();
    assert.equal(capture.publishedSourceEvents.length, 4);
    assert.equal(capture.captureSteps.length, 4);
  } finally {
    await runtime.close();
  }
});

function blockedEvent(taskId: string): SourceEvent {
  return {
    id: `${taskId}:blocked`,
    type: "task.updated",
    taskId,
    timestamp: new Date().toISOString(),
    source: {
      id: "custom-agent:vps",
      kind: "custom-agent",
      label: "Edge worker",
    },
    title: "Remote approval needed",
    summary: "A remote agent needs a human decision.",
    status: "blocked",
  };
}

function completedEvent(taskId: string): SourceEvent {
  return {
    id: `${taskId}:completed`,
    type: "task.completed",
    taskId,
    timestamp: new Date().toISOString(),
    source: {
      id: "custom-agent:vps",
      kind: "custom-agent",
      label: "Edge worker",
    },
    summary: "Handled.",
  };
}

function approvalEvent(taskId: string): SourceEvent {
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

function lowRiskReadEvent(taskId: string, interactionId: string): SourceEvent {
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

function authorizedRuntimeFetch(
  controlUrl: string,
  authToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${authToken}`);
  return fetch(`${controlUrl}${path}`, {
    ...init,
    headers,
  });
}
