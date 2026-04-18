import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionFrame as Frame, AttentionResponse as FrameResponse } from "@tomismeta/aperture-core";

import { describeResponse } from "../src/interaction.js";

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve deployment",
    summary: "A deploy needs review.",
    timing: {
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    ...overrides,
  };
}

test("describeResponse includes compact source context for the next focused item", () => {
  const response: FrameResponse = {
    taskId: "task-1",
    interactionId: "interaction-1",
    response: { kind: "approved" },
  };

  const nextActive = makeFrame({
    id: "frame-2",
    interactionId: "interaction-2",
    title: "Approve Read package.json",
    source: {
      id: "claude-code:session-1",
      kind: "claude-code",
      label: "Claude Code aperture #f3d677",
    },
  });

  assert.equal(
    describeResponse(response, nextActive),
    "Approved · focused on Approve Read package.json · Claude Code",
  );
});

test("describeResponse falls back to host-kind labels when a frame has no source label", () => {
  const response: FrameResponse = {
    taskId: "task-1",
    interactionId: "interaction-1",
    response: { kind: "approved" },
  };

  const nextActive = makeFrame({
    id: "frame-2",
    interactionId: "interaction-2",
    title: "Answer deployment target",
    source: {
      id: "opencode:http%3A%2F%2F127.0.0.1%3A4096",
      kind: "opencode",
    },
  });

  assert.equal(
    describeResponse(response, nextActive),
    "Approved · focused on Answer deployment target · OpenCode",
  );
});
