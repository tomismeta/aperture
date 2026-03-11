import test from "node:test";
import assert from "node:assert/strict";

import { mapPaperclipFrameResponse, mapPaperclipLiveEvent, type PaperclipLiveEvent } from "../src/index.js";

function createEvent(overrides: Partial<PaperclipLiveEvent> = {}): PaperclipLiveEvent {
  return {
    id: 1,
    companyId: "company:paperclip",
    type: "activity.logged",
    createdAt: "2026-03-08T12:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

test("maps approval creation into a human input request", () => {
  const events = mapPaperclipLiveEvent(
    createEvent({
      payload: {
        entityType: "approval",
        entityId: "approval:1",
        action: "approval.created",
        details: {
          type: "hire_agent",
          issueIds: ["ISS-1", "ISS-2"],
        },
      },
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "human.input.requested");
  if (events[0]?.type === "human.input.requested") {
    assert.equal(events[0].taskId, "paperclip:approval:approval:1");
    assert.equal(events[0].request.kind, "approval");
    assert.equal(events[0].riskHint, "high");
    assert.equal(events[0].context?.items?.length, 2);
  }
});

test("maps blocked issue updates into blocked task updates", () => {
  const events = mapPaperclipLiveEvent(
    createEvent({
      payload: {
        entityType: "issue",
        entityId: "issue:7",
        action: "issue.updated",
        details: {
          identifier: "PAP-7",
          title: "Review failing agent",
          status: "blocked",
        },
      },
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "task.updated");
  if (events[0]?.type === "task.updated") {
    assert.equal(events[0].taskId, "paperclip:issue:issue:7");
    assert.equal(events[0].status, "blocked");
    assert.equal(events[0].title, "Review failing agent");
  }
});

test("maps failed heartbeat runs into failed task updates", () => {
  const events = mapPaperclipLiveEvent(
    createEvent({
      type: "heartbeat.run.status",
      payload: {
        runId: "run:9",
        agentId: "agent:2",
        status: "failed",
        error: "Command exited with code 1",
      },
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "task.updated");
  if (events[0]?.type === "task.updated") {
    assert.equal(events[0].taskId, "paperclip:run:run:9");
    assert.equal(events[0].status, "failed");
    assert.equal(events[0].summary, "Command exited with code 1");
  }
});

test("maps approval resolution into task completion", () => {
  const events = mapPaperclipLiveEvent(
    createEvent({
      payload: {
        entityType: "approval",
        entityId: "approval:1",
        action: "approval.approved",
        details: {
          type: "hire_agent",
        },
      },
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "task.completed");
});

test("ignores unsupported live events", () => {
  const events = mapPaperclipLiveEvent(
    createEvent({
      type: "agent.status",
      payload: {
        agentId: "agent:1",
        status: "running",
      },
    }),
  );

  assert.deepEqual(events, []);
});

test("maps approved frame responses back to Paperclip approval actions", () => {
  const action = mapPaperclipFrameResponse({
    taskId: "paperclip:approval:approval:1",
    interactionId: "paperclip:approval:approval:1:review",
    response: {
      kind: "approved",
      reason: "Looks good.",
    },
  });

  assert.deepEqual(action, {
    kind: "approval.approve",
    approvalId: "approval:1",
    method: "POST",
    path: "/api/approvals/approval:1/approve",
    body: {
      decisionNote: "Looks good.",
    },
  });
});

test("maps rejected frame responses back to Paperclip rejection actions", () => {
  const action = mapPaperclipFrameResponse({
    taskId: "paperclip:approval:approval:1",
    interactionId: "paperclip:approval:approval:1:review",
    response: {
      kind: "rejected",
      reason: "Needs revision.",
    },
  });

  assert.deepEqual(action, {
    kind: "approval.reject",
    approvalId: "approval:1",
    method: "POST",
    path: "/api/approvals/approval:1/reject",
    body: {
      decisionNote: "Needs revision.",
    },
  });
});

test("maps dismissed approval responses to revision requests", () => {
  const action = mapPaperclipFrameResponse({
    taskId: "paperclip:approval:approval:1",
    interactionId: "paperclip:approval:approval:1:review",
    response: {
      kind: "dismissed",
    },
  });

  assert.deepEqual(action, {
    kind: "approval.request_revision",
    approvalId: "approval:1",
    method: "POST",
    path: "/api/approvals/approval:1/request-revision",
  });
});

test("returns null for non-approval responses", () => {
  const action = mapPaperclipFrameResponse({
    taskId: "paperclip:issue:issue:7",
    interactionId: "paperclip:issue:issue:7:review",
    response: {
      kind: "option_selected",
      optionIds: ["retry"],
    },
  });

  assert.equal(action, null);
});
