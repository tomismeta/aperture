import assert from "node:assert/strict";
import test from "node:test";

import type { SourceEvent } from "@tomismeta/aperture-core";

import { bindOmpExtension } from "../src/bind.js";
import { createApertureOmpExtension } from "../src/extension.js";
import { mapOmpEvent } from "../src/mapping.js";
import { mapOmpNotificationTransitions } from "../src/notification-mapping.js";
import {
  OmarchyNotificationTransport,
  type OmpCommandRunner,
} from "../src/omarchy-notification-transport.js";
import { createApertureOmarchyOmpExtension } from "../src/omarchy-extension.js";
import { OmpRuntimeTransport, type OmpRuntimeClient } from "../src/runtime-transport.js";
import type {
  OmpEvent,
  OmpExtensionApi,
  OmpExtensionContext,
  OmpMappingContext,
} from "../src/types.js";

const context: OmpMappingContext = {
  cwd: "/workspace/project",
  sessionId: "session-1",
  now: () => "2026-08-31T17:00:00.000Z",
};

function eventOfType<T extends SourceEvent["type"]>(events: SourceEvent[], type: T) {
  return events.find((event): event is Extract<SourceEvent, { type: T }> => event.type === type);
}

test("OMP lifecycle mapping keeps continuations active until session_stop", () => {
  const started = eventOfType(mapOmpEvent({ type: "session_start" }, context), "task.started");
  assert.ok(started);
  assert.equal(started.source?.kind, "omp");
  assert.match(started.taskId, /^omp:/);

  const continuing = eventOfType(
    mapOmpEvent({ type: "agent_end", messages: [], willContinue: true }, context),
    "task.updated",
  );
  assert.ok(continuing);
  assert.equal(continuing.status, "running");

  const settledLoop = eventOfType(
    mapOmpEvent({ type: "agent_end", messages: [], willContinue: false }, context),
    "task.updated",
  );
  assert.ok(settledLoop);
  assert.equal(settledLoop.status, "waiting");

  const completed = eventOfType(
    mapOmpEvent(
      {
        type: "session_stop",
        messages: [],
        turn_id: 4,
        session_id: "session-1",
        session_file: "/sessions/session-1.jsonl",
      },
      context,
    ),
    "task.completed",
  );
  assert.ok(completed);
  assert.equal(completed.taskId, started.taskId);
  const failedStop = eventOfType(
    mapOmpEvent(
      {
        type: "session_stop",
        messages: [],
        turn_id: 5,
        session_id: "session-1",
        last_assistant_message: { stopReason: "error" },
      },
      context,
    ),
    "task.updated",
  );
  assert.ok(failedStop);
  assert.equal(failedStop.status, "failed");
});

test("OMP mapping uses explicit approvals ask lifecycle and typed failures", () => {
  const approval = eventOfType(
    mapOmpEvent(
      {
        type: "tool_approval_requested",
        sessionId: "session-1",
        toolCallId: "tool-1",
        toolName: "bash",
        reason: "Run tests",
        approvalMode: "write",
      },
      context,
    ),
    "task.updated",
  );
  assert.ok(approval);
  assert.equal(approval.status, "blocked");
  assert.equal(approval.activityClass, "permission_request");

  const resolved = eventOfType(
    mapOmpEvent(
      {
        type: "tool_approval_resolved",
        sessionId: "session-1",
        toolCallId: "tool-1",
        toolName: "bash",
        approved: true,
      },
      context,
    ),
    "task.updated",
  );
  assert.ok(resolved);
  assert.equal(resolved.status, "running");

  const ask = eventOfType(
    mapOmpEvent(
      { type: "tool_execution_start", toolCallId: "ask-1", toolName: "ask", args: {} },
      context,
    ),
    "task.updated",
  );
  assert.ok(ask);
  assert.equal(ask.status, "blocked");

  const failed = eventOfType(
    mapOmpEvent(
      {
        type: "tool_execution_end",
        toolCallId: "tool-2",
        toolName: "bash",
        result: { private: "not projected" },
        isError: true,
      },
      context,
    ),
    "task.updated",
  );
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.doesNotMatch(JSON.stringify(failed), /not projected/);
});

