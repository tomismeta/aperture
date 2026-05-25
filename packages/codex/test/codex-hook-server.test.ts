import assert from "node:assert/strict";
import test from "node:test";

import { ApertureCore } from "@tomismeta/aperture-core";

import { createCodexHookServer } from "../src/index.js";

test("holds Codex PreToolUse hooks until Aperture responds", async () => {
  const core = new ApertureCore();
  const server = createCodexHookServer(core, {
    holdTimeoutMs: 250,
    preToolUsePolicy: () => "hold",
  });
  const { url } = await server.listen();
  let responsePromise: Promise<Response> | undefined;

  try {
    responsePromise = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_use_id: "tool-1",
        tool_input: {
          command: "git push --force origin main",
        },
      }),
    });

    const frame = await waitFor(() => core.getAttentionView().now);
    assert.ok(frame);
    assert.equal(frame?.interactionId, "codex:hook:preToolUse:session-1:turn-1:tool-1");

    core.submit({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: "codex:hook:preToolUse:session-1:turn-1:tool-1",
      response: { kind: "rejected", reason: "Too risky." },
    });

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Too risky.",
      },
    });
  } finally {
    await server.close();
    await settle(responsePromise);
  }
});

test("fails closed when a held Codex PreToolUse hook times out", async () => {
  const core = new ApertureCore();
  const server = createCodexHookServer(core, {
    holdTimeoutMs: 25,
    preToolUsePolicy: () => "hold",
  });
  const { url } = await server.listen();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        turn_id: "turn-1",
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
        permissionDecision: "deny",
        permissionDecisionReason: "Codex command approval timed out in Aperture.",
      },
    });
    assert.equal(core.getAttentionView().now, null);
  } finally {
    await server.close();
  }
});

test("holds Codex PermissionRequest hooks until Aperture responds", async () => {
  const core = new ApertureCore();
  const server = createCodexHookServer(core, {
    holdTimeoutMs: 250,
    permissionRequestPolicy: () => "hold",
  });
  const { url } = await server.listen();
  let responsePromise: Promise<Response> | undefined;

  try {
    responsePromise = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-1",
        cwd: "/repo",
        hook_event_name: "PermissionRequest",
        turn_id: "turn-1",
        tool_name: "mcp__github__create_issue",
        tool_input: {
          description: "Create a tracking issue",
        },
      }),
    });

    const frame = await waitFor(() => core.getAttentionView().now);
    assert.ok(frame);
    assert.match(frame?.interactionId ?? "", /^codex:hook:permissionRequest:/);

    core.submit({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: frame.interactionId,
      response: { kind: "approved" },
    });

    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
        },
      },
    });
  } finally {
    await server.close();
    await settle(responsePromise);
  }
});

async function waitFor<T>(
  read: () => T | null | undefined,
  timeoutMs = 2_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = read();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

async function settle(responsePromise: Promise<Response> | undefined): Promise<void> {
  if (!responsePromise) {
    return;
  }

  try {
    const response = await responsePromise;
    await response.arrayBuffer();
  } catch {
    // best effort cleanup for test teardown
  }
}
