import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import {
  FocusControlRejectedError,
  FocusHost,
  resolveFocusTarget,
  type FocusControlTransport,
  type TerminalTitleCapability,
} from "@tomismeta/aperture/focus-host";
import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import {
  directMessageRequestId,
  type FocusRecovery,
  type FocusRegistration,
  type WorkerDirectAcknowledgement,
  type WorkerDirectMessage,
} from "@tomismeta/aperture/worker-direct-message";

import { mapOmpDirectAttentionEvents } from "../src/direct-event-mapping.js";
import { OmpDirectWorkerTransport } from "../src/direct-worker-transport.js";
import { createApertureOmarchyOmpExtension } from "../src/omarchy-extension.js";
import { OmarchyAttentionTransport } from "../src/omarchy-attention-transport.js";
import {
  OmarchyNotificationTransport,
  type OmpCommandRunner,
} from "../src/omarchy-notification-transport.js";
import type {
  OmpEvent,
  OmpExtensionApi,
  OmpExtensionContext,
  OmpMappingContext,
} from "../src/types.js";

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

  override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
    if (message.type === "omp.attention-event") this.sent.push(message);
    if (this.gate) await once(this.gate, "open");
    if (this.failure) throw this.failure;
    return {
      schemaVersion: 4,
      status: "accepted",
      requestId: directMessageRequestId(message),
    };
  }
}

test("focus target detection is closed and rejects unsupported harness modes", () => {
  const herdr = {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
    HERDR_PANE_ID: "wA:p1",
    HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
  };
  assert.deepEqual(resolveFocusTarget(herdr, true, undefined, tokenFactory()), {
    target: {
      kind: "herdr",
      socketPath: herdr.HERDR_SOCKET_PATH,
      paneId: herdr.HERDR_PANE_ID,
      hyprlandInstance: herdr.HYPRLAND_INSTANCE_SIGNATURE,
    },
  });
  const unsupported = [
    { stdout: false },
    { env: { STY: "screen" } },
    { env: { ZELLIJ: "1" } },
    { env: { OMP_RPC: "1" } },
    { env: { PI_RPC: "1" } },
    { env: { OMP_ACP: "1" } },
    { env: { PI_ACP: "1" } },
    { env: { ACP_MODE: "1" } },
    { env: { OMP_HEADLESS: "1" } },
    { env: { PI_HEADLESS: "1" } },
    { env: { TMUX: "/tmp/tmux,1,0" } },
  ];
  for (const item of unsupported) {
    assert.equal(
      resolveFocusTarget(
        { ...herdr, ...(item.env ?? {}) },
        item.stdout ?? true,
        undefined,
        tokenFactory(),
      ),
      undefined,
    );
  }
  for (const env of [
    { KITTY_WINDOW_ID: "1" },
    { WEZTERM_PANE: "1" },
    { GHOSTTY_RESOURCES_DIR: "/tmp" },
    { ALACRITTY_SOCKET: "/tmp/alacritty.sock" },
    { TERM_PROGRAM: "unknown" },
    { TERM: "dumb" },
  ]) {
    assert.equal(
      resolveFocusTarget(
        { TERM: "xterm-256color", HYPRLAND_INSTANCE_SIGNATURE: "instance_1", ...env },
        true,
        titleCapability([]),
        tokenFactory(),
      ),
      undefined,
    );
  }
  assert.equal(
    resolveFocusTarget(
      {
        TMUX: "/run/user/1000/tmux.sock,123,0",
        TMUX_PANE: "%0",
        KITTY_WINDOW_ID: "1",
        HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
      },
      true,
      undefined,
      tokenFactory(),
    ),
    undefined,
  );
});

