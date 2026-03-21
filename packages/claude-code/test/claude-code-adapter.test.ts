import test from "node:test";
import assert from "node:assert/strict";

import {
  bashConsequence,
  classifyToolRisk,
  mapClaudeCodeFrameResponse,
  mapClaudeCodeHookEvent,
  type ClaudeCodeElicitationEvent,
  type ClaudeCodeElicitationResultEvent,
  type ClaudeCodeNotificationEvent,
  type ClaudeCodePostToolUseFailureEvent,
  type ClaudeCodePermissionRequestEvent,
  type ClaudeCodePreToolUseEvent,
  type ClaudeCodeStopEvent,
  type ClaudeCodeUserPromptSubmitEvent,
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
    assert.equal(mapped[0].toolFamily, "bash");
    assert.equal(mapped[0].activityClass, "permission_request");
    assert.equal(mapped[0].request.kind, "approval");
    assert.equal(mapped[0].title, "Claude Code wants to run a shell command");
    assert.equal(mapped[0].summary, "git push origin main");
    assert.equal(mapped[0].riskHint, "medium");
    assert.deepEqual(mapped[0].source, {
      id: "claude-code:session-1",
      kind: "claude-code",
      label: "Claude Code repo #session1",
    });
  }
});

test("uses compact detail labels for bash approvals", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-1",
    tool_input: {
      command: "find /Users/tom/dev/aperture -type d -name \"packages\" -o -type d -name \"docs\" | head -10",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].title, "Claude Code wants to run a shell command");
  }
});

test("marks destructive Bash commands as high consequence", () => {
  assert.equal(bashConsequence("rm -rf ./dist"), "high");
  assert.equal(bashConsequence("git push origin main"), "medium");
});

test("accepts all tools by default", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-1",
    tool_input: {},
  };

  assert.equal(mapClaudeCodeHookEvent(event).length, 1);
});

test("filters tools when explicit list is provided", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-1",
    tool_input: {},
  };

  assert.deepEqual(mapClaudeCodeHookEvent(event, { tools: ["Bash"] }), []);
});

test("labels Claude Code instances with workspace and short session id", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "8b4d2f66-89e1-4a55-b978-ff11aa22bb33",
    cwd: "/Users/tom/dev/project-alpha",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-1",
    tool_input: {
      file_path: "/Users/tom/dev/project-alpha/src/index.ts",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.source?.label, "Claude Code project-alpha #8b4d2f");
});

test("classifies read and web tools as low consequence", () => {
  const readEvent: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-read",
    tool_input: {
      file_path: "/repo/src/index.ts",
    },
  };
  const webEvent: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "WebSearch",
    tool_use_id: "tool-web",
    tool_input: {
      query: "latest terminal UI patterns",
    },
  };

  assert.equal(classifyToolRisk(readEvent), "low");
  assert.equal(classifyToolRisk(webEvent), "low");
});

test("classifies writes by path sensitivity", () => {
  const ordinaryWrite: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_use_id: "tool-write",
    tool_input: {
      file_path: "/repo/src/index.ts",
    },
  };
  const sensitiveWrite: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_use_id: "tool-edit",
    tool_input: {
      file_path: "/repo/.github/workflows/deploy.yml",
    },
  };

  assert.equal(classifyToolRisk(ordinaryWrite), "medium");
  assert.equal(classifyToolRisk(sensitiveWrite), "high");
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
    assert.equal(mapped[0].toolFamily, "bash");
    assert.equal(mapped[0].activityClass, "tool_failure");
    assert.equal(mapped[0].status, "failed");
    assert.equal(mapped[0].summary, "Command exited with code 1");
  }
});

test("maps low-risk reads into low consequence approvals", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-read",
    tool_input: {
      file_path: "/repo/src/index.ts",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].toolFamily, "read");
    assert.equal(mapped[0].activityClass, "permission_request");
    assert.equal(mapped[0].title, "Claude Code wants to read index.ts");
    assert.equal(mapped[0].riskHint, "low");
  }
});

test("maps PostToolUse updates with explicit tool family", () => {
  const mapped = mapClaudeCodeHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_use_id: "tool-read",
    tool_response: {
      message: "Read completed successfully.",
    },
  }, { includePostToolUse: true });

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].toolFamily, "read");
    assert.equal(mapped[0].activityClass, "tool_completion");
    assert.equal(mapped[0].status, "running");
    assert.equal(mapped[0].title, "Read completed");
  }
});

