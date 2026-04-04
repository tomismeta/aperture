import test from "node:test";
import assert from "node:assert/strict";

import {
  bashConsequence,
  classifyToolRisk,
  mapClaudeCodeAskUserQuestionResponse,
  mapClaudeCodeFrameResponse,
  mapClaudeCodeHookEvent,
  type ClaudeCodeElicitationEvent,
  type ClaudeCodeElicitationResultEvent,
  type ClaudeCodeInstructionsLoadedEvent,
  type ClaudeCodeNotificationEvent,
  type ClaudeCodePostCompactEvent,
  type ClaudeCodePostToolUseFailureEvent,
  type ClaudeCodePreCompactEvent,
  type ClaudeCodePermissionDeniedEvent,
  type ClaudeCodePermissionRequestEvent,
  type ClaudeCodePreToolUseEvent,
  type ClaudeCodeSessionEndEvent,
  type ClaudeCodeSessionStartEvent,
  type ClaudeCodeStopEvent,
  type ClaudeCodeStopFailureEvent,
  type ClaudeCodeSubagentStartEvent,
  type ClaudeCodeSubagentStopEvent,
  type ClaudeCodeTaskCompletedEvent,
  type ClaudeCodeTaskCreatedEvent,
  type ClaudeCodeTeammateIdleEvent,
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
    assert.deepEqual(mapped[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Network access required",
      confidence: "high",
    });
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

test("formats source-native context labels into Aperture-style field labels", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_use_id: "tool-1",
    tool_input: {
      file_path: "/repo/src/index.ts",
      start_line: "1",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.deepEqual(mapped[0].context?.items, [
      { id: "file_path", label: "File Path", value: "/repo/src/index.ts" },
      { id: "start_line", label: "Start Line", value: "1" },
      { id: "cwd", label: "Working Directory", value: "/repo" },
    ]);
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

test("classifies Search as low consequence read work", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Search",
    tool_use_id: "tool-search",
    tool_input: {
      pattern: "agent|Agent|AGENT",
      path: "packages",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(classifyToolRisk(event), "low");
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].toolFamily, "read");
    assert.equal(mapped[0].title, "Claude Code wants to search code for agent|Agent|AGENT");
    assert.equal(mapped[0].summary, "agent|Agent|AGENT in packages");
    assert.equal(mapped[0].riskHint, "low");
  }
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
    assert.deepEqual(mapped[0].semanticHints, {
      activityClass: "tool_completion",
      confidence: "high",
    });
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

test("maps transcript-enriched AskUserQuestion hooks into structured choice requests", () => {
  const event: ClaudeCodePreToolUseEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "tool-ask-1",
    tool_input: {},
    askUserQuestion: {
      questions: [{
        question: "The on-call rotation has a gap next Thursday. Should I auto-assign or send a volunteer request?",
        header: "On-call",
        options: [
          { label: "Auto-assign", description: "Round-robin to the person with fewest recent shifts" },
          { label: "Ask for volunteers", description: "Post in #engineering and wait 24h before auto-assigning" },
          { label: "I'll cover it", description: "Assign the shift to you directly" },
        ],
        multiSelect: false,
      }],
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].activityClass, "question_request");
    assert.equal(mapped[0].title, "The on-call rotation has a gap next Thursday. Should I auto-assign or send a volunteer request?");
    assert.equal(mapped[0].request.kind, "choice");
    assert.deepEqual(mapped[0].semanticHints, {
      intentFrame: "question_request",
      activityClass: "question_request",
      whyNow: "Claude asked for input before continuing.",
      confidence: "high",
    });
    if (mapped[0].request.kind === "choice") {
      assert.deepEqual(
        mapped[0].request.options.map((option) => option.label),
        ["Auto-assign", "Ask for volunteers", "I'll cover it"],
      );
    }
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
      id: "nativeSuggestions",
      label: "Native Suggestions",
      value: "1 native permission suggestion",
    });
  }
});

