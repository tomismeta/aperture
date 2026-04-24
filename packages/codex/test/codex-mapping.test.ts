import test from "node:test";
import assert from "node:assert/strict";

import type { AttentionResponse } from "@tomismeta/aperture-core";

import {
  mapCodexNotification,
  mapCodexResponse,
  mapCodexServerRequest,
  parseCodexInteractionId,
  type CodexServerRequest,
} from "../src/index.js";

test("maps command execution approvals into approval SourceEvents", () => {
  const request: CodexServerRequest = {
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item:cmd:1",
      command: "pnpm test",
      cwd: "/repo",
      reason: "Run tests before continuing",
      availableDecisions: ["accept", "decline", "cancel"],
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.equal(mapped.events[0].toolFamily, "bash");
    assert.equal(mapped.events[0].taskId, "codex:thread:thread-1:turn:turn-1");
    assert.deepEqual(mapped.events[0].metadata, {
      execution: {
        runner: "codex",
      },
      governance: {
        approvalState: "pending",
      },
    });
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Run tests before continuing",
      confidence: "high",
    });
    assert.deepEqual(mapped.events[0].context?.items, [
      { id: "command", label: "Command", value: "pnpm test" },
      { id: "cwd", label: "Working Directory", value: "/repo" },
      { id: "reason", label: "Reason", value: "Run tests before continuing" },
    ]);
  }
});

test("maps thread start notifications with host execution metadata", () => {
  const mapped = mapCodexNotification({
    method: "thread/started",
    params: {
      thread: {
        id: "thread-surface-1",
        preview: "Review the deploy plan",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1,
        updatedAt: 1,
        status: { type: "active", activeFlags: [] },
        path: null,
        cwd: "/repo",
        cliVersion: "1.0.0",
        source: "cli",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: "Deploy plan",
        turns: [],
      },
    },
  });

  assert.equal(mapped[0]?.type, "task.started");
  assert.deepEqual(mapped[0]?.metadata, {
    execution: {
      runner: "codex",
      surface: "terminal",
    },
  });
});

test("maps file change approvals into write approval SourceEvents", () => {
  const request: CodexServerRequest = {
    id: "req-file",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-2",
      itemId: "item:file:1",
      reason: "Apply patch",
      grantRoot: "/repo/src",
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].toolFamily, "write");
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Apply patch",
      confidence: "high",
    });
    assert.deepEqual(mapped.events[0].context?.items, [
      { id: "rootPath", label: "Root Path", value: "/repo/src" },
    ]);
  }
});

test("maps top-level exec command approvals into approval SourceEvents", () => {
  const request: CodexServerRequest = {
    id: "req-exec",
    method: "execCommandApproval",
    params: {
      conversationId: "thread-legacy",
      callId: "call-1",
      approvalId: "approval-1",
      command: ["mkdir", "codex-smoke-test"],
      cwd: "/repo",
      reason: "Create requested directory",
      parsedCmd: [],
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped?.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].toolFamily, "bash");
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.equal(mapped.events[0].taskId, "codex:thread:thread-legacy");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Create requested directory",
      confidence: "high",
    });
    assert.deepEqual(mapped.events[0].context?.items, [
      { id: "command", label: "Command", value: "mkdir codex-smoke-test" },
      { id: "cwd", label: "Working Directory", value: "/repo" },
      { id: "reason", label: "Reason", value: "Create requested directory" },
    ]);
  }
});

test("maps top-level apply patch approvals into write approval SourceEvents", () => {
  const request: CodexServerRequest = {
    id: "req-patch",
    method: "applyPatchApproval",
    params: {
      conversationId: "thread-legacy",
      callId: "patch-1",
      fileChanges: {
        "/repo/hello.txt": { type: "add", content: "hello\n" },
      },
      reason: "Apply generated patch",
      grantRoot: "/repo",
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped?.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].toolFamily, "write");
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Apply generated patch",
      confidence: "high",
    });
    assert.deepEqual(mapped.events[0].context?.items, [
      { id: "rootPath", label: "Root Path", value: "/repo" },
      { id: "files", label: "Files", value: "/repo/hello.txt" },
    ]);
  }
});

test("maps permissions approvals into approval SourceEvents", () => {
  const request: CodexServerRequest = {
    id: "req-perms",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-9",
      itemId: "item:perm:1",
      reason: "Need network access",
      permissions: {
        network: { enabled: true },
        fileSystem: null,
        macos: null,
      },
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped?.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.equal(mapped.events[0].title, "Approve Codex permissions");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      whyNow: "Need network access",
      confidence: "high",
    });
  }
});

test("maps single-question user input with options into a choice request", () => {
  const request: CodexServerRequest = {
    id: "req-choice",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-2",
      itemId: "item:input:1",
      questions: [
        {
          id: "deploy_target",
          header: "Deploy target",
          question: "Where should I deploy?",
          isOther: true,
          isSecret: false,
          options: [
            { label: "staging", description: "Staging environment" },
            { label: "production", description: "Production environment" },
          ],
        },
      ],
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].request.kind, "choice");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "question_request",
      activityClass: "question_request",
      whyNow: "Codex asked for input before continuing.",
      confidence: "high",
    });
    if (mapped.events[0].request.kind === "choice") {
      assert.equal(mapped.events[0].request.allowTextResponse, true);
      assert.equal(mapped.events[0].request.options.length, 2);
    }
  }
});

