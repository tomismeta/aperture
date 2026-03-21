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

test("returns allow immediately when policy auto-approves a held read request", async () => {
  const core = new ApertureCore({
    judgmentConfig: {
      version: 1,
      updatedAt: "2026-03-13T12:00:00.000Z",
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    },
  });
  const server = createClaudeCodeHookServer(core, { holdTimeoutMs: 250 });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: "tool-read-1",
        tool_input: {
          file_path: "/repo/src/index.ts",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    assert.equal(core.getAttentionView().active, null);
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

test("publishes idle notifications as waiting status", async () => {
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
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
        title: "Waiting on you",
        message: "Claude is waiting for your input.",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    const frame = core.getAttentionView().active;
    assert.ok(frame);
    assert.equal(frame?.title, "Claude is waiting for input");
    assert.equal(frame?.source?.label, "Claude Code repo #session1");
  } finally {
    await server.close();
  }
});

test("holds elicitation requests until Aperture responds", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, {
    holdTimeoutMs: 250,
    elicitationPolicy: () => "hold",
  });
  const { url } = await server.listen();

  try {
    const responsePromise = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "Elicitation",
        mcp_server_name: "build-server",
        elicitation_id: "elicit-1",
        message: "Should I run the full test suite before merging this branch?",
        mode: "form",
        requested_schema: {
          type: "object",
          properties: {
            suite: {
              type: "string",
              enum: ["Full suite", "Core only", "Skip tests"],
            },
          },
        },
      }),
    });

    const frame = await waitFor(() => core.getAttentionView().active);
    assert.ok(frame);
    assert.equal(frame?.title, "Should I run the full test suite before merging this branch?");

    core.submit({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:elicitation:session-1:build-server:elicit-1",
      response: { kind: "option_selected", optionIds: ["suite=Core%20only"] },
    });

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: {
          suite: "Core only",
        },
      },
    });
  } finally {
    await server.close();
  }
});

test("lets Claude handle elicitation natively when no surface policy is active", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, {
    elicitationPolicy: () => "native",
  });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "Elicitation",
        mcp_server_name: "build-server",
        elicitation_id: "elicit-2",
        message: "Which suite should I run?",
        mode: "form",
        requested_schema: {
          type: "object",
          properties: {
            suite: {
              type: "string",
              enum: ["Full suite", "Core only"],
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    assert.equal(core.getAttentionView().active, null);
  } finally {
    await server.close();
  }
});

test("times out held elicitation requests back to Claude and clears the frame", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, {
    holdTimeoutMs: 25,
    elicitationPolicy: () => "hold",
  });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "Elicitation",
        mcp_server_name: "build-server",
        elicitation_id: "elicit-3",
        message: "Which suite should I run?",
        mode: "form",
        requested_schema: {
          type: "object",
          properties: {
            suite: {
              type: "string",
              enum: ["Full suite", "Core only"],
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    await sleep(10);
    assert.equal(core.getAttentionView().active, null);
  } finally {
    await server.close();
  }
});

test("user prompt submit clears a waiting notification frame", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core);
  const { url } = await server.listen();

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
        message: "Claude is waiting for your input.",
      }),
    });

    const active = await waitFor(() => core.getAttentionView().active);
    assert.ok(active);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "UserPromptSubmit",
        prompt: "The site is actively maintained.",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    assert.equal(core.getAttentionView().active, null);
  } finally {
    await server.close();
  }
});

test("publishes stop events with follow-up questions as waiting status", async () => {
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
        hook_event_name: "Stop",
        stop_reason: "end_turn",
        last_assistant_message: "Is there a specific story you'd like me to dig deeper into?",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    const frame = core.getAttentionView().active;
    assert.ok(frame);
    assert.equal(frame?.title, "Claude is waiting for follow-up");
  } finally {
    await server.close();
  }
});

test("publishes plain stop events as ambient completion awareness", async () => {
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
        hook_event_name: "Stop",
        stop_reason: "end_turn",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    assert.equal(core.getAttentionView().active, null);
    assert.equal(core.getAttentionView().ambient[0]?.title, "Claude completed a turn");
  } finally {
    await server.close();
  }
});

test("publishes PostToolUse completion updates as ambient awareness when enabled", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, { includePostToolUse: true });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: "tool-read-1",
        tool_input: {
          file_path: "/repo/src/index.ts",
        },
        tool_response: {
          message: "Read completed successfully.",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    assert.equal(core.getAttentionView().active, null);
    assert.equal(core.getAttentionView().ambient[0]?.title, "Read completed");
  } finally {
    await server.close();
  }
});

test("PostToolUse completion can demote a prior waiting frame into ambient awareness", async () => {
  const core = new ApertureCore();
  const server = createClaudeCodeHookServer(core, { includePostToolUse: true });
  const { url } = await server.listen();

  try {
    const waitingResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
        title: "Waiting on you",
        message: "Claude is waiting for your input.",
      }),
    });

    assert.equal(waitingResponse.status, 200);
    assert.equal(core.getAttentionView().active?.title, "Claude is waiting for input");

    const completionResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: "tool-read-2",
        tool_input: {
          file_path: "/repo/src/index.ts",
        },
        tool_response: {
          message: "Read completed successfully.",
        },
      }),
    });

    assert.equal(completionResponse.status, 200);
    assert.deepEqual(await completionResponse.json(), {});
    assert.equal(core.getAttentionView().active, null);
    assert.equal(core.getAttentionView().ambient[0]?.title, "Read completed");
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