test("maps Search PermissionRequest hooks into low-risk read approvals", () => {
  const event: ClaudeCodePermissionRequestEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PermissionRequest",
    tool_name: "Search",
    tool_input: {
      pattern: "agent|Agent|AGENT",
      path: "packages",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].toolFamily, "read");
    assert.equal(mapped[0].title, "Claude Code wants permission to search code for agent|Agent|AGENT");
    assert.equal(mapped[0].summary, "agent|Agent|AGENT in packages");
    assert.equal(mapped[0].riskHint, "low");
  }
});

test("maps AskUserQuestion PermissionRequest payloads into more descriptive approval events", () => {
  const event: ClaudeCodePermissionRequestEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PermissionRequest",
    tool_name: "AskUserQuestion",
    tool_input: {},
    askUserQuestion: {
      questions: [{
        question: "What's your preferred language for scripting tasks?",
        header: "Scripting",
        options: [
          { label: "Python" },
          { label: "Bash/zsh" },
          { label: "Node.js" },
        ],
      }],
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type === "human.input.requested") {
    assert.equal(mapped[0].title, "Claude Code wants permission to ask What's your preferred language for scripting tasks?");
    assert.equal(mapped[0].summary, "What's your preferred language for scripting tasks?");
    assert.equal(mapped[0].provenance?.whyNow, "Claude needs permission before asking the operator a question.");
    assert.deepEqual(mapped[0].context?.items?.at(0), {
      id: "header",
      label: "Header",
      value: "Scripting",
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
    assert.equal(mapped[0].request.kind, "choice");
    assert.deepEqual(mapped[0].semanticHints, {
      intentFrame: "question_request",
      activityClass: "question_request",
      whyNow: "Claude is waiting for input from build-server.",
      confidence: "high",
    });
    assert.deepEqual(mapped[0].context?.items?.at(0), {
      id: "serverName",
      label: "Server",
      value: "build-server",
    });
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

test("maps session start hooks into session lifecycle events", () => {
  const event: ClaudeCodeSessionStartEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SessionStart",
    source: "resume",
    model: "claude-sonnet-4-6",
    agent_type: "reviewer",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.started");
  if (mapped[0]?.type === "task.started") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
    assert.equal(mapped[0].title, "Claude Code session resumed");
    assert.match(mapped[0].summary ?? "", /claude-sonnet-4-6/);
    assert.deepEqual(mapped[0].semanticHints, {
      activityClass: "session_status",
      whyNow: "Claude resumed an existing session.",
      confidence: "high",
    });
  }
});

test("maps instructions loaded hooks into session-status updates", () => {
  const event: ClaudeCodeInstructionsLoadedEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "InstructionsLoaded",
    file_path: "/repo/CLAUDE.md",
    memory_type: "Project",
    load_reason: "session_start",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
    assert.equal(mapped[0].title, "Claude loaded project instructions");
    assert.equal(mapped[0].summary, "CLAUDE.md · reason session start");
    assert.equal(mapped[0].status, "running");
    assert.deepEqual(mapped[0].semanticHints, {
      activityClass: "session_status",
      whyNow: "Claude loaded instructions while starting the session.",
      confidence: "high",
    });
  }
});

test("maps permission denied hooks into blocked status updates", () => {
  const event: ClaudeCodePermissionDeniedEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PermissionDenied",
    tool_name: "Bash",
    tool_input: {
      command: "git push origin main",
    },
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].status, "blocked");
    assert.equal(mapped[0].toolFamily, "bash");
    assert.equal(mapped[0].activityClass, "permission_request");
    assert.equal(mapped[0].title, "Claude Code auto mode denied permission to run a shell command");
    assert.equal(mapped[0].summary, "git push origin main");
  }
});

test("maps subagent start hooks into task lifecycle events", () => {
  const event: ClaudeCodeSubagentStartEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SubagentStart",
    agent_id: "agent-123",
    agent_type: "Explore",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.started");
  if (mapped[0]?.type === "task.started") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1:subagent:agent-123");
    assert.equal(mapped[0].title, "Claude started Explore subagent");
  }
});

