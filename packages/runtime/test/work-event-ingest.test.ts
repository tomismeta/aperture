import test from "node:test";
import assert from "node:assert/strict";

import { createApertureRuntime } from "../src/runtime.js";
import { ApertureRuntimeAdapterClient } from "../src/adapter-client.js";
import {
  mapWorkTextToSourceEvent,
  mapWorkEventToSourceEvent,
  type WorkEvent,
} from "../src/work-event-ingest.js";

test("maps neutral work.updated events into SourceEvent with facts and hints", () => {
  const event = mapWorkEventToSourceEvent({
    specVersion: "1.0",
    id: "evt:deploy:status",
    source: "urn:example:custom-agent",
    type: "io.agent.work.updated.v1",
    time: "2026-04-09T14:00:00Z",
    kind: "work.updated",
    work: {
      id: "task:deploy-42",
      title: "Deploy service",
      summary: "Waiting for approval before continuing.",
      status: "waiting",
      progress: 0.7,
    },
    facts: {
      capabilityFamily: "deploy",
      activityCategory: "status_update",
    },
    hints: {
      consequence: "high",
      capabilityFamily: "release-ops",
      activityCategory: "approval_request",
      requestKind: "approval",
    },
  });

  assert.equal(event.type, "task.updated");
  assert.equal(event.taskId, "task:deploy-42");
  assert.equal(event.toolFamily, "deploy");
  assert.equal(event.activityClass, "status_update");
  assert.equal(event.status, "waiting");
  assert.equal(event.progress, 0.7);
  assert.deepEqual(event.semanticHints, {
    consequence: "high",
    toolFamily: "release-ops",
    activityClass: "permission_request",
    intentFrame: "approval_request",
  });
});

test("maps neutral input.requested events into SourceEvent with approval semantics", () => {
  const event = mapWorkEventToSourceEvent(workApprovalEvent("task:deploy-42"));

  assert.equal(event.type, "human.input.requested");
  assert.equal(event.taskId, "task:deploy-42");
  assert.equal(event.interactionId, "interaction:task:deploy-42:approval");
  assert.equal(event.title, "Approve deploy");
  assert.equal(event.summary, "Approve production deployment.");
  assert.equal(event.request.kind, "approval");
  assert.equal(event.riskHint, "high");
  assert.equal(event.toolFamily, "deploy");
  assert.equal(event.activityClass, "permission_request");
  assert.deepEqual(event.source, {
    id: "agent-1",
    kind: "urn:example:custom-agent",
    label: "Custom Agent",
  });
});

test("maps plain text work input into a standalone SourceEvent", () => {
  const event = mapWorkTextToSourceEvent("Waiting for approval before continuing with the deploy.");

  assert.equal(event.type, "task.updated");
  assert.equal(event.status, "waiting");
  assert.equal(event.summary, "Waiting for approval before continuing with the deploy.");
  assert.equal(event.taskId.startsWith("work:"), true);
});

test("runtime work endpoint accepts neutral events directly", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workApprovalEvent("task:runtime:approval")),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      accepted: number;
      mode: string;
      items: Array<{ taskId: string; interactionId?: string }>;
    };
    assert.equal(payload.accepted, 1);
    assert.equal(payload.mode, "event");
    assert.equal(payload.items[0]?.taskId, "task:runtime:approval");
    assert.equal(payload.items[0]?.interactionId, "interaction:task:runtime:approval:approval");

    const active = await waitFor(() => runtime.getCore().getAttentionView().now);
    assert.ok(active);
    assert.equal(active?.title, "Approve deploy");
    assert.equal(active?.mode, "approval");
  } finally {
    await runtime.close();
  }
});

test("runtime adapter client can publish neutral events", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl,
    kind: "custom-agent",
    label: "Neutral ingress",
  });

  try {
    const result = await client.publishWork(workApprovalEvent("task:client:approval"));
    assert.equal(result.accepted, 1);
    assert.equal(result.mode, "event");

    const active = await waitFor(() => runtime.getCore().getAttentionView().now);
    assert.ok(active);
    assert.equal(active?.taskId, "task:client:approval");
    assert.equal(active?.mode, "approval");
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime work endpoint accepts plain text work input", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Waiting for approval before continuing with the deploy.",
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      accepted: number;
      mode: string;
      tips?: string[];
    };
    assert.equal(payload.accepted, 1);
    assert.equal(payload.mode, "text");
    assert.equal(Array.isArray(payload.tips), true);

    const [event] = runtime.exportSessionCapture().publishedSourceEvents.slice(-1);
    assert.ok(event);
    assert.equal(event.type, "task.updated");
    assert.equal(event.status, "waiting");
  } finally {
    await runtime.close();
  }
});