test("OMP notification mapping emits only attention-worthy bounded facts", () => {
  const quietEvents: OmpEvent[] = [
    { type: "session_start" },
    { type: "agent_start" },
    { type: "turn_start", turnIndex: 0, timestamp: Date.parse(context.now!()) },
    { type: "agent_end", messages: [], willContinue: true },
  ];
  for (const event of quietEvents)
    assert.deepEqual(mapOmpNotificationTransitions(event, context), []);

  const approval = mapOmpNotificationTransitions(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "approval-1",
      toolName: "bash",
      reason: "token=secret /Users/private/project",
      approvalMode: "write",
    },
    context,
  );
  assert.equal(approval[0]?.kind, "upsert");
  assert.equal(approval[0]?.kind === "upsert" ? approval[0].urgency : undefined, "critical");
  const ask = mapOmpNotificationTransitions(
    { type: "tool_call", toolCallId: "ask-1", toolName: "ask", input: {} },
    context,
  );
  assert.equal(ask[0]?.kind === "upsert" ? ask[0].urgency : undefined, "critical");
  assert.doesNotMatch(JSON.stringify(approval), /token=secret|Users\/private/);

  const resolved = mapOmpNotificationTransitions(
    {
      type: "tool_approval_resolved",
      sessionId: "session-1",
      toolCallId: "approval-1",
      toolName: "bash",
      approved: true,
    },
    context,
  );
  assert.equal(resolved[0]?.kind, "close");
  assert.equal(
    resolved[0]?.kind === "close" && approval[0]?.kind === "upsert" ? resolved[0].key : undefined,
    approval[0]?.kind === "upsert" ? approval[0].key : undefined,
  );
  const credential = mapOmpNotificationTransitions(
    {
      type: "credential_disabled",
      provider: "anthropic",
      disabledCause: "token=secret /Users/private/key",
    },
    context,
  );
  assert.equal(credential[0]?.kind, "upsert");
  assert.doesNotMatch(JSON.stringify(credential), /token=secret|Users\/private/);
  const failedStop = mapOmpNotificationTransitions(
    {
      type: "session_stop",
      messages: [],
      turn_id: 2,
      session_id: "session-1",
      last_assistant_message: { stopReason: "error" },
    },
    context,
  );
  assert.equal(
    failedStop[0]?.kind === "upsert" ? failedStop[0].notificationClass : undefined,
    "failure",
  );
});

test("Omarchy notification transport preserves argv replacement and close semantics", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: OmpCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { stdout: command === "omarchy-notification-send" ? "42\n" : "", stderr: "" };
  };
  const transport = new OmarchyNotificationTransport({ commandRunner: runner });
  const requested: OmpEvent = {
    type: "tool_approval_requested",
    sessionId: "session-1",
    toolCallId: "approval-1",
    toolName: "--exec evil",
    approvalMode: "write",
  };
  await transport.handle(requested, context);
  await transport.handle(requested, context);
  assert.equal(calls[0]?.command, "omarchy-notification-send");
  assert.deepEqual(calls[0]?.args.slice(0, 3), ["--app-name", "aperture-omp", "--urgency"]);
  assert.equal(calls[1]?.args.includes("--replace-id"), true);
  assert.equal(calls[1]?.args.includes("42"), true);

  assert.equal(calls[0]?.args.includes("--exec"), false);
  assert.equal(calls[0]?.args.includes("OMP needs approval for --exec evil"), true);
  await transport.handle(
    {
      type: "tool_approval_resolved",
      sessionId: "session-1",
      toolCallId: "approval-1",
      toolName: "bash",
      approved: true,
    },
    context,
  );
  const close = calls.at(-1);
  assert.equal(close?.command, "busctl");
  assert.deepEqual(close?.args.slice(-3), ["CloseNotification", "u", "42"]);
});

test("OMP shutdown preserves expiring completion and failure notifications", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  let nextId = 50;
  const transport = new OmarchyNotificationTransport({
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return {
        stdout: command === "omarchy-notification-send" ? `${nextId++}\n` : "",
        stderr: "",
      };
    },
  });
  await transport.handle(
    {
      type: "session_stop",
      messages: [],
      turn_id: 1,
      session_id: "session-1",
    },
    context,
  );
  await transport.handle(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "approval-shutdown",
      toolName: "bash",
      approvalMode: "write",
    },
    context,
  );
  await transport.handle(
    { type: "tool_call", toolCallId: "ask-shutdown", toolName: "ask", input: {} },
    context,
  );
  await transport.handle({ type: "session_shutdown" }, context);
  await transport.close();
  const closedIds = calls
    .filter((call) => call.command === "busctl")
    .map((call) => call.args.at(-1));
  assert.deepEqual(closedIds.sort(), ["51", "52"]);
  assert.equal(closedIds.includes("50"), false);
});