test("maps multi-question user input into a form request", () => {
  const request: CodexServerRequest = {
    id: "req-form",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-2",
      turnId: "turn-3",
      itemId: "item:input:2",
      questions: [
        {
          id: "title",
          header: "Title",
          question: "What is the release title?",
          isOther: false,
          isSecret: false,
          options: null,
        },
        {
          id: "environment",
          header: "Environment",
          question: "Which environment?",
          isOther: false,
          isSecret: false,
          options: [{ label: "prod", description: "Production" }],
        },
      ],
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].request.kind, "form");
    assert.deepEqual(mapped.events[0].semanticHints, {
      intentFrame: "form_request",
      activityClass: "question_request",
      whyNow: "Codex asked for input before continuing.",
      confidence: "high",
    });
    if (mapped.events[0].request.kind === "form") {
      assert.equal(mapped.events[0].request.fields.length, 2);
    }
  }
});

test("maps MCP multi-select elicitation into a multiple-choice request", () => {
  const request: CodexServerRequest = {
    id: "req-mcp-multi",
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-7",
      turnId: "turn-4",
      serverName: "github",
      mode: "form",
      _meta: null,
      message: "Select labels to apply",
      requestedSchema: {
        type: "object",
        properties: {
          labels: {
            type: "array",
            title: "Labels",
            items: {
              type: "string",
              enum: ["bug", "docs"],
            },
          },
        },
        required: ["labels"],
      },
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].activityClass, "question_request");
    assert.equal(mapped.events[0].request.kind, "choice");
    assert.equal(mapped.events[0].taskId, "codex:thread:thread-7:turn:turn-4");
    if (mapped.events[0].request.kind === "choice") {
      assert.equal(mapped.events[0].request.selectionMode, "multiple");
      assert.deepEqual(mapped.events[0].request.options, [
        { id: "labels=bug", label: "bug" },
        { id: "labels=docs", label: "docs" },
      ]);
    }
  }
});

test("maps MCP url elicitation into an approval request", () => {
  const request: CodexServerRequest = {
    id: "req-mcp-url",
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-8",
      turnId: null,
      serverName: "github",
      mode: "url",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        persist: ["session", "always"],
      },
      message: "Authorize GitHub",
      url: "https://github.com/login/device",
      elicitationId: "eli-1",
    },
  };

  const mapped = mapCodexServerRequest(request);
  assert.ok(mapped);
  assert.equal(mapped.events[0]?.type, "human.input.requested");
  if (mapped?.events[0]?.type === "human.input.requested") {
    assert.equal(mapped.events[0].activityClass, "permission_request");
    assert.equal(mapped.events[0].taskId, "codex:thread:thread-8");
    assert.equal(mapped.events[0].request.kind, "approval");
    assert.equal(mapped.events[0].summary, "Open https://github.com/login/device to continue.");
    assert.deepEqual(mapped.events[0].context?.items, [
      { id: "serverName", label: "Server", value: "github" },
      { id: "mode", label: "Mode", value: "url" },
      { id: "url", label: "URL", value: "https://github.com/login/device" },
      { id: "elicitationId", label: "Elicitation", value: "eli-1" },
      { id: "approvalKind", label: "Approval Kind", value: "mcp_tool_call" },
      { id: "persist", label: "Available Scope", value: "session, always" },
    ]);
  }
});

test("maps approval responses back to codex decisions", () => {
  const request: CodexServerRequest = {
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item:cmd:1",
      command: "pnpm test",
      cwd: "/repo",
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-1:turn:turn-1",
    interactionId: "codex:commandApproval:17:thread-1:turn-1:item%3Acmd%3A1",
    response: { kind: "approved" },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    decision: "accept",
  });
});

test("maps exec command approval responses back to review decisions", () => {
  const request: CodexServerRequest = {
    id: "req-exec",
    method: "execCommandApproval",
    params: {
      conversationId: "thread-legacy",
      callId: "call-1",
      approvalId: "approval-1",
      command: ["mkdir", "codex-smoke-test"],
      cwd: "/repo",
      reason: "Create requested directory",
      parsedCmd: [],
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-legacy",
    interactionId: "codex:execCommandApproval:req-exec:thread-legacy:call-1:approval-1",
    response: { kind: "approved" },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    decision: "approved",
  });
});

test("maps permissions approval responses back to granted permissions", () => {
  const request: CodexServerRequest = {
    id: "req-perms",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-9",
      itemId: "item:perm:1",
      reason: "Need network access",
      permissions: {
        network: { enabled: true },
        fileSystem: null,
        macos: null,
      },
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-1:turn:turn-9",
    interactionId: "codex:permissionsApproval:req-perms:thread-1:turn-9:item%3Aperm%3A1",
    response: { kind: "approved" },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    permissions: {
      network: { enabled: true },
    },
    scope: "turn",
  });
});

