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
  assert.equal(mapped[0].toolFamily, "bash");
  assert.equal(mapped[0].activityClass, "permission_request");
  assert.equal(mapped[0].taskId, `opencode:${createOpencodeInstanceKey(context)}:session:ses-1`);
  assert.equal(mapped[0].title, "OpenCode wants to create a new directory");
  assert.equal(mapped[0].summary, "mkdir -p /tmp/aperture-opencode-smoke");
  assert.deepEqual(mapped[0].semanticHints, {
    intentFrame: "approval_request",
    activityClass: "permission_request",
    whyNow: "OpenCode paused and needs a human approval decision.",
    confidence: "high",
  });
  assert.deepEqual(mapped[0].context?.items, [
    { id: "command", label: "Command", value: "mkdir -p /tmp/aperture-opencode-smoke" },
    { id: "cwd", label: "Working Directory", value: "/workspace/project" },
    { id: "callId", label: "Call ID", value: "call-1" },
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

  assert.equal(mapped[0].toolFamily, "read");
  assert.equal(mapped[0].activityClass, "permission_request");
  assert.equal(mapped[0].title, "OpenCode wants to access a path");
  assert.equal(mapped[0].summary, "/private/tmp/aperture-opencode-smoke/*");
  assert.deepEqual(mapped[0].context?.items, [
    { id: "path", label: "Path", value: "/private/tmp/aperture-opencode-smoke/*" },
    { id: "cwd", label: "Working Directory", value: "/workspace/project" },
    { id: "callId", label: "Call ID", value: "call-external-1" },
  ]);
});

