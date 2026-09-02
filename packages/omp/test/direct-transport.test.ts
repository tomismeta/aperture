import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import type { OmpDirectMessage } from "@tomismeta/aperture/omp-direct-message";

import { mapOmpDirectAttentionEvents } from "../src/direct-event-mapping.js";
import { HerdrFocusHost, resolveHerdrFocusContext } from "../src/herdr-focus.js";
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

  override async send(message: OmpDirectMessage): Promise<void> {
    if (message.type === "omp.attention-event") this.sent.push(message);
    if (this.gate) await once(this.gate, "open");
    if (this.failure) throw this.failure;
  }
}
test("Herdr focus context is exact and rejects unsupported terminal modes", () => {
  const valid = {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
    HERDR_PANE_ID: "w2:p1",
    HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
  };
  assert.deepEqual(resolveHerdrFocusContext(valid, true), {
    herdrSocketPath: valid.HERDR_SOCKET_PATH,
    paneId: valid.HERDR_PANE_ID,
    compositorAddress: valid.HYPRLAND_INSTANCE_SIGNATURE,
  });
  assert.equal(resolveHerdrFocusContext(valid, false), undefined);
  for (const unsupported of [
    { TMUX: "1" },
    { STY: "screen" },
    { ZELLIJ: "1" },
    { OMP_RPC: "1" },
    { PI_HEADLESS: "1" },
  ]) {
    assert.equal(resolveHerdrFocusContext({ ...valid, ...unsupported }, true), undefined);
  }
  assert.equal(
    resolveHerdrFocusContext({ ...valid, HERDR_SOCKET_PATH: "relative.sock" }, true),
    undefined,
  );
  assert.equal(resolveHerdrFocusContext({ ...valid, HERDR_PANE_ID: "pane-1" }, true), undefined);
  assert.equal(
    resolveHerdrFocusContext({ ...valid, HYPRLAND_INSTANCE_SIGNATURE: "bad address" }, true),
    undefined,
  );
  assert.equal(
    resolveHerdrFocusContext({ ...valid, HERDR_PANE_ID: "wA:p1" }, true)?.paneId,
    "wA:p1",
  );
  for (const paneId of ["", "w:p1", "wA:p", "wA:p1\n", "/tmp/wA:p1", `w${"a".repeat(31)}:p1`]) {
    assert.equal(resolveHerdrFocusContext({ ...valid, HERDR_PANE_ID: paneId }, true), undefined);
  }
});
test("focus registration has a bounded broker response budget while attention stays fail-fast", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-direct-timeout-"));
  const socketPath = path.join(root, "worker.sock");
  const server = createServer((socket) => {
    let input = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      input += chunk;
      if (!input.includes("\n")) return;
      const message = JSON.parse(input) as {
        type: string;
        requestId?: string;
        eventId?: string;
      };
      // Integration contract: real socket ACK latency must cross the configured budgets.
      setTimeout(() => {
        socket.end(
          `${JSON.stringify({
            schemaVersion: 2,
            status: "accepted",
            requestId: message.requestId ?? message.eventId,
          })}\n`,
        );
      }, 300);
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  const transport = new OmpDirectWorkerTransport({ socketPath });
  try {
    await transport.registerFocus({
      schemaVersion: 2,
      type: "omp.focus.register",
      requestId: "register-1",
      publicHandle: "A".repeat(32),
      hostGeneration: "B".repeat(32),
      herdrSocketPath: "/run/user/1000/herdr.sock",
      paneId: "w2:p1",
      compositorAddress: "instance_1",
    });
    const attention = mapOmpDirectAttentionEvents(
      {
        type: "tool_approval_requested",
        sessionId: "session-1",
        toolCallId: "tool-1",
        toolName: "bash",
        approvalMode: "write",
      },
      { ...context, sessionId: "session-1" },
    )[0]!;
    await assert.rejects(() => transport.send(attention), /response timed out/);
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});
test("registration acknowledgement failure revokes a possibly late worker commit", async () => {
  let registeredHandle = "";
  let revokedHandle = "";
  class LateCommitTransport extends OmpDirectWorkerTransport {
    constructor() {
      super({ socketPath: "/unused" });
    }

    override async registerFocus(registration: Parameters<OmpDirectWorkerTransport["registerFocus"]>[0]) {
      registeredHandle = registration.publicHandle;
      throw new Error("Aperture worker socket response timed out");
    }

    override async revokeFocus(revocation: Parameters<OmpDirectWorkerTransport["revokeFocus"]>[0]) {
      revokedHandle = revocation.publicHandle;
    }
  }
  const host = await HerdrFocusHost.create({
    direct: new LateCommitTransport(),
    stdoutIsTTY: true,
    environment: {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
      HERDR_PANE_ID: "w2:p1",
      HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
    },
    randomToken: (() => {
      let token = "A";
      return () => {
        const value = token.repeat(32);
        token = "B";
        return value;
      };
    })(),
  });
  assert.equal(host, undefined);
  assert.equal(revokedHandle, registeredHandle);
  assert.match(revokedHandle, /^[A-Za-z0-9_-]{32}$/);
});

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