test("uses compact detail labels for glob approvals", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Glob",
    tool_use_id: "tool-glob",
    tool_input: {
      pattern: "**/*.{ts,tsx,md}",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].title, "Claude Code wants to search files with **/*.{ts,tsx,md}");
  }
});

test("maps ToolSearch into low-risk web search wording", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "ToolSearch",
    tool_use_id: "tool-search",
    tool_input: {
      query: "gold prices",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].title, "Claude Code wants to search the web for gold prices");
    assert.equal(mapped[0].riskHint, "low");
  }
});

test("maps PermissionRequest hooks into approval events", () => {
  const event: ClaudeCodePermissionRequestEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: {
      command: "rm -rf ./dist",
      description: "Clear the build output before packaging.",
    },
    permission_suggestions: [
      {
        type: "addRules",
        behavior: "allow",
        destination: "session",
      },
    ],
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
    assert.match(
      mapped[0].interactionId,
      /^claude-code:permission:session-1:[a-f0-9]{12}$/,
    );
    assert.equal(mapped[0].toolFamily, "bash");
    assert.equal(mapped[0].activityClass, "permission_request");
    assert.equal(mapped[0].request.kind, "approval");
    assert.equal(mapped[0].title, "Claude Code wants permission to run a shell command");
    assert.equal(mapped[0].summary, "rm -rf ./dist");
    assert.equal(mapped[0].riskHint, "high");
    assert.equal(mapped[0].provenance?.whyNow, "Clear the build output before packaging.");
    assert.deepEqual(mapped[0].context?.items?.at(-1), {
      id: "permission_suggestions",
      label: "Claude suggestions",
      value: "1 native permission suggestion",
    });
  }
});

test("maps elicitation enum schemas into choice requests", () => {
  const event: ClaudeCodeElicitationEvent = {
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
          title: "Suite",
          enum: ["Full suite", "Core only", "Skip tests"],
        },
      },
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].title, event.message);
    assert.equal(mapped[0].summary, "Input requested by build-server.");
    assert.equal(mapped[0].toolFamily, "mcp");
    assert.equal(mapped[0].request.kind, "choice");
    if (mapped[0].request.kind === "choice") {
      assert.equal(mapped[0].request.selectionMode, "single");
      assert.deepEqual(
        mapped[0].request.options.map((option) => option.label),
        ["Full suite", "Core only", "Skip tests"],
      );
    }
    assert.equal(
      mapped[0].interactionId,
      "claude-code:elicitation:session-1:build-server:elicit-1",
    );
  }
});

test("maps single text elicitation schemas into reply requests", () => {
  const event: ClaudeCodeElicitationEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Elicitation",
    mcp_server_name: "auth-server",
    elicitation_id: "elicit-2",
    message: "What username should I use?",
    mode: "form",
    requested_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          title: "Username",
        },
      },
      required: ["username"],
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].request.kind, "choice");
    if (mapped[0].request.kind === "choice") {
      assert.equal(mapped[0].request.allowTextResponse, true);
      assert.deepEqual(mapped[0].request.options, []);
    }
    assert.equal(
      mapped[0].interactionId,
      "claude-code:elicitation:session-1:auth-server:elicit-2:username",
    );
  }
});

test("maps multi-field elicitation schemas into form requests", () => {
  const event: ClaudeCodeElicitationEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Elicitation",
    mcp_server_name: "deploy-server",
    elicitation_id: "elicit-3",
    message: "Provide deploy parameters.",
    mode: "form",
    requested_schema: {
      type: "object",
      required: ["environment", "rollback"],
      properties: {
        environment: {
          type: "string",
          title: "Environment",
          enum: ["staging", "production"],
        },
        rollback: {
          type: "boolean",
          title: "Rollback",
        },
        timeout: {
          type: "number",
          title: "Timeout seconds",
        },
      },
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].request.kind, "form");
    if (mapped[0].request.kind === "form") {
      assert.deepEqual(
        mapped[0].request.fields.map((field) => ({
          id: field.id,
          type: field.type,
          required: field.required ?? false,
        })),
        [
          { id: "environment", type: "select", required: true },
          { id: "rollback", type: "boolean", required: true },
          { id: "timeout", type: "number", required: false },
        ],
      );
    }
  }
});

