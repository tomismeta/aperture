import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionResponse } from "@tomismeta/aperture-core";

import {
  createOpencodeInstanceKey,
  mapOpencodeEvent,
  mapOpencodeNativeResolution,
  mapOpencodeResponse,
  parseOpencodeInteractionId,
} from "../src/index.js";

const context = {
  baseUrl: "http://127.0.0.1:4096",
  scope: { directory: "/workspace/project" as const },
};

test("maps permission.asked to an approval request", () => {
  const mapped = mapOpencodeEvent({
    type: "permission.asked",
    properties: {
      id: "perm-1",
      sessionID: "ses-1",
      title: "Create directory",
      message: "Run bash tool",
      metadata: {
        tool: "bash",
        callID: "call-1",
        patterns: [{ value: "mkdir -p /tmp/aperture-opencode-smoke" }],
      },
      createdAt: "2026-03-14T12:00:00.000Z",
    },
  }, context);

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested") {
    return;
  }
  assert.equal(mapped[0].request.kind, "approval");
  assert.equal(mapped[0].taskId, `opencode:${createOpencodeInstanceKey(context)}:session:ses-1`);
  assert.equal(mapped[0].title, "OpenCode wants to run a shell command");
  assert.equal(mapped[0].summary, "mkdir -p /tmp/aperture-opencode-smoke");
  assert.deepEqual(mapped[0].context?.items, [
    { id: "command", label: "Command", value: "mkdir -p /tmp/aperture-opencode-smoke" },
    { id: "cwd", label: "Working directory", value: "/workspace/project" },
    { id: "call", label: "Call ID", value: "call-1" },
  ]);
});

test("maps external directory approvals from the real OpenCode permission shape", () => {
  const mapped = mapOpencodeEvent({
    type: "permission.asked",
    properties: {
      id: "perm-2",
      sessionID: "ses-2",
      permission: "external_directory",
      patterns: ["/private/tmp/aperture-opencode-smoke/*"],
      tool: {
        callID: "call-external-1",
      },
    },
  }, context);

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested") {
    return;
  }

  assert.equal(mapped[0].title, "OpenCode wants to access a path");
  assert.equal(mapped[0].summary, "/private/tmp/aperture-opencode-smoke/*");
  assert.deepEqual(mapped[0].context?.items, [
    { id: "path", label: "Path", value: "/private/tmp/aperture-opencode-smoke/*" },
    { id: "cwd", label: "Working directory", value: "/workspace/project" },
    { id: "call", label: "Call ID", value: "call-external-1" },
  ]);
});

test("maps follow-up text parts into blocked awareness", () => {
  const mapped = mapOpencodeEvent({
    type: "message.part.updated",
    properties: {
      sessionID: "ses-follow-up",
      part: {
        id: "part-text-1",
        type: "text",
        text: "Could you please provide the full path and name for the new directory?",
      },
    },
  }, context);

  assert.deepEqual(mapped, [
    {
      id: `opencode:${createOpencodeInstanceKey(context)}:event:message.part.updated:part-text-1:follow-up`,
      type: "task.updated",
      taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-follow-up`,
      timestamp: mapped[0]?.timestamp,
      source: {
        id: `opencode:${createOpencodeInstanceKey(context)}`,
        kind: "opencode",
        label: "OpenCode",
      },
      title: "OpenCode is waiting for your reply",
      summary: "Could you please provide the full path and name for the new directory?",
      status: "blocked",
    },
  ]);
});

test("maps question.asked with options to a choice request", () => {
  const mapped = mapOpencodeEvent({
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "ses-2",
      tool: {
        callID: "call-question-1",
      },
      questions: [
        {
          header: "Directory",
          question: "Where should I create the new directory?",
          options: [
            { label: "Current directory", description: "Create in current working directory" },
            { label: "Parent directory", description: "Create in the parent directory" },
          ],
        },
      ],
    },
  }, context);

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested") {
    return;
  }
  assert.equal(mapped[0].request.kind, "choice");
  assert.equal(mapped[0].title, "Directory");
  assert.equal(mapped[0].summary, "Where should I create the new directory?");
  assert.deepEqual(mapped[0].request.options.map((option) => option.id), [
    "Current directory",
    "Parent directory",
  ]);
  assert.deepEqual(mapped[0].context?.items, [
    { id: "session", label: "Session", value: "ses-2" },
    { id: "questions", label: "Questions", value: "1" },
    { id: "call", label: "Call ID", value: "call-question-1" },
  ]);
});

test("maps question.asked custom choice affordance to generic text response", () => {
  const mapped = mapOpencodeEvent({
    type: "question.asked",
    properties: {
      id: "question-custom-1",
      sessionID: "ses-custom-1",
      questions: [
        {
          header: "Folder name",
          question: "What should be the name of the new directory?",
          custom: true,
          options: [
            { label: "project" },
            { label: "src" },
          ],
        },
      ],
    },
  }, context);

  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested" || mapped[0].request.kind !== "choice") {
    return;
  }

  assert.equal(mapped[0].request.allowTextResponse, true);
});

test("maps OpenCode approvals back to permission reply calls", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-1`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:permission:perm-1`,
    response: { kind: "approved" },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "permission.reply",
    requestId: "perm-1",
    body: { reply: "once" },
  });
});

test("maps non-decisive permission responses conservatively to reject", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-1`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:permission:perm-1`,
    response: { kind: "acknowledged" },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "permission.reply",
    requestId: "perm-1",
    body: { reply: "reject" },
  });
});

test("maps native permission resolution to a synthetic Aperture response", () => {
  const mapped = mapOpencodeNativeResolution({
    type: "permission.replied",
    properties: {
      requestID: "perm-2",
      sessionID: "ses-3",
      reply: "reject",
      message: "too risky",
    },
  }, context);

  assert.ok(mapped);
  assert.deepEqual(mapped?.response.response, { kind: "rejected", reason: "too risky" });
});

test("maps native question resolution using requestID", () => {
  const mapped = mapOpencodeNativeResolution({
    type: "question.replied",
    properties: {
      requestID: "question-7",
      sessionID: "ses-7",
      answers: [["Current directory"]],
    },
  }, context);

  assert.ok(mapped);
  assert.deepEqual(mapped?.response, {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-7`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:question:question-7`,
    response: {
      kind: "acknowledged",
    },
  });
});

test("maps form submissions to one answer group per field", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-4`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:question:question-form-1`,
    response: {
      kind: "form_submitted",
      values: {
        name: "Tom",
        tags: ["sdk", "adapter"],
        confirm: true,
      },
    },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "question.reply",
    requestId: "question-form-1",
    body: {
      answers: [["Tom"], ["sdk", "adapter"], ["true"]],
    },
  });
});

test("maps text submissions to a single question answer group", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-5`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:question:question-custom-1`,
    response: {
      kind: "text_submitted",
      text: "tomleslie",
    },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "question.reply",
    requestId: "question-custom-1",
    body: {
      answers: [["tomleslie"]],
    },
  });
});

test("parses OpenCode interaction ids", () => {
  const parsed = parseOpencodeInteractionId(
    `opencode:${createOpencodeInstanceKey(context)}:question:question-7`,
  );
  assert.deepEqual(parsed, {
    kind: "question",
    instanceKey: createOpencodeInstanceKey(context),
    requestId: "question-7",
  });
});