test("runtime adapter client can publish plain text work input", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();
  const client = await ApertureRuntimeAdapterClient.connect({
    baseUrl,
    kind: "custom-agent",
    label: "Neutral ingress",
  });

  try {
    const result = await client.publishWork("Blocked on credentials before continuing.");
    assert.equal(result.accepted, 1);
    assert.equal(result.mode, "text");
    assert.equal(result.tips?.some((tip) => tip.includes("structured WorkEvent")), true);

    const [event] = runtime.exportSessionCapture().publishedSourceEvents.slice(-1);
    assert.ok(event);
    assert.equal(event.type, "task.updated");
    assert.equal(event.status, "blocked");
  } finally {
    await client.close();
    await runtime.close();
  }
});

test("runtime work endpoint accepts raw event batches", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        workApprovalEvent("task:batch:one"),
        workApprovalEvent("task:batch:two"),
      ]),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      accepted: number;
      mode: string;
      items: Array<{ taskId: string }>;
    };
    assert.equal(payload.accepted, 2);
    assert.equal(payload.mode, "batch");
    assert.equal(payload.items.length, 2);
  } finally {
    await runtime.close();
  }
});

test("runtime accepts choice request options with summaries", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specVersion: "1.0",
        id: "evt:choice:summary",
        source: "urn:example:custom-agent",
        type: "io.agent.input.requested.v1",
        kind: "input.requested",
        work: {
          id: "task:choice:summary",
          title: "Pick a rollout plan",
        },
        interaction: {
          id: "interaction:choice:summary",
        },
        request: {
          kind: "choice",
          title: "Select rollout plan",
          selectionMode: "single",
          options: [
            {
              id: "canary",
              label: "Canary",
              summary: "Release to a small slice of traffic first.",
            },
          ],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      accepted: number;
      mode: string;
    };
    assert.equal(payload.accepted, 1);
    assert.equal(payload.mode, "event");
  } finally {
    await runtime.close();
  }
});

test("runtime rejects malformed neutral work payloads", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specVersion: "1.0",
        id: "evt:invalid",
        source: "urn:example:custom-agent",
        type: "io.agent.work.updated.v1",
        kind: "work.updated",
        work: {
          id: "task:invalid",
          title: "Missing status",
        },
      }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json() as { error: string };
    assert.match(payload.error, /plain text, one WorkEvent object, or an array of WorkEvent objects/i);
  } finally {
    await runtime.close();
  }
});

test("runtime rejects wrapped work payloads instead of supporting compatibility shells", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl, controlUrl } = await runtime.listen();

  try {
    const wrappedResponse = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: workApprovalEvent("task:wrapped"),
      }),
    });

    assert.equal(wrappedResponse.status, 400);
    const wrappedPayload = await wrappedResponse.json() as { error: string };
    assert.match(wrappedPayload.error, /plain text, one WorkEvent object, or an array of WorkEvent objects/i);

    const controlResponse = await fetch(`${controlUrl}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workApprovalEvent("task:control-surface")),
    });

    assert.equal(controlResponse.status, 404);
  } finally {
    await runtime.close();
  }
});

test("work endpoint explains itself on GET", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { baseUrl } = await runtime.listen();

  try {
    const response = await fetch(`${baseUrl}/work`);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      path: string;
      method: string;
      accepts: Array<{ mode: string }>;
      tips: string[];
    };
    assert.equal(payload.path, "/work");
    assert.equal(payload.method, "POST");
    assert.deepEqual(payload.accepts.map((entry) => entry.mode), ["text", "event", "batch"]);
    assert.equal(payload.tips.some((tip) => tip.includes("input.requested")), true);
  } finally {
    await runtime.close();
  }
});

function workApprovalEvent(taskId: string): WorkEvent {
  return {
    specVersion: "1.0",
    id: `${taskId}:approval`,
    source: "urn:example:custom-agent",
    type: "io.agent.input.requested.v1",
    time: "2026-04-09T14:00:00Z",
    kind: "input.requested",
    work: {
      id: taskId,
      title: "Deploy service",
      summary: "Production deploy is waiting for approval.",
    },
    actor: {
      id: "agent-1",
      kind: "agent",
      label: "Custom Agent",
    },
    interaction: {
      id: `interaction:${taskId}:approval`,
    },
    request: {
      kind: "approval",
      title: "Approve deploy",
      summary: "Approve production deployment.",
    },
    facts: {
      capabilityFamily: "deploy",
      activityCategory: "permission_request",
    },
    hints: {
      consequence: "high",
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
