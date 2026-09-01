import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";

import { mapOmpDirectAttentionEvents } from "../src/direct-event-mapping.js";
import { OmpDirectWorkerTransport } from "../src/direct-worker-transport.js";
import { OmarchyAttentionTransport } from "../src/omarchy-attention-transport.js";
import {
  OmarchyNotificationTransport,
  type OmpCommandRunner,
} from "../src/omarchy-notification-transport.js";
import type { OmpMappingContext } from "../src/types.js";

const context: OmpMappingContext = {
  sessionId: "session;$(opaque)",
  now: () => "2026-09-01T16:00:00.000Z",
};

class FakeDirectTransport extends OmpDirectWorkerTransport {
  readonly sent: OmpAttentionEvent[] = [];
  available = true;
  failure: Error | null = null;
  gate: EventEmitter | null = null;

  constructor() {
    super({ socketPath: "/unused" });
  }

  override async isAvailable(): Promise<boolean> {
    return this.available;
  }

  override async send(event: OmpAttentionEvent): Promise<void> {
    this.sent.push(event);
    if (this.gate) await once(this.gate, "open");
    if (this.failure) throw this.failure;
  }
}

test("direct mapping emits bounded typed facts without private OMP payloads", () => {
  const approval = mapOmpDirectAttentionEvents(
    {
      type: "tool_approval_requested",
      sessionId: context.sessionId!,
      toolCallId: "tool-1",
      toolName: "bash",
      reason: "token=secret /home/tom/private",
      approvalMode: "write",
    },
    context,
  );
  assert.equal(approval.length, 1);
  assert.equal(approval[0]?.classification, "approval_requested");
  assert.equal(approval[0]?.sessionId, context.sessionId);
  const rendered = JSON.stringify(approval);
  assert.equal(rendered.includes("token=secret"), false);
  assert.equal(rendered.includes("/home/tom"), false);
  assert.equal(rendered.includes("approvalMode"), false);

  const replay = mapOmpDirectAttentionEvents(
    {
      type: "tool_approval_requested",
      sessionId: context.sessionId!,
      toolCallId: "tool-1",
      toolName: "bash",
      reason: "different private reason",
      approvalMode: "write",
    },
    context,
  );
  assert.equal(replay[0]?.eventId, approval[0]?.eventId);

  const resolved = mapOmpDirectAttentionEvents(
    {
      type: "tool_approval_resolved",
      sessionId: context.sessionId!,
      toolCallId: "tool-1",
      toolName: "bash",
      approved: true,
      reason: "private",
    },
    context,
  );
  assert.equal(resolved[0]?.classification, "approval_resolved");
  assert.equal(resolved[0]?.interactionId, approval[0]?.interactionId);
});

test("healthy direct delivery returns immediately and emits no native duplicate", async () => {
  const direct = new FakeDirectTransport();
  const gate = new EventEmitter();
  direct.gate = gate;
  const commands: string[] = [];
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command) => {
      commands.push(command);
      return { stdout: "41\n", stderr: "" };
    },
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  await transport.handle(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "bash",
      approvalMode: "write",
    },
    { ...context, sessionId: "session-1" },
  );
  assert.equal(direct.sent.length, 1);
  assert.deepEqual(commands, []);
  gate.emit("open");
  await transport.close();
  assert.deepEqual(commands, []);
});

test("direct failure falls back to exact aperture-omp native notification", async () => {
  const direct = new FakeDirectTransport();
  direct.failure = new Error("offline");
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: OmpCommandRunner = async (command, args) => {
    calls.push({ command, args: [...args] });
    return { stdout: command === "omarchy-notification-send" ? "42\n" : "", stderr: "" };
  };
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: runner,
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  await transport.handle(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "bash",
      approvalMode: "write",
    },
    { ...context, sessionId: "session-1" },
  );
  await transport.close();
  const sender = calls.find((call) => call.command === "omarchy-notification-send");
  assert.ok(sender);
  assert.deepEqual(sender.args.slice(0, 2), ["--app-name", "aperture-omp"]);
  assert(sender.args.includes("OMP needs approval for bash"));
});

test("direct resolution closes a prior native fallback without emitting a new notice", async () => {
  const direct = new FakeDirectTransport();
  direct.failure = new Error("offline");
  const calls: Array<{ command: string; args: string[] }> = [];
  const senderEvents = new EventEmitter();
  const senderDelivered = once(senderEvents, "sent");
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command, args) => {
      calls.push({ command, args: [...args] });
      if (command === "omarchy-notification-send") senderEvents.emit("sent");
      return { stdout: command === "omarchy-notification-send" ? "43\n" : "", stderr: "" };
    },
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  const mappingContext = { ...context, sessionId: "session-1" };
  await transport.handle(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "bash",
      approvalMode: "write",
    },
    mappingContext,
  );
  await senderDelivered;
  direct.failure = null;
  await transport.handle(
    {
      type: "tool_approval_resolved",
      sessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "bash",
      approved: true,
    },
    mappingContext,
  );
  await transport.close();
  assert.equal(calls.filter((call) => call.command === "omarchy-notification-send").length, 1);
  assert.equal(calls.filter((call) => call.command === "busctl").length, 1);
});
