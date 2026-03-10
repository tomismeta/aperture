import test from "node:test";
import assert from "node:assert/strict";

import {
  bashConsequence,
  mapClaudeCodeFrameResponse,
  mapClaudeCodeHookEvent,
  type ClaudeCodePostToolUseFailureEvent,
  type ClaudeCodePreToolUseEvent,
} from "../src/index.js";

test("maps PreToolUse Bash hooks into approval events", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-1",
    tool_input: {
      command: "git push origin main",
      description: "Network access required",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
    assert.equal(mapped[0].interactionId, "claude-code:tool:session-1:tool-1");
    assert.equal(mapped[0].request.kind, "approval");
    assert.equal(mapped[0].summary, "git push origin main");
    assert.equal(mapped[0].consequence, "medium");
  }
});

test("marks destructive Bash commands as high consequence", () => {
  assert.equal(bashConsequence("rm -rf ./dist"), "high");
  assert.equal(bashConsequence("git push origin main"), "medium");
});

test("ignores unsupported tools by default", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-1",
    tool_input: {},
  };

  assert.deepEqual(mapClaudeCodeHookEvent(event), []);
});

test("maps PostToolUseFailure hooks into failed task updates", () => {
  const event: ClaudeCodePostToolUseFailureEvent = {
    session_id: "session-2",
    cwd: "/repo",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_use_id: "tool-2",
    error: "Command exited with code 1",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-2");
    assert.equal(mapped[0].status, "failed");
    assert.equal(mapped[0].summary, "Command exited with code 1");
  }
});

test("maps approval responses back to Claude Code hook decisions", () => {
  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-1",
      response: { kind: "approved" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-1",
      response: { kind: "rejected", reason: "Too risky" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Too risky",
      },
    },
  );
});

test("maps dismissed approval responses to ask", () => {
  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:tool:session-1:tool-1",
      response: { kind: "dismissed" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    },
  );
});
