import assert from "node:assert/strict";
import test from "node:test";

import { mapClaudeCodeHookEvent, type ClaudeCodePreToolUseEvent } from "@aperture/claude-code";
import { mapCodexServerRequest, type CodexServerRequest } from "@aperture/codex";
import { mapOpencodeEvent } from "@aperture/opencode";
import type { SourceEvent } from "@tomismeta/aperture-core";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

const timestamp = "2026-04-05T18:45:00.000Z";

type SourceHumanInputRequestedEvent = Extract<SourceEvent, { type: "human.input.requested" }>;
type NormalizedHumanInputRequestedEvent = Extract<
  ReturnType<typeof normalizeSourceEvent>,
  { type: "human.input.requested" }
>;

test("adapter approval requests normalize to the same canonical human-input contract", () => {
  const claudeEvent: ClaudeCodePreToolUseEvent = {
    session_id: "session-semantic-parity",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-approval-parity",
    tool_input: {
      command: "pnpm test",
      description: "Run tests before continuing",
    },
  };
  const opencodeEvents = mapOpencodeEvent(
    {
      type: "permission.asked",
      properties: {
        id: "perm-semantic-parity",
        sessionID: "ses-semantic-parity",
        title: "Run tests",
        message: "Run bash tool",
        metadata: {
          tool: "bash",
          callID: "call-semantic-parity",
          description: "Run tests before continuing",
          patterns: [{ value: "pnpm test" }],
        },
        createdAt: timestamp,
      },
    },
    {
      baseUrl: "http://127.0.0.1:4096",
      scope: { directory: "/repo" as const },
    },
  );
  const codexMapped = mapCodexServerRequest({
    id: "req-semantic-parity",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-semantic-parity",
      turnId: "turn-semantic-parity",
      itemId: "item:semantic:approval",
      command: "pnpm test",
      cwd: "/repo",
      reason: "Run tests before continuing",
      availableDecisions: ["accept", "decline", "cancel"],
    },
  } satisfies CodexServerRequest);
  assert.ok(codexMapped);

  const snapshots = [
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(mapClaudeCodeHookEvent(claudeEvent))),
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(opencodeEvents)),
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(codexMapped.events)),
  ].map(humanInputContractSnapshot);

  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);
  assert.deepEqual(snapshots[0], {
    request: { kind: "approval" },
    activityClass: "permission_request",
    toolFamily: "bash",
    tone: "focused",
    consequence: "medium",
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      toolFamily: "bash",
      confidence: "medium",
      abstained: undefined,
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        toolFamily: "source",
        confidence: "inferred",
      },
    },
  });
});

test("adapter choice requests normalize to the same canonical human-input contract", () => {
  const questions = [
    {
      header: "Deploy target",
      question: "Where should I deploy?",
      options: [
        { label: "staging", description: "Staging environment" },
        { label: "production", description: "Production environment" },
      ],
    },
  ];
  const claudeEvent: ClaudeCodePreToolUseEvent = {
    session_id: "session-question-parity",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_use_id: "tool-question-parity",
    tool_input: {},
    askUserQuestion: {
      questions: questions.map((question) => ({ ...question, multiSelect: false })),
    },
  };
  const opencodeEvents = mapOpencodeEvent(
    {
      type: "question.asked",
      properties: {
        id: "question-semantic-parity",
        sessionID: "ses-question-parity",
        tool: { callID: "call-question-parity" },
        questions,
        createdAt: timestamp,
      },
    },
    {
      baseUrl: "http://127.0.0.1:4096",
      scope: { directory: "/repo" as const },
    },
  );
  const codexMapped = mapCodexServerRequest({
    id: "req-question-parity",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-question-parity",
      turnId: "turn-question-parity",
      itemId: "item:semantic:question",
      questions: questions.map((question) => ({
        id: "deploy_target",
        ...question,
        isOther: false,
        isSecret: false,
      })),
    },
  } satisfies CodexServerRequest);
  assert.ok(codexMapped);

  const snapshots = [
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(mapClaudeCodeHookEvent(claudeEvent))),
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(opencodeEvents)),
    normalizeHumanInputEvent(singleHumanInputRequestedEvent(codexMapped.events)),
  ].map(humanInputContractSnapshot);

  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[2], snapshots[0]);
  assert.deepEqual(snapshots[0], {
    request: {
      kind: "choice",
      selectionMode: "single",
      optionCount: 2,
    },
    activityClass: "question_request",
    tone: "focused",
    consequence: "medium",
    semantic: {
      intentFrame: "question_request",
      activityClass: "question_request",
      confidence: "low",
      abstained: undefined,
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        confidence: "inferred",
      },
    },
  });
});

function singleHumanInputRequestedEvent(events: SourceEvent[]): SourceHumanInputRequestedEvent {
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "human.input.requested");
  if (events[0]?.type !== "human.input.requested") {
    throw new Error("Expected exactly one human.input.requested event.");
  }
  return events[0];
}

function normalizeHumanInputEvent(
  event: SourceHumanInputRequestedEvent,
): NormalizedHumanInputRequestedEvent {
  const normalized = normalizeSourceEvent(event);
  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type !== "human.input.requested") {
    throw new Error("Expected a normalized human.input.requested event.");
  }
  return normalized;
}

function humanInputContractSnapshot(event: NormalizedHumanInputRequestedEvent) {
  const includeApprovalToolFamily = event.request.kind === "approval";

  return {
    request:
      event.request.kind === "choice"
        ? {
            kind: event.request.kind,
            selectionMode: event.request.selectionMode,
            optionCount: event.request.options.length,
          }
        : {
            kind: event.request.kind,
          },
    activityClass: event.activityClass,
    ...(includeApprovalToolFamily && event.toolFamily !== undefined
      ? { toolFamily: event.toolFamily }
      : {}),
    tone: event.tone,
    consequence: event.consequence,
    semantic: {
      intentFrame: event.semantic?.intentFrame,
      activityClass: event.semantic?.activityClass,
      ...(includeApprovalToolFamily && event.semantic?.toolFamily !== undefined
        ? { toolFamily: event.semantic.toolFamily }
        : {}),
      confidence: event.semantic?.confidence,
      abstained: event.semantic?.abstained,
      provenance: {
        intentFrame: event.semantic?.provenance?.intentFrame,
        activityClass: event.semantic?.provenance?.activityClass,
        ...(includeApprovalToolFamily && event.semantic?.provenance?.toolFamily !== undefined
          ? { toolFamily: event.semantic.provenance.toolFamily }
          : {}),
        confidence: event.semantic?.provenance?.confidence,
      },
    },
  };
}
