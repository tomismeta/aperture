import test from "node:test";
import assert from "node:assert/strict";

import { ApertureCore } from "../../core/src/index.js";

import { createClaudeCodeHookServer } from "../src/server.js";

test("holds PreToolUse requests until Aperture responds", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, { holdTimeoutMs: 250 });
  const { url } = await server.listen();

  try {
    const responsePromise = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tool-1",
        tool_input: {
          command: "git push --force origin main",
        },
      }),
    });

    const frame = await waitFor(() => core.getAttentionView().active);
    assert.ok(frame);
    assert.equal(frame?.interactionId, "claude-code:tool:session-1:tool-1");

    core.submit({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-1",
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
  }
});

test("falls back to ask when a held PreToolUse request times out", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, { holdTimeoutMs: 25 });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tool-2",
        tool_input: {
          command: "git push origin main",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    });
    assert.equal(core.getAttentionView().active, null);
  } finally {
    await server.close();
  }
});

test("handles concurrent held PreToolUse requests independently", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, { holdTimeoutMs: 250 });
  const { url } = await server.listen();

  try {
    const responsePromiseOne = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tool-1",
        tool_input: {
          command: "git push --force origin main",
        },
      }),
    });

    const responsePromiseTwo = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tool-2",
        tool_input: {
          command: "git push origin main",
        },
      }),
    });

    const taskView = await waitFor(() => {
      const next = core.getTaskView("claude-code:session:session-1");
      return next.active ? next : null;
    });
    assert.equal(taskView.active?.interactionId, "claude-code:tool:session-1:tool-1");
    assert.deepEqual(
      taskView.queued.map((frame) => frame.interactionId),
      ["claude-code:tool:session-1:tool-2"],
    );

    core.submit({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-1",
      response: { kind: "approved" },
    });

    core.submit({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-2",
      response: { kind: "approved" },
    });

    const [responseOne, responseTwo] = await Promise.all([
      responsePromiseOne,
      responsePromiseTwo,
    ]);

    assert.equal(responseOne.status, 200);
    assert.equal(responseTwo.status, 200);
    assert.deepEqual(await responseOne.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    assert.deepEqual(await responseTwo.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  } finally {
    await server.close();
  }
});

test("publishes PostToolUseFailure events and acknowledges immediately", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core);
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: "tool-3",
        error: "Command exited with code 1",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    const frame = core.getAttentionView().active;
    assert.ok(frame);
    assert.equal(frame?.title, "Bash failed");
  } finally {
    await server.close();
  }
});

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitFor<T>(
  read: () => T | null,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 200;
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