test("maps subagent stop hooks into task completion events", () => {
  const event: ClaudeCodeSubagentStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SubagentStop",
    agent_id: "agent-123",
    agent_type: "Explore",
    last_assistant_message: "Analysis complete. Found three issues.\n\nExtra details...",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.completed");
  if (mapped[0]?.type === "task.completed") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1:subagent:agent-123");
    assert.equal(mapped[0].summary, "Explore subagent finished: Analysis complete. Found three issues.");
  }
});

test("suppresses subagent stop events while a native subagent stop hook is active", () => {
  const event: ClaudeCodeSubagentStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SubagentStop",
    stop_hook_now: true,
    agent_id: "agent-123",
    agent_type: "Explore",
  };

  assert.deepEqual(mapClaudeCodeHookEvent(event), []);
});

test("maps task created hooks into teammate task lifecycle events", () => {
  const event: ClaudeCodeTaskCreatedEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "TaskCreated",
    task_id: "task-001",
    task_subject: "Implement user authentication",
    task_description: "Add login and signup endpoints",
    teammate_name: "implementer",
    team_name: "my-project",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.started");
  if (mapped[0]?.type === "task.started") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1:task:task-001");
    assert.equal(mapped[0].title, "Implement user authentication");
    assert.match(mapped[0].summary ?? "", /Add login and signup endpoints/);
  }
});

test("maps task completed hooks into teammate task completion events", () => {
  const event: ClaudeCodeTaskCompletedEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "TaskCompleted",
    task_id: "task-001",
    task_subject: "Implement user authentication",
    teammate_name: "implementer",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.completed");
  if (mapped[0]?.type === "task.completed") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1:task:task-001");
    assert.match(mapped[0].summary ?? "", /Task completed: Implement user authentication/);
  }
});

test("maps stop failure hooks into failed session status", () => {
  const event: ClaudeCodeStopFailureEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "StopFailure",
    error: "rate_limit",
    error_details: "429 Too Many Requests",
    last_assistant_message: "API Error: Rate limit reached",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].status, "failed");
    assert.equal(mapped[0].activityClass, "session_status");
    assert.equal(mapped[0].title, "Claude hit an API error");
    assert.equal(mapped[0].summary, "API Error: Rate limit reached");
  }
});

test("maps teammate idle hooks into waiting session status", () => {
  const event: ClaudeCodeTeammateIdleEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "TeammateIdle",
    teammate_name: "researcher",
    team_name: "my-project",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].status, "waiting");
    assert.equal(mapped[0].title, "researcher teammate is idle");
    assert.equal(mapped[0].summary, "researcher teammate in team my-project is waiting for more work.");
  }
});

test("maps pre-compact hooks into running session status", () => {
  const event: ClaudeCodePreCompactEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreCompact",
    trigger: "manual",
    custom_instructions: "Keep the deployment notes.",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].title, "Claude is compacting the session");
    assert.equal(mapped[0].summary, "Manual compaction instructions: Keep the deployment notes.");
    assert.equal(mapped[0].status, "running");
  }
});

test("maps post-compact hooks into running session status", () => {
  const event: ClaudeCodePostCompactEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PostCompact",
    trigger: "auto",
    compact_summary: "Reduced the conversation to the current migration plan.\nMore details...",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].title, "Claude auto-compacted the session");
    assert.equal(mapped[0].summary, "Reduced the conversation to the current migration plan.");
    assert.equal(mapped[0].status, "running");
  }
});

test("maps session end hooks into task completion events", () => {
  const event: ClaudeCodeSessionEndEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SessionEnd",
    reason: "logout",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.completed");
  if (mapped[0]?.type === "task.completed") {
    assert.equal(mapped[0].taskId, "claude-code:session:session-1");
    assert.equal(mapped[0].summary, "Claude Code session ended after logout.");
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
    assert.deepEqual(mapped[0].semanticHints, {
      intentFrame: "question_request",
      activityClass: "follow_up",
      whyNow: "Claude asked a follow-up question and is waiting for a reply.",
      confidence: "high",
    });
  }
});