test("300 ms and 2 s focus registration never delay attention delivery", async () => {
  for (const simulatedDelay of [300, 2_000]) {
    const registration = deferred<FocusRecovery | undefined>();
    class DelayedTransport extends FakeDirectTransport {
      registrationCalls = 0;
      concurrentRegistrations = 0;
      maximumConcurrentRegistrations = 0;
      override async registerFocus(): Promise<FocusRecovery | undefined> {
        this.registrationCalls += 1;
        this.concurrentRegistrations += 1;
        this.maximumConcurrentRegistrations = Math.max(
          this.maximumConcurrentRegistrations,
          this.concurrentRegistrations,
        );
        try {
          return await registration.promise;
        } finally {
          this.concurrentRegistrations -= 1;
        }
      }
      override async revokeFocus(): Promise<void> {}
    }
    const direct = new DelayedTransport();
    const handlers = new Map<
      string,
      (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
    >();
    const pi: OmpExtensionApi = {
      on(name, handler) {
        handlers.set(name, handler);
      },
    };
    const extension = createApertureOmarchyOmpExtension({
      directTransport: direct,
      availabilityCheck: async () => true,
      commandRunner: async () => ({ stdout: "", stderr: "" }),
      focusHostOptions: {
        environment: {
          TERM: "xterm-256color",
          HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
        },
        stdoutIsTTY: true,
        heartbeatIntervalMs: 60_000,
      },
    });
    await extension(pi);
    const extensionContext: OmpExtensionContext = {
      ui: { setTitle: () => undefined },
      sessionManager: { getSessionId: () => "session-1" },
    };
    let sessionHandled = false;
    const session = Promise.resolve(
      handlers.get("session_start")?.({ type: "session_start" }, extensionContext),
    ).then(() => {
      sessionHandled = true;
    });
    await flushMicrotasks();
    assert.equal(sessionHandled, true, `${simulatedDelay} ms registration blocked session event`);
    await session;

    let approvalHandled = false;
    const approval = Promise.resolve(
      handlers.get("tool_approval_requested")?.(
        {
          type: "tool_approval_requested",
          sessionId: "session-1",
          toolCallId: "tool-1",
          toolName: "bash",
          approvalMode: "write",
        },
        extensionContext,
      ),
    ).then(() => {
      approvalHandled = true;
    });
    await flushMicrotasks();
    assert.equal(approvalHandled, true, `${simulatedDelay} ms registration blocked attention`);
    await approval;
    assert.equal(direct.maximumConcurrentRegistrations, 1);
    assert.equal(direct.sent.length, 1);
    assert.equal(direct.sent[0]?.focus, undefined);
    registration.resolve(undefined);
    await flushMicrotasks();
    await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, extensionContext);
  }
});

test("focus host recovers worker late-start and restart with one attempt", async () => {
  let available = false;
  let calls = 0;
  let concurrent = 0;
  let maximumConcurrent = 0;
  const registrations: FocusRegistration[] = [];
  const recovery: FocusRecovery = { kind: "herdr", marker: "R".repeat(32) };
  const timers = new ManualTimers();
  const transport: FocusControlTransport = {
    async registerFocus(registration) {
      calls += 1;
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      registrations.push(registration);
      await Promise.resolve();
      concurrent -= 1;
      if (!available) throw new Error("worker unavailable");
      return recovery;
    },
    async revokeFocus() {},
  };
  const host = FocusHost.create({
    transport,
    environment: {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
      HERDR_PANE_ID: "w1:p1",
      HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
    },
    stdoutIsTTY: true,
    retryInitialMs: 1,
    retryMaximumMs: 2,
    heartbeatIntervalMs: 5,
    randomToken: tokenFactory(),
    setTimer: timers.setTimer as typeof setTimeout,
    clearTimer: timers.clearTimer as typeof clearTimeout,
  });
  assert.ok(host);
  host.prewarm();
  host.prewarm();
  await flushMicrotasks();
  assert.equal(calls, 1);
  assert.equal(maximumConcurrent, 1);
  assert.equal(timers.nextDelay(), 1);
  timers.runNext();
  await flushMicrotasks();
  assert.equal(calls, 2);
  available = true;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), true);
  available = false;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), false);
  available = true;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), true);
  assert(registrations.some((item) => item.recovery?.kind === "herdr"));
  assert.equal(maximumConcurrent, 1);
  await host.close();
});

test("focus host shutdown does not start a second registration after its deadline", async () => {
  const registration = deferred<FocusRecovery | undefined>();
  let registrationCalls = 0;
  let revocationCalls = 0;
  const transport: FocusControlTransport = {
    async registerFocus() {
      registrationCalls += 1;
      return registration.promise;
    },
    async revokeFocus() {
      revocationCalls += 1;
    },
  };
  const host = FocusHost.create({
    transport,
    environment: {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
      HERDR_PANE_ID: "w1:p1",
      HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
    },
    stdoutIsTTY: true,
    closeTimeoutMs: 0,
    randomToken: tokenFactory(),
  });
  assert.ok(host);
  host.prewarm();
  await flushMicrotasks();
  await host.close();
  assert.equal(registrationCalls, 1);
  assert.equal(revocationCalls, 1);
  registration.resolve({ kind: "herdr", marker: "R".repeat(32) });
  await flushMicrotasks();
});

