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
  }
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
    if (mapped.events[0].request.kind === "form") {
      assert.equal(mapped.events[0].request.fields.length, 2);
    }
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
});
