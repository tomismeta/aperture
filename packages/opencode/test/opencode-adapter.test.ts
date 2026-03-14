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
      message: "Run bash tool",
      metadata: {
        tool: "bash",
        callID: "call-1",
        patterns: [{ value: "git push origin main" }],
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
});

test("maps question.asked with options to a choice request", () => {
  const mapped = mapOpencodeEvent({
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "ses-2",
      questions: [
        {
          id: "pick",
          label: "Choose one",
          options: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
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
  assert.deepEqual(mapped[0].request.options.map((option) => option.id), ["yes", "no"]);
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
      id: "perm-2",
      sessionID: "ses-3",
      reply: "reject",
      message: "too risky",
    },
  }, context);

  assert.ok(mapped);
  assert.deepEqual(mapped?.response.response, { kind: "rejected", reason: "too risky" });
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