test("direct title rename prevents cleanup from overwriting the new owner", async () => {
  let reject = false;
  let releases = 0;
  const transport: FocusControlTransport = {
    async registerFocus() {
      if (reject) throw new Error("marker ownership lost");
      return undefined;
    },
    async revokeFocus() {},
  };
  const host = FocusHost.create({
    transport,
    environment: { TERM: "xterm-256color", HYPRLAND_INSTANCE_SIGNATURE: "instance_1" },
    stdoutIsTTY: true,
    terminalTitle: {
      claim() {
        return { release: () => (releases += 1) };
      },
    },
    heartbeatIntervalMs: 60_000,
    randomToken: tokenFactory(),
  });
  assert.ok(host);
  host.prewarm();
  await flushMicrotasks();
  reject = true;
  await host.close();
  assert.equal(releases, 0);
});

test("stable unsupported direct ownership releases the host title claim", async () => {
  let releases = 0;
  const transport: FocusControlTransport = {
    async registerFocus() {
      throw new FocusControlRejectedError("unsupported_terminal_owned");
    },
    async revokeFocus() {},
  };
  const host = FocusHost.create({
    transport,
    environment: { TERM: "xterm-256color", HYPRLAND_INSTANCE_SIGNATURE: "instance_1" },
    stdoutIsTTY: true,
    terminalTitle: {
      claim() {
        return { release: () => (releases += 1) };
      },
    },
    retryInitialMs: 1,
    randomToken: tokenFactory(),
  });
  assert.ok(host);
  host.prewarm();
  await flushMicrotasks();
  assert.equal(releases, 1);
  assert.equal(host.isActive(), false);
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

test("full stalled attention queue has one bounded shutdown deadline", async () => {
  const direct = new FakeDirectTransport();
  const gate = new EventEmitter();
  direct.gate = gate;
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async () => ({ stdout: "", stderr: "" }),
  });
  const waits: number[] = [];
  const transport = new OmarchyAttentionTransport({
    direct,
    notification,
    shutdownTimeoutMs: 3_000,
    waitForShutdown: async (_operation, milliseconds) => {
      waits.push(milliseconds);
    },
  });
  for (let index = 0; index < 65; index += 1) {
    await transport.handle(
      {
        type: "tool_approval_requested",
        sessionId: "session-1",
        toolCallId: `tool-${index}`,
        toolName: "bash",
        approvalMode: "write",
      },
      { ...context, sessionId: "session-1" },
    );
  }
  assert.equal(direct.sent.length, 1);
  await transport.close();
  assert.equal(waits.length, 2);
  assert(waits.every((value) => value >= 0 && value <= 3_000));
  gate.emit("open");
  await flushMicrotasks();
  assert.equal(direct.sent.length, 1);
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

test("direct resolution closes a prior native fallback without a new notice", async () => {
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

function titleCapability(titles: string[]): TerminalTitleCapability {
  return {
    claim(title) {
      titles.push(title);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          titles.push("π");
        },
      };
    },
  };
}

function tokenFactory(): () => string {
  let serial = 0;
  return () => `token-${serial++}`.padEnd(32, "X").slice(0, 32);
}

class ManualTimers {
  private serial = 0;
  private readonly entries = new Map<number, { callback: () => void; delay: number }>();

  readonly setTimer = (callback: () => void, delay = 0): NodeJS.Timeout => {
    const id = ++this.serial;
    this.entries.set(id, { callback, delay });
    return id as unknown as NodeJS.Timeout;
  };

  readonly clearTimer = (timer: NodeJS.Timeout | number | undefined): void => {
    if (timer === undefined) return;
    this.entries.delete(Number(timer));
  };

  nextDelay(): number | undefined {
    return this.entries.values().next().value?.delay;
  }

  runNext(): void {
    const next = this.entries.entries().next().value;
    if (!next) throw new Error("no scheduled focus-host timer");
    const [id, entry] = next;
    this.entries.delete(id);
    entry.callback();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