test("treats parenthetical stop question endings as follow-up questions", () => {
  const event: ClaudeCodeStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Stop",
    stop_reason: "end_turn",
    last_assistant_message: "Got it — a custom workflow. What does it look like? (What triggers it, and what should happen?)",
  };

  const mapped = mapClaudeCodeHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type === "task.updated") {
    assert.equal(mapped[0].activityClass, "follow_up");
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

test("suppresses stop events while Claude's native stop hook is active", () => {
  const event: ClaudeCodeStopEvent = {
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "Stop",
    stop_hook_now: true,
    stop_reason: "end_turn",
    last_assistant_message: "I summarized the results above.",
  };

  assert.deepEqual(mapClaudeCodeHookEvent(event), []);
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

test("maps AskUserQuestion responses into deny-plus-context PreToolUse decisions", () => {
  assert.deepEqual(
    mapClaudeCodeAskUserQuestionResponse(
      {
        taskId: "claude-code:session:session-1",
        interactionId: "claude-code:tool:session-1:tool-ask-1",
        response: { kind: "option_selected", optionIds: ["q0:o1:Ask%20for%20volunteers"] },
      },
      {
        questions: [{
          question: "The on-call rotation has a gap next Thursday. Should I auto-assign or send a volunteer request?",
          header: "On-call",
          options: [
            { label: "Auto-assign" },
            { label: "Ask for volunteers" },
            { label: "I'll cover it" },
          ],
        }],
      },
    ),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Aperture already captured the user's answer.",
        additionalContext: "The user already answered this AskUserQuestion in Aperture. Do not ask again. Treat these answers as authoritative: \"The on-call rotation has a gap next Thursday. Should I auto-assign or send a volunteer request?\"=\"Ask for volunteers\". Continue from them directly.",
      },
    },
  );
});

test("preserves multi-select AskUserQuestion options through form submission", () => {
  const mapped = mapClaudeCodeHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "tool-ask-multi",
    tool_input: {},
    askUserQuestion: {
      questions: [
        {
          question: "Which languages should I prepare examples for?",
          options: [
            { label: "Python" },
            { label: "Node.js" },
            { label: "Bash/zsh" },
          ],
          multiSelect: true,
        },
        {
          question: "Anything else to note?",
          options: [],
        },
      ],
    },
  });

  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested" || mapped[0].request.kind !== "form") {
    return;
  }

  assert.deepEqual(
    mapped[0].request.fields.map((field) => ({ id: field.id, type: field.type })),
    [
      { id: "q0:o0", type: "boolean" },
      { id: "q0:o1", type: "boolean" },
      { id: "q0:o2", type: "boolean" },
      { id: "q1", type: "text" },
    ],
  );

  assert.deepEqual(
    mapClaudeCodeAskUserQuestionResponse(
      {
        taskId: "claude-code:session:session-1",
        interactionId: "claude-code:tool:session-1:tool-ask-multi",
        response: {
          kind: "form_submitted",
          values: {
            "q0:o0": true,
            "q0:o2": "true",
            q1: "Need shell snippets too.",
          },
        },
      },
      {
        questions: [
          {
            question: "Which languages should I prepare examples for?",
            options: [
              { label: "Python" },
              { label: "Node.js" },
              { label: "Bash/zsh" },
            ],
            multiSelect: true,
          },
          {
            question: "Anything else to note?",
            options: [],
          },
        ],
      },
    ),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Aperture already captured the user's answer.",
        additionalContext:
          "The user already answered this AskUserQuestion in Aperture. Do not ask again. Treat these answers as authoritative: \"Which languages should I prepare examples for?\"=\"Python, Bash/zsh\", \"Anything else to note?\"=\"Need shell snippets too.\". Continue from them directly.",
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