test("maps url elicitation into approval with auth context", () => {
  const event: ClaudeCodeElicitationEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Elicitation",
    mcp_server_name: "auth-server",
    elicitation_id: "elicit-4",
    message: "Please authenticate",
    mode: "url",
    url: "https://auth.example.com/login",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].request.kind, "approval");
    assert.equal(mapped[0].summary, "Open https://auth.example.com/login to continue.");
    assert.deepEqual(mapped[0].context?.items?.at(-1), {
      id: "url",
      label: "URL",
      value: "https://auth.example.com/login",
    });
  }
});

test("maps elicitation result into task completion", () => {
  const event: ClaudeCodeElicitationResultEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "ElicitationResult",
    mcp_server_name: "build-server",
    elicitation_id: "elicit-1",
    action: "accept",
    mode: "form",
    content: { suite: "Full suite" },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.completed");
  if (mapped[0]?.type === "task.completed") {
    assert.match(mapped[0].summary ?? "", /accept/);
  }
});

test("maps idle notifications into waiting status updates", () => {
  const event: ClaudeCodeNotificationEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    title: "Waiting on you",
    message: "Claude is waiting for your input.",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].status, "blocked");
    assert.equal(mapped[0].title, "Claude is waiting for input");
    assert.equal(mapped[0].summary, "Waiting on you: Claude is waiting for your input.");
  }
});

test("maps user prompt submit into task completion to clear waiting state", () => {
  const event: ClaudeCodeUserPromptSubmitEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "UserPromptSubmit",
    prompt: "The site is actively maintained.",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.completed");
  if (mapped[0]?.type === "task.completed") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
  }
});

test("maps stop events with follow-up questions into waiting status", () => {
  const event: ClaudeCodeStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Stop",
    stop_reason: "end_turn",
    last_assistant_message: "Is there a specific story you'd like me to dig deeper into?",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].activityClass, "follow_up");
    assert.equal(mapped[0].status, "blocked");
    assert.equal(mapped[0].title, "Claude is waiting for follow-up");
  }
});

test("maps plain stop events into ambient completion status", () => {
  const event: ClaudeCodeStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Stop",
    stop_reason: "end_turn",
    last_assistant_message: "I summarized the results above.",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].activityClass, "status_update");
    assert.equal(mapped[0].status, "running");
    assert.equal(mapped[0].title, "Claude completed a turn");
  }
});

test("maps stop events without assistant text into generic completion awareness", () => {
  const event: ClaudeCodeStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Stop",
    stop_reason: "end_turn",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].activityClass, "status_update");
    assert.equal(mapped[0].status, "running");
    assert.equal(mapped[0].summary, "Claude finished responding.");
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

test("maps permission responses back to Claude hook decisions", () => {
  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:permission:session-1:abc123def456",
      response: { kind: "approved" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
        },
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:permission:session-1:abc123def456",
      response: { kind: "rejected", reason: "Outside allowed working directories." },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "Outside allowed working directories.",
        },
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:permission:session-1:abc123def456",
      response: { kind: "dismissed" },
    }),
    {},
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

test("maps elicitation responses back to Claude hook decisions", () => {
  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:elicitation:session-1:build-server:elicit-1",
      response: { kind: "option_selected", optionIds: ["suite=Full%20suite"] },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: {
          suite: "Full suite",
        },
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:elicitation:session-1:auth-server:elicit-2:username",
      response: { kind: "text_submitted", text: "alice" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: {
          username: "alice",
        },
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:elicitation:session-1:deploy-server:elicit-3",
      response: { kind: "form_submitted", values: { environment: "staging", rollback: false } },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: {
          environment: "staging",
          rollback: false,
        },
      },
    },
  );

  assert.deepEqual(
    mapClaudeCodeFrameResponse({
      taskId: "claude-code:session:session-1",
      interactionId: "claude-code:elicitation:session-1:auth-server:elicit-4",
      response: { kind: "dismissed" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "cancel",
      },
    },
  );
});