test("Omarchy OMP extension suppresses duplicate built-in notifications only while active", async () => {
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  const previous = process.env.PI_NOTIFICATIONS;
  process.env.PI_NOTIFICATIONS = "on";
  try {
    const extension = createApertureOmarchyOmpExtension({
      commandRunner: async () => ({ stdout: "", stderr: "" }),
      availabilityCheck: async () => true,
    });
    await extension({ on: (event, handler) => handlers.set(event, handler) });
    assert.equal(process.env.PI_NOTIFICATIONS, "off");
    await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, {});
    assert.equal(process.env.PI_NOTIFICATIONS, "on");
  } finally {
    if (previous === undefined) delete process.env.PI_NOTIFICATIONS;
    else process.env.PI_NOTIFICATIONS = previous;
  }
});

test("Omarchy OMP extension preserves built-ins when its sender is unavailable", async () => {
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  const previous = process.env.PI_NOTIFICATIONS;
  process.env.PI_NOTIFICATIONS = "on";
  try {
    const unavailableExtension = createApertureOmarchyOmpExtension({
      availabilityCheck: async () => false,
      commandRunner: async () => {
        throw new Error("sender unavailable");
      },
    });
    await unavailableExtension({ on: (event, handler) => handlers.set(event, handler) });
    assert.equal(process.env.PI_NOTIFICATIONS, "on");

    handlers.clear();
    let commandAttempts = 0;
    const failingExtension = createApertureOmarchyOmpExtension({
      availabilityCheck: async () => true,
      commandRunner: async () => {
        commandAttempts += 1;
        throw new Error("sender failed");
      },
    });
    await failingExtension({ on: (event, handler) => handlers.set(event, handler) });
    assert.equal(process.env.PI_NOTIFICATIONS, "off");
    await handlers.get("session_stop")?.(
      { type: "session_stop", session_id: "session-1", turn_id: 1 },
      {},
    );
    assert.equal(commandAttempts, 1);
    await handlers.get("session_stop")?.(
      { type: "session_stop", session_id: "session-1", turn_id: 2 },
      {},
    );
    assert.equal(commandAttempts, 1);
    assert.equal(process.env.PI_NOTIFICATIONS, "on");
  } finally {
    if (previous === undefined) delete process.env.PI_NOTIFICATIONS;
    else process.env.PI_NOTIFICATIONS = previous;
  }
});

test("OMP runtime transport publishes canonical events and closes", async () => {
  const batches: SourceEvent[][] = [];
  let closed = false;
  const client: OmpRuntimeClient = {
    async publishSourceEventBatch(events) {
      batches.push(events);
    },
    async close() {
      closed = true;
    },
  };
  const transport = new OmpRuntimeTransport({ clientFactory: async () => client });
  await transport.handle({ type: "session_start" }, context);
  await transport.handle({ type: "agent_start" }, context);
  assert.equal(batches.length, 2);
  assert.equal(batches[0]?.[0]?.source?.kind, "omp");
  await transport.close();
  assert.equal(closed, true);
});

test("OMP runtime transport retries discovery after an unavailable runtime", async () => {
  let attempts = 0;
  const batches: SourceEvent[][] = [];
  const transport = new OmpRuntimeTransport({
    clientFactory: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return {
        async publishSourceEventBatch(events) {
          batches.push(events);
        },
        async close() {},
      };
    },
  });
  await assert.rejects(() => transport.handle({ type: "session_start" }, context), /offline/);
  await transport.handle({ type: "session_start" }, context);
  assert.equal(attempts, 2);
  assert.equal(batches.length, 1);
});

test("OMP extension binding contains delivery failures and keeps the session alive", async () => {
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  const warnings: string[] = [];
  const pi: OmpExtensionApi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  };
  bindOmpExtension(pi, {
    async handle() {
      throw new Error("offline");
    },
    async close() {},
  });
  await handlers.get("agent_start")?.({ type: "agent_start" }, { cwd: "/workspace" });
  assert.deepEqual(warnings, ["Aperture OMP adapter delivery failed"]);
});

test("standard OMP extension registers against an injected runtime client", async () => {
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  const batches: SourceEvent[][] = [];
  const extension = createApertureOmpExtension({
    mappingContext: context,
    clientFactory: async () => ({
      async publishSourceEventBatch(events) {
        batches.push(events);
      },
      async close() {},
    }),
  });
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("agent_start")?.({ type: "agent_start" }, {});
  assert.equal(batches[0]?.[0]?.type, "task.updated");
});
