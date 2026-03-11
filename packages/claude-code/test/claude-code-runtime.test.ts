import test from "node:test";
import assert from "node:assert/strict";

import { createApertureRuntime } from "../../runtime/src/index.js";

import type { ClaudeCodePreToolUseEvent } from "../src/index.js";
import { createClaudeCodeHookServer } from "../src/server.js";

test("returns ask immediately when no surface is attached", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const runtimeBinding = await runtime.listen();
  const server = createClaudeCodeHookServer(runtime.getCore(), {
    holdTimeoutMs: 250,
    port: 0,
    preToolUsePolicy: () => (runtime.hasAttachedSurface() ? "hold" : "ask"),
  });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preToolUse("tool-1")),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    });
    assert.equal(runtime.getCore().getAttentionView().active, null);
    assert.match(runtimeBinding.controlUrl, /\/runtime$/);
  } finally {
    await server.close();
    await runtime.close();
  }
});

test("holds approvals when a surface is attached", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const server = createClaudeCodeHookServer(runtime.getCore(), {
    holdTimeoutMs: 250,
    port: 0,
    preToolUsePolicy: () => (runtime.hasAttachedSurface() ? "hold" : "ask"),
  });
  const { url } = await server.listen();

  try {
    const attach = await fetch(`${controlUrl}/surfaces/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-surface" }),
    });
    assert.equal(attach.status, 200);

    const responsePromise = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preToolUse("tool-2")),
    });

    const frame = await waitFor(() => runtime.getCore().getAttentionView().active);
    assert.ok(frame);
    assert.equal(frame?.title, "Approve Bash");

    runtime.getCore().submit({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-2",
      response: { kind: "approved" },
    });

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  } finally {
    await server.close();
    await runtime.close();
  }
});

test("publishes an ambient fallback note when a held approval times out", async () => {
  const runtime = createApertureRuntime({ controlPort: 0 });
  const { controlUrl } = await runtime.listen();
  const server = createClaudeCodeHookServer(runtime.getCore(), {
    holdTimeoutMs: 25,
    port: 0,
    preToolUsePolicy: () => (runtime.hasAttachedSurface() ? "hold" : "ask"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        runtime.getCore().publishConformed(fallbackEvent(event, reason));
      }
    },
  });
  const { url } = await server.listen();

  try {
    const attach = await fetch(`${controlUrl}/surfaces/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-surface" }),
    });
    assert.equal(attach.status, 200);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preToolUse("tool-3")),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    });

    const ambient = await waitFor(() => runtime.getCore().getAttentionView().ambient[0] ?? null);
    assert.equal(ambient?.title, "Bash approval timed out");
  } finally {
    await server.close();
    await runtime.close();
  }
});

function preToolUse(toolUseId: string): ClaudeCodePreToolUseEvent {
  return {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: toolUseId,
    tool_input: {
      command: "git push origin main",
    },
  };
}

function fallbackEvent(
  event: ClaudeCodePreToolUseEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:PreToolUse:${encodeURIComponent(
      event.tool_use_id,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: {
      id: `claude-code:${event.session_id}`,
      kind: "claude-code" as const,
      label: "Claude Code repo #session1",
    },
    title:
      reason === "timed_out"
        ? `${event.tool_name} approval timed out`
        : `${event.tool_name} approval returned to Claude`,
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a response in time and returned this approval to Claude Code."
        : "Aperture did not retain this approval frame, so Claude Code handled it natively.",
    status: "running" as const,
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