test("maps follow-up text parts into a reply request", () => {
  const mapped = mapOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-text-1",
        sessionID: "ses-follow-up",
        type: "text",
        text: "Could you please provide the full path and name for the new directory?",
      },
    },
  }, { ...context, messageRole: "assistant" });

  assert.deepEqual(mapped, [
    {
      id: `opencode:${createOpencodeInstanceKey(context)}:event:message.part.updated:part-text-1:follow-up`,
      type: "human.input.requested",
      taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-follow-up`,
      interactionId: `opencode:${createOpencodeInstanceKey(context)}:followup:${encodeURIComponent("ses-follow-up")}|${encodeURIComponent("part-text-1")}`,
      timestamp: mapped[0]?.timestamp,
      source: {
        id: `opencode:${createOpencodeInstanceKey(context)}`,
        kind: "opencode",
        label: "OpenCode",
      },
      toolFamily: "opencode",
      activityClass: "follow_up",
      title: "OpenCode is waiting for your reply",
      summary: "Could you please provide the full path and name for the new directory?",
      request: {
        kind: "form",
        fields: [
          {
            id: "reply",
            label: "Reply",
            type: "textarea",
            required: true,
          },
        ],
      },
      semanticHints: {
        intentFrame: "question_request",
        activityClass: "follow_up",
        whyNow: "OpenCode asked a follow-up question and needs a reply before continuing.",
        confidence: "high",
      },
      provenance: {
        whyNow: "OpenCode asked a follow-up question and needs a reply before continuing.",
      },
      riskHint: "medium",
      context: {
        items: [
          { id: "sessionId", label: "Session ID", value: "ses-follow-up" },
          { id: "partId", label: "Part ID", value: "part-text-1" },
        ],
      },
    },
  ]);
});

test("does not map user-authored text questions into a reply request", () => {
  const mapped = mapOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-text-user-1",
        sessionID: "ses-follow-up",
        type: "text",
        text: "Can you ask me a single question?",
      },
    },
  }, { ...context, messageRole: "user" });

  assert.deepEqual(mapped, []);
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
  assert.equal(mapped[0].activityClass, "question_request");
  assert.equal(mapped[0].title, "Directory");
  assert.equal(mapped[0].summary, "Where should I create the new directory?");
  assert.deepEqual(mapped[0].semanticHints, {
    intentFrame: "question_request",
    activityClass: "question_request",
    whyNow: "OpenCode paused and needs a human answer before continuing.",
    confidence: "high",
  });
  assert.deepEqual(mapped[0].request.options.map((option) => option.id), [
    "Current directory",
    "Parent directory",
  ]);
  assert.deepEqual(mapped[0].context?.items, [
    { id: "sessionId", label: "Session ID", value: "ses-2" },
    { id: "questionCount", label: "Question Count", value: "1" },
    { id: "callId", label: "Call ID", value: "call-question-1" },
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

  assert.equal(mapped[0].activityClass, "question_request");
  assert.equal(mapped[0].request.allowTextResponse, true);
});

test("maps single-question choice prompts to include freeform reply affordance", () => {
  const mapped = mapOpencodeEvent({
    type: "question.asked",
    properties: {
      id: "question-implicit-custom-1",
      sessionID: "ses-implicit-custom-1",
      questions: [
        {
          header: "Content",
          question: "What content would you like in the file?",
          options: [
            { label: "Empty template" },
            { label: "Include aperture info" },
          ],
        },
      ],
    },
  }, context);

  assert.equal(mapped[0]?.type, "human.input.requested");
  if (mapped[0]?.type !== "human.input.requested" || mapped[0].request.kind !== "choice") {
    return;
  }

  assert.equal(mapped[0].activityClass, "question_request");
  assert.equal(mapped[0].request.allowTextResponse, true);
});

test("maps session.status into explicit session-status awareness", () => {
  const mapped = mapOpencodeEvent({
    type: "session.status",
    properties: {
      sessionID: "ses-9",
      status: {
        type: "running",
        reason: "OpenCode is still working.",
      },
    },
  }, context);

  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type !== "task.updated") {
    return;
  }

  assert.equal(mapped[0].activityClass, "session_status");
  assert.equal(mapped[0].status, "running");
  assert.equal(mapped[0].summary, "OpenCode is still working.");
  assert.deepEqual(mapped[0].semanticHints, {
    activityClass: "session_status",
    whyNow: "OpenCode is still working.",
    confidence: "high",
  });
});

test("maps failed message parts into explicit tool-failure awareness", () => {
  const mapped = mapOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-err-1",
        sessionID: "ses-error",
        type: "tool",
        state: {
          status: "failed",
        },
      },
    },
  }, context);

  assert.equal(mapped[0]?.type, "task.updated");
  if (mapped[0]?.type !== "task.updated") {
    return;
  }

  assert.equal(mapped[0].activityClass, "tool_failure");
  assert.equal(mapped[0].status, "failed");
  assert.deepEqual(mapped[0].semanticHints, {
    activityClass: "tool_failure",
  });
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
    body: {
      reply: "reject",
      message: "Dismissed in Aperture.",
    },
  });
});

test("maps rejected OpenCode permissions with a friendly default message", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-1`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:permission:perm-1`,
    response: { kind: "rejected" },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "permission.reply",
    requestId: "perm-1",
    body: {
      reply: "reject",
      message: "Rejected in Aperture.",
    },
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

test("maps follow-up form submissions back into a session prompt", () => {
  const response: AttentionResponse = {
    taskId: `opencode:${createOpencodeInstanceKey(context)}:session:ses-follow-up`,
    interactionId: `opencode:${createOpencodeInstanceKey(context)}:followup:${encodeURIComponent("ses-follow-up")}|${encodeURIComponent("part-text-1")}`,
    response: {
      kind: "form_submitted",
      values: {
        reply: "Create it under ./notes",
      },
    },
  };

  assert.deepEqual(mapOpencodeResponse(response), {
    kind: "session.prompt",
    sessionId: "ses-follow-up",
    body: {
      parts: [
        {
          type: "text",
          text: "Create it under ./notes",
          metadata: {
            source: "aperture",
            interaction: "follow_up",
          },
        },
      ],
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

test("parses OpenCode follow-up interaction ids", () => {
  const parsed = parseOpencodeInteractionId(
    `opencode:${createOpencodeInstanceKey(context)}:followup:${encodeURIComponent("ses-7")}|${encodeURIComponent("part-2")}`,
  );

  assert.deepEqual(parsed, {
    kind: "followup",
    instanceKey: createOpencodeInstanceKey(context),
    sessionId: "ses-7",
    partId: "part-2",
  });
});