test("maps user-input form responses back to answer payloads", () => {
  const request: CodexServerRequest = {
    id: "req-form",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-2",
      turnId: "turn-3",
      itemId: "item:input:2",
      questions: [
        {
          id: "title",
          header: "Title",
          question: "What is the release title?",
          isOther: false,
          isSecret: false,
          options: null,
        },
      ],
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-2:turn:turn-3",
    interactionId: "codex:userInput:req-form:thread-2:turn-3:item%3Ainput%3A2",
    response: {
      kind: "form_submitted",
      values: {
        title: "Aperture 0.2.3",
      },
    },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    answers: {
      title: {
        answers: ["Aperture 0.2.3"],
      },
    },
  });
});

test("maps MCP elicitation choice responses back to structured content", () => {
  const request: CodexServerRequest = {
    id: "req-mcp-choice",
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-9",
      turnId: "turn-5",
      serverName: "github",
      mode: "form",
      _meta: null,
      message: "Select an environment",
      requestedSchema: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            title: "Environment",
            oneOf: [
              { const: "staging", title: "Staging" },
              { const: "prod", title: "Production" },
            ],
          },
        },
        required: ["environment"],
      },
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-9:turn:turn-5",
    interactionId: "codex:mcpElicitation:req-mcp-choice:thread-9:turn-5:github:form",
    response: { kind: "option_selected", optionIds: ["environment=prod"] },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    action: "accept",
    content: {
      environment: "prod",
    },
    _meta: null,
  });
});

test("maps MCP elicitation form responses with multi-select fields back to structured content", () => {
  const request: CodexServerRequest = {
    id: "req-mcp-form",
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-10",
      turnId: "turn-6",
      serverName: "linear",
      mode: "form",
      _meta: null,
      message: "Configure review",
      requestedSchema: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            title: "Environment",
            enum: ["staging", "prod"],
            enumNames: ["Staging", "Production"],
          },
          reviewers: {
            type: "array",
            title: "Reviewers",
            items: {
              anyOf: [
                { const: "alice", title: "Alice" },
                { const: "bob", title: "Bob" },
              ],
            },
          },
        },
        required: ["environment"],
      },
    },
  };
  const response: AttentionResponse = {
    taskId: "codex:thread:thread-10:turn:turn-6",
    interactionId: "codex:mcpElicitation:req-mcp-form:thread-10:turn-6:linear:form",
    response: {
      kind: "form_submitted",
      values: {
        environment: "prod",
        "reviewers:option:0": true,
        "reviewers:option:1": false,
      },
    },
  };

  assert.deepEqual(mapCodexResponse(response, request), {
    action: "accept",
    content: {
      environment: "prod",
      reviewers: ["alice"],
    },
    _meta: null,
  });
});

test("maps turn notifications into coarse running/completed updates", () => {
  const started = mapCodexNotification({
    method: "turn/started",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "inProgress",
        items: [],
        error: null,
      },
    },
  });
  assert.equal(started[0]?.type, "task.updated");
  if (started[0]?.type === "task.updated") {
    assert.equal(started[0].status, "running");
    assert.deepEqual(started[0].semanticHints, {
      activityClass: "session_status",
      whyNow: "Codex began working on the current turn.",
      confidence: "high",
    });
  }

  const completed = mapCodexNotification({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        items: [],
        error: null,
      },
    },
  });
  assert.equal(completed[0]?.type, "task.updated");
  if (completed[0]?.type === "task.updated") {
    assert.equal(completed[0].status, "completed");
    assert.deepEqual(completed[0].semanticHints, {
      activityClass: "tool_completion",
      whyNow: "Codex finished the current turn.",
      confidence: "high",
    });
  }
});

test("parses codex interaction ids", () => {
  assert.deepEqual(
    parseCodexInteractionId("codex:userInput:req-form:thread-2:turn-3:item%3Ainput%3A2"),
    {
      kind: "userInput",
      requestId: "req-form",
      threadId: "thread-2",
      turnId: "turn-3",
      itemId: "item:input:2",
    },
  );

  assert.deepEqual(
    parseCodexInteractionId("codex:execCommandApproval:req-exec:thread-legacy:call-1:approval-1"),
    {
      kind: "execCommandApproval",
      requestId: "req-exec",
      threadId: "thread-legacy",
      itemId: "call-1",
      approvalId: "approval-1",
    },
  );

  assert.deepEqual(
    parseCodexInteractionId("codex:applyPatchApproval:req-patch:thread-legacy:patch-call-1:patch"),
    {
      kind: "applyPatchApproval",
      requestId: "req-patch",
      threadId: "thread-legacy",
      itemId: "patch-call-1",
    },
  );

  assert.deepEqual(
    parseCodexInteractionId("codex:mcpElicitation:req-mcp:thread-11:_:github:url:eli-123"),
    {
      kind: "mcpElicitation",
      requestId: "req-mcp",
      threadId: "thread-11",
      turnId: null,
      serverName: "github",
      mode: "url",
      elicitationId: "eli-123",
    },
  );
});
