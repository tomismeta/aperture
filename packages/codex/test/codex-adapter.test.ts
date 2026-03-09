import test from "node:test";
import assert from "node:assert/strict";

import {
  mapCodexFrameResponse,
  mapCodexServerRequest,
  type CodexCommandApprovalRequest,
  type CodexToolRequestUserInputRequest,
} from "../src/index.js";

test("maps Codex command approval requests into approval events", () => {
  const request: CodexCommandApprovalRequest = {
    id: 17,
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "item:cmd:1",
      threadId: "thread-1",
      turnId: "turn-1",
      command: "git push origin main",
      cwd: "/repo",
      reason: "Network access required",
    },
  };

  const events = mapCodexServerRequest(request);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "human.input.requested");
  if (events[0]?.type === "human.input.requested") {
    assert.equal(events[0].request.kind, "approval");
    assert.equal(events[0].taskId, "codex:thread:thread-1:turn:turn-1");
    assert.equal(events[0].interactionId, "codex:approval:17:item%3Acmd%3A1");
    assert.equal(events[0].context?.items?.[0]?.value, "git push origin main");
  }
});

test("maps single-question Codex user input requests into choice events", () => {
  const request: CodexToolRequestUserInputRequest = {
    id: "req-choice",
    method: "item/tool/requestUserInput",
    params: {
      itemId: "item:input:1",
      threadId: "thread-1",
      turnId: "turn-2",
      questions: [
        {
          id: "deploy_target",
          header: "Target",
          question: "Which environment should be used?",
          options: [
            { label: "staging", description: "Safe preview environment" },
            { label: "production", description: "Live customer traffic" },
          ],
        },
      ],
    },
  };

  const events = mapCodexServerRequest(request);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "human.input.requested");
  if (events[0]?.type === "human.input.requested") {
    assert.equal(events[0].request.kind, "choice");
    assert.equal(events[0].title, "Which environment should be used?");
    assert.equal(events[0].summary, "Target selection");
    assert.equal(events[0].interactionId, "codex:choice:req-choice:item%3Ainput%3A1:deploy_target");
    assert.equal(events[0].request.options[0]?.id, "staging");
  }
});

test("maps multi-question Codex user input requests into form events", () => {
  const request: CodexToolRequestUserInputRequest = {
    id: "req-form",
    method: "item/tool/requestUserInput",
    params: {
      itemId: "item:input:2",
      threadId: "thread-2",
      turnId: "turn-3",
      questions: [
        {
          id: "reason",
          header: "Reason",
          question: "Why should this run?",
        },
        {
          id: "environment",
          header: "Environment",
          question: "Select an environment.",
          options: [{ label: "staging", description: "Preview" }],
        },
      ],
    },
  };

  const events = mapCodexServerRequest(request);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "human.input.requested");
  if (events[0]?.type === "human.input.requested") {
    assert.equal(events[0].request.kind, "form");
    assert.equal(events[0].title, "Provide Codex input");
    assert.equal(events[0].summary, "Codex requested 2 inputs before continuing.");
    assert.equal(events[0].interactionId, "codex:form:req-form:item%3Ainput%3A2");
    assert.equal(events[0].request.fields[0]?.id, "reason");
    assert.equal(events[0].request.fields[1]?.type, "select");
  }
});

test("maps approval responses back to Codex approval decisions", () => {
  const action = mapCodexFrameResponse({
    taskId: "codex:thread:thread-1:turn:turn-1",
    interactionId: "codex:approval:17:item%3Acmd%3A1",
    response: { kind: "approved" },
  });

  assert.deepEqual(action, {
    id: 17,
    result: {
      decision: "approved",
    },
  });
});

test("maps dismissed approvals back to abort decisions", () => {
  const action = mapCodexFrameResponse({
    taskId: "codex:thread:thread-1:turn:turn-1",
    interactionId: "codex:approval:17:item%3Acmd%3A1",
    response: { kind: "dismissed" },
  });

  assert.deepEqual(action, {
    id: 17,
    result: {
      decision: "abort",
    },
  });
});

test("maps choice responses back to request_user_input answers", () => {
  const action = mapCodexFrameResponse({
    taskId: "codex:thread:thread-1:turn:turn-2",
    interactionId: "codex:choice:req-choice:item%3Ainput%3A1:deploy_target",
    response: { kind: "option_selected", optionIds: ["staging"] },
  });

  assert.deepEqual(action, {
    id: "req-choice",
    result: {
      answers: {
        deploy_target: {
          answers: ["staging"],
        },
      },
    },
  });
});

test("maps form responses back to request_user_input answers", () => {
  const action = mapCodexFrameResponse({
    taskId: "codex:thread:thread-2:turn:turn-3",
    interactionId: "codex:form:req-form:item%3Ainput%3A2",
    response: {
      kind: "form_submitted",
      values: {
        reason: "deploy now",
        environment: "staging",
      },
    },
  });

  assert.deepEqual(action, {
    id: "req-form",
    result: {
      answers: {
        reason: {
          answers: ["deploy now"],
        },
        environment: {
          answers: ["staging"],
        },
      },
    },
  });
});
