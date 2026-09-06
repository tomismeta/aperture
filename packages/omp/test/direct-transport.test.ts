import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  FocusHost,
  resolveFocusTarget,
  type FocusControlTransport,
  type TerminalTitleCapability,
} from "@tomismeta/aperture/focus-host";
import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import {
  assertWorkerDirectMessage,
  directMessageRequestId,
  WorkerDirectRejectedError,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRegistrationResult,
  type WorkerDirectAcknowledgement,
  type WorkerDirectMessage,
} from "@tomismeta/aperture/worker-direct-message";

import { mapOmpDirectAttentionEvents } from "../src/direct-event-mapping.js";
import {
  OmpDirectDeliveryError,
  OmpDirectWorkerTransport,
} from "../src/direct-worker-transport.js";
import { FocusReplaySender } from "../src/focus-replay-sender.js";
import { createApertureOmarchyOmpExtension } from "../src/omarchy-extension.js";
import { OmarchyAttentionTransport } from "../src/omarchy-attention-transport.js";
import { SessionHeartbeatSender } from "../src/session-heartbeat-sender.js";
import { MAXIMUM_CONCURRENT_NATIVE_FALLBACKS } from "../src/omarchy-attention-state.js";
import { mapOmpNotificationTransitions } from "../src/notification-mapping.js";
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
  agentRunId: "test-agent-run",
  session: { label: "omarchy-aperture" },
  now: () => "2026-09-01T16:00:00.000Z",
};

const omp18LifecycleFixture = JSON.parse(
  readFileSync(new URL("./fixtures/omp-18.0.11-tool-lifecycle.json", import.meta.url), "utf8"),
) as {
  source: {
    package: string;
    version: string;
    tag: string;
    commit: string;
  };
  contract: {
    order: string[];
    attentionHooks: string[];
    telemetryHooks: string[];
  };
  events: OmpEvent[];
};

function replayEvent(eventId: string): OmpAttentionEvent {
  return {
    schemaVersion: 4,
    type: "omp.attention-event",
    eventId,
    occurredAt: "2026-09-01T16:00:00.000Z",
    sessionId: "session-replay",
    interactionId: `interaction-${eventId}`,
    classification: "approval_requested",
    title: `Approval ${eventId}`,
    summary: "OMP is waiting for an operator decision.",
    transition: "requested",
    focus: { kind: "opaque-focus", handle: "F".repeat(32) },
  };
}

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

test("emitted session heartbeats conform to the canonical direct request schema", async () => {
  const readJson = (relativePath: string): unknown =>
    JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
  const ajv = new Ajv2020({ strict: true });
  addFormats.default(ajv);
  ajv.addSchema(readJson("../../aperture/src/omp-attention-event.schema.json") as object);
  const validate = ajv.compile(
    readJson("../../aperture/src/worker-direct-message.schema.json") as object,
  );
  const fixture = readJson("../../aperture/fixtures/omp-direct/session-heartbeat.json") as {
    sessionId: string;
  };
  const sent: WorkerDirectMessage[] = [];
  const heartbeat = new SessionHeartbeatSender({
    async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      sent.push(message);
      return {
        schemaVersion: 4,
        status: "accepted",
        requestId: directMessageRequestId(message),
      };
    },
  });
  try {
    heartbeat.observe(fixture.sessionId);
    await flushMicrotasks();
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
    assert.equal(validate(sent[0]), true, JSON.stringify(validate.errors));
  } finally {
    await heartbeat.close();
  }

  for (const name of [
    "approval-request",
    "input-request",
    "failure-event",
    "completion-event",
    "completion-resolved-event",
    "focus-registration",
    "focus-registration-direct-terminal",
    "focus-registration-tmux",
  ]) {
    const request = readJson(`../../aperture/fixtures/omp-direct/${name}.json`);
    assert.equal(validate(request), true, `${name}: ${JSON.stringify(validate.errors)}`);
  }

  for (const request of [
    { ...fixture, requestId: " ".repeat(160) },
    { ...fixture, requestId: "𐀀".repeat(160), sessionId: "𐀀".repeat(160) },
    { ...fixture, sessionId: "opaque;$(not-a-path)" },
    { ...fixture, sessionId: " \u2028opaque" },
  ]) {
    assert.deepEqual(assertWorkerDirectMessage(request), request);
    assert.equal(validate(request), true, JSON.stringify(validate.errors));
  }
  for (const field of ["schemaVersion", "type", "requestId", "sessionId"]) {
    const request: Record<string, unknown> = { ...fixture };
    delete request[field];
    assert.throws(() => assertWorkerDirectMessage(request));
    assert.equal(validate(request), false, `missing ${field}`);
  }
  for (const overrides of [
    { schemaVersion: 3 },
    { type: "omp.session-heartbeat-ack" },
    { extra: true },
    { requestId: 1 },
    { requestId: "" },
    { requestId: "x".repeat(161) },
    { requestId: "bad\nrequest" },
    { requestId: "request\n" },
    { requestId: "bad\u007frequest" },
    { sessionId: null },
    { sessionId: "" },
    { sessionId: " \u00a0" },
    { sessionId: "𐀀".repeat(161) },
    { sessionId: "bad\u0000session" },
    { sessionId: "session\n" },
    { sessionId: "/home/operator/session.jsonl" },
    { sessionId: "session ~/private" },
    { sessionId: "C:\\Users\\operator\\session.jsonl" },
    { sessionId: "session FiLe:///opaque" },
  ]) {
    const request = { ...fixture, ...overrides };
    assert.throws(() => assertWorkerDirectMessage(request));
    assert.equal(validate(request), false, JSON.stringify(overrides));
  }
  assert.equal(validate({ schemaVersion: 4, status: "accepted", requestId: "heartbeat-1" }), false);
});

test("session heartbeats bypass attention ordering and remain single-flight", async () => {
  const attentionGate = deferred<WorkerDirectAcknowledgement>();
  const firstHeartbeatGate = deferred<WorkerDirectAcknowledgement>();
  const sent: WorkerDirectMessage[] = [];
  let heartbeatCalls = 0;
  const transport = {
    async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      sent.push(message);
      if (message.type === "omp.attention-event") return attentionGate.promise;
      heartbeatCalls += 1;
      if (heartbeatCalls === 1) return firstHeartbeatGate.promise;
      return {
        schemaVersion: 4,
        status: "accepted",
        requestId: directMessageRequestId(message),
      };
    },
  };
  let attentionSettled = false;
  void transport.send(replayEvent("blocked-attention")).then(() => {
    attentionSettled = true;
  });
  const heartbeat = new SessionHeartbeatSender(transport, {
    intervalMilliseconds: 60_000,
  });
  heartbeat.observe("session-one");
  heartbeat.observe("session-two");
  await flushMicrotasks();
  assert.equal(attentionSettled, false);
  assert.deepEqual(
    sent.map((message) => message.type),
    ["omp.attention-event", "omp.session-heartbeat"],
  );
  assert.equal(
    sent.find((message) => message.type === "omp.session-heartbeat")?.sessionId,
    "session-one",
  );

  firstHeartbeatGate.resolve({
    schemaVersion: 4,
    status: "accepted",
    requestId: "heartbeat-1",
  });
  await flushMicrotasks();
  assert.equal(heartbeatCalls, 2);
  assert.equal(
    sent.filter((message) => message.type === "omp.session-heartbeat").at(-1)?.sessionId,
    "session-two",
  );
  await heartbeat.close();
  attentionGate.resolve({
    schemaVersion: 4,
    status: "accepted",
    requestId: "blocked-attention",
  });
});

test("continuous OMP activity cannot postpone session heartbeats", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const sent: WorkerDirectMessage[] = [];
  const heartbeat = new SessionHeartbeatSender(
    {
      async send(message): Promise<WorkerDirectAcknowledgement> {
        sent.push(message);
        return { schemaVersion: 4, status: "accepted", requestId: directMessageRequestId(message) };
      },
    },
    { intervalMilliseconds: 5_000 },
  );
  t.after(() => heartbeat.close());
  heartbeat.observe("busy-session");
  await flushMicrotasks();
  for (let elapsed = 1; elapsed <= 15; elapsed += 1) {
    t.mock.timers.tick(1_000);
    heartbeat.observe("busy-session");
    await flushMicrotasks();
  }
  assert.equal(sent.length, 4);
});

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

test("stock OMP session methods route local ask events directly", async () => {
  const direct = new FakeDirectTransport();
  const nativeCommands: string[] = [];
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  await createApertureOmarchyOmpExtension({
    directTransport: direct,
    availabilityCheck: async () => true,
    commandRunner: async (command) => {
      nativeCommands.push(command);
      return { stdout: "41\n", stderr: "" };
    },
  })({
    on(name, handler) {
      handlers.set(name, handler);
    },
    getSessionName() {
      return "omarchy-aperture";
    },
  });
  const sessionManager = {
    getSessionId() {
      assert.equal(this, sessionManager);
      return "stock-session-method";
    },
    getSessionFile() {
      assert.equal(this, sessionManager);
      return "/tmp/stock-session-method.jsonl";
    },
  };
  const extensionContext: OmpExtensionContext = { sessionManager };

  await handlers.get("tool_call")?.(
    {
      type: "tool_call",
      toolCallId: "ask-method-1",
      toolName: "ask",
      input: {},
    },
    extensionContext,
  );
  await flushMicrotasks();

  assert.equal(direct.sent.length, 1);
  assert.equal(direct.sent[0]?.classification, "input_requested");
  assert.equal(direct.sent[0]?.sessionId, "stock-session-method");
  assert.equal(direct.sent[0]?.session?.label, "omarchy-aperture");
  assert.deepEqual(nativeCommands, []);

  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, extensionContext);
});

test("300 ms and 2 s focus registration never delay attention delivery", async () => {
  for (const simulatedDelay of [300, 2_000]) {
    const registration = deferred<FocusRegistrationResult>();
    class DelayedTransport extends FakeDirectTransport {
      registrationCalls = 0;
      concurrentRegistrations = 0;
      maximumConcurrentRegistrations = 0;
      override async registerFocus(): Promise<FocusRegistrationResult> {
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
    registration.resolve({ workerGeneration: "W".repeat(32) });
    await flushMicrotasks();
    assert.equal(direct.sent.length, 2);
    assert.match(direct.sent[1]?.focus?.handle ?? "", /^[A-Za-z0-9_-]{32}$/);
    await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, extensionContext);
  }
});

test("direct Foot waits for actionable attention before claiming the OMP title", async () => {
  let currentTitle = "π";
  class TitleAwareTransport extends FakeDirectTransport {
    registrationCalls = 0;
    private readonly receipts = new Map<string, string>();
    override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      const requestId = directMessageRequestId(message);
      const fingerprint = JSON.stringify(message);
      const existing = this.receipts.get(requestId);
      if (existing !== undefined && existing !== fingerprint) {
        throw new WorkerDirectRejectedError("request_identity_conflict");
      }
      this.receipts.set(requestId, fingerprint);
      return super.send(message);
    }
    override async registerFocus(
      registration: FocusRegistration,
    ): Promise<FocusRegistrationResult> {
      this.registrationCalls += 1;
      assert.equal(registration.target.kind, "direct-terminal");
      assert.equal(currentTitle, `Aperture Focus ${registration.target.marker}`);
      return { workerGeneration: "W".repeat(32) };
    }
    override async revokeFocus(): Promise<void> {}
  }
  const direct = new TitleAwareTransport();
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  await createApertureOmarchyOmpExtension({
    directTransport: direct,
    availabilityCheck: async () => true,
    commandRunner: async () => ({ stdout: "", stderr: "" }),
    focusHostOptions: {
      environment: {
        TERM: "foot",
        HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
      },
      stdoutIsTTY: true,
      randomToken: tokenFactory(),
      heartbeatIntervalMs: 60_000,
    },
  })({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  const extensionContext: OmpExtensionContext = {
    ui: {
      setTitle(title) {
        currentTitle = title;
      },
    },
    sessionManager: { getSessionId: () => "session-1" },
  };

  await handlers.get("session_start")?.({ type: "session_start" }, extensionContext);
  await flushMicrotasks();
  assert.equal(direct.registrationCalls, 0);
  assert.equal(currentTitle, "π");

  currentTitle = "π · OMP generated title";
  await handlers.get("session_stop")?.(
    {
      type: "session_stop",
      session_id: "session-1",
      turn_id: 1,
    },
    extensionContext,
  );
  await flushMicrotasks();

  assert.equal(direct.registrationCalls, 1);
  assert.match(currentTitle, /^Aperture Focus [A-Za-z0-9_-]{32}$/);
  assert.equal(direct.sent[0]?.focus, undefined);
  assert.equal(direct.sent[0]?.classification, "turn_completed");
  assert.equal(direct.sent.length, 2);
  assert.match(direct.sent[1]?.eventId ?? "", /^omp-focus:[a-f0-9]{64}$/);
  assert.notEqual(direct.sent[1]?.eventId, direct.sent[0]?.eventId);
  assert.equal(direct.sent[1]?.focus?.kind, "opaque-focus");

  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, extensionContext);
});

test("worker generation change replays active requests with the same opaque handle", async () => {
  class GenerationTransport extends FakeDirectTransport {
    workerGeneration = "W".repeat(32);
    override async registerFocus(): Promise<FocusRegistrationResult> {
      return {
        workerGeneration: this.workerGeneration,
        recovery: { kind: "herdr", marker: "R".repeat(32) },
      };
    }
    override async revokeFocus(): Promise<void> {}
  }
  const direct = new GenerationTransport();
  const timers = new ManualTimers();
  let mappingClockCalls = 0;
  const handlers = new Map<
    string,
    (event: OmpEvent, context: OmpExtensionContext) => Promise<void> | void
  >();
  await createApertureOmarchyOmpExtension({
    mappingContext: {
      now: () => new Date(Date.UTC(2026, 8, 2, 16, 0, mappingClockCalls++)).toISOString(),
    },
    directTransport: direct,
    availabilityCheck: async () => true,
    commandRunner: async () => ({ stdout: "", stderr: "" }),
    focusHostOptions: {
      environment: {
        HERDR_ENV: "1",
        HERDR_SOCKET_PATH: "/run/user/1000/herdr.sock",
        HERDR_PANE_ID: "w1:p1",
        HYPRLAND_INSTANCE_SIGNATURE: "instance_1",
      },
      stdoutIsTTY: true,
      heartbeatIntervalMs: 5,
      setTimer: timers.setTimer as typeof setTimeout,
      clearTimer: timers.clearTimer as typeof clearTimeout,
    },
  })({
    on(name, handler) {
      handlers.set(name, handler);
    },
  });
  const extensionContext: OmpExtensionContext = {
    sessionManager: { sessionId: "session-1" },
  };
  await handlers.get("session_start")?.({ type: "session_start" }, extensionContext);
  await flushMicrotasks();
  await handlers.get("tool_approval_requested")?.(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "tool-1",
      toolName: "bash",
      approvalMode: "write",
    },
    extensionContext,
  );
  await flushMicrotasks();
  assert.equal(direct.sent.length, 2);
  assert.equal(direct.sent[0]?.focus, undefined);
  const originalHandle = direct.sent[1]?.focus?.handle;
  assert.match(originalHandle ?? "", /^[A-Za-z0-9_-]{32}$/);
  assert.match(direct.sent[1]?.eventId ?? "", /^omp-focus:[a-f0-9]{64}$/);
  assert.equal(direct.sent[1]?.occurredAt, direct.sent[0]?.occurredAt);
  direct.workerGeneration = "X".repeat(32);
  timers.runNext();
  await flushMicrotasks();
  assert.equal(direct.sent.length, 3);
  assert.notEqual(direct.sent[2]?.eventId, direct.sent[1]?.eventId);
  assert.equal(direct.sent[2]?.occurredAt, direct.sent[0]?.occurredAt);
  assert.equal(direct.sent[2]?.focus?.handle, originalHandle);
  assert.equal(mappingClockCalls, 2);

  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, extensionContext);
});
test("replay coalesces pending worker generations to latest wins", async () => {
  const firstGate = deferred<void>();
  const latestSent = deferred<void>();
  class ControlledReplayTransport extends FakeDirectTransport {
    concurrent = 0;
    maximumConcurrent = 0;
    override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      if (message.type !== "omp.attention-event") return super.send(message);
      this.sent.push(message);
      this.concurrent += 1;
      this.maximumConcurrent = Math.max(this.maximumConcurrent, this.concurrent);
      try {
        if (message.eventId === "generation-one") await firstGate.promise;
        if (message.eventId === "generation-three") latestSent.resolve(undefined);
        return {
          schemaVersion: 4,
          status: "accepted",
          requestId: message.eventId,
        };
      } finally {
        this.concurrent -= 1;
      }
    }
  }
  const direct = new ControlledReplayTransport();
  const replay = new FocusReplaySender(direct, () => undefined);
  replay.send("1".repeat(32), [replayEvent("generation-one")]);
  await flushMicrotasks();
  replay.send("2".repeat(32), [replayEvent("generation-two")]);
  replay.send("3".repeat(32), [replayEvent("generation-three")]);
  firstGate.resolve(undefined);
  await latestSent.promise;
  await replay.close();
  assert.deepEqual(
    direct.sent.map((event) => event.eventId),
    ["generation-one", "generation-three"],
  );
  assert.equal(direct.maximumConcurrent, 1);
});

test("focus replay retries transient delivery with one stable event identity", async () => {
  const accepted = deferred<void>();
  class TransientReplayTransport extends FakeDirectTransport {
    attempts = 0;
    override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      if (message.type !== "omp.attention-event") return super.send(message);
      this.sent.push(message);
      this.attempts += 1;
      if (this.attempts < 3) {
        throw new OmpDirectDeliveryError("acceptance-unknown", "simulated acknowledgement loss");
      }
      accepted.resolve(undefined);
      return { schemaVersion: 4, status: "accepted", requestId: message.eventId };
    }
  }
  const direct = new TransientReplayTransport();
  const replay = new FocusReplaySender(direct, () => undefined);
  replay.send("1".repeat(32), [replayEvent("transient-replay")]);
  await accepted.promise;
  await replay.close();
  assert.equal(direct.attempts, 3);
  assert.deepEqual(
    direct.sent.map((event) => event.eventId),
    ["transient-replay", "transient-replay", "transient-replay"],
  );
});

test("replay close aborts the active event and sends no later IDs", async () => {
  class AbortableReplayTransport extends FakeDirectTransport {
    aborted = false;
    override async send(
      message: WorkerDirectMessage,
      _responseTimeoutMs?: number,
      signal?: AbortSignal,
    ): Promise<WorkerDirectAcknowledgement> {
      if (message.type !== "omp.attention-event") return super.send(message);
      this.sent.push(message);
      return new Promise<WorkerDirectAcknowledgement>((_resolve, reject) => {
        const abort = () => {
          this.aborted = true;
          reject(new Error("replay aborted"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  const direct = new AbortableReplayTransport();
  const replay = new FocusReplaySender(direct, () => undefined);
  replay.send(
    "0".repeat(32),
    Array.from({ length: 65 }, (_value, index) => replayEvent(`overflow-${index}`)),
  );
  await flushMicrotasks();
  assert.equal(direct.sent.length, 0);
  replay.send(
    "1".repeat(32),
    Array.from({ length: 64 }, (_value, index) => replayEvent(`shutdown-${index}`)),
  );
  await flushMicrotasks();
  const startedAt = Date.now();
  await replay.close();
  assert.equal(direct.aborted, true);
  assert.deepEqual(
    direct.sent.map((event) => event.eventId),
    ["shutdown-0"],
  );
  assert(Date.now() - startedAt < 3_000);
  replay.send("2".repeat(32), [replayEvent("after-close")]);
  await flushMicrotasks();
  assert.equal(direct.sent.length, 1);
});

test("focus host recovers worker late-start and restart with one attempt", async () => {
  let available = false;
  let calls = 0;
  let concurrent = 0;
  let maximumConcurrent = 0;
  const registrations: FocusRegistration[] = [];
  const recovery: FocusRecovery = { kind: "herdr", marker: "R".repeat(32) };
  let workerGeneration = "W".repeat(32);
  const registeredGenerations: string[] = [];
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
      return { workerGeneration, recovery };
    },
    async revokeFocus() {},
  };
  const registrationEpisodes: string[] = [];
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
    onRegistered: (_handle, generation, receiptEpisodeToken) => {
      registeredGenerations.push(generation);
      registrationEpisodes.push(receiptEpisodeToken);
    },
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
  assert.deepEqual(registeredGenerations, ["W".repeat(32)]);
  available = false;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), false);
  available = true;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), true);
  assert.deepEqual(registeredGenerations, ["W".repeat(32), "W".repeat(32)]);
  assert.notEqual(registrationEpisodes[0], registrationEpisodes[1]);
  available = false;
  timers.runNext();
  await flushMicrotasks();
  workerGeneration = "X".repeat(32);
  available = true;
  timers.runNext();
  await flushMicrotasks();
  assert.equal(host.isActive(), true);
  assert.deepEqual(registeredGenerations, ["W".repeat(32), "W".repeat(32), "X".repeat(32)]);
  assert.equal(new Set(registrationEpisodes).size, 3);
  assert(registrations.some((item) => item.recovery?.kind === "herdr"));
  assert.equal(maximumConcurrent, 1);
  await host.close();
});

test("focus host shutdown does not start a second registration after its deadline", async () => {
  const registration = deferred<FocusRegistrationResult>();
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
  registration.resolve({
    workerGeneration: "W".repeat(32),
    recovery: { kind: "herdr", marker: "R".repeat(32) },
  });
  await flushMicrotasks();
});

test("direct title rename prevents cleanup from overwriting the new owner", async () => {
  let reject = false;
  let releases = 0;
  const transport: FocusControlTransport = {
    async registerFocus() {
      if (reject) throw new Error("marker ownership lost");
      return { workerGeneration: "W".repeat(32) };
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
  const releaseEvents = new EventEmitter();
  const released = once(releaseEvents, "released");
  const transport: FocusControlTransport = {
    async registerFocus() {
      throw new WorkerDirectRejectedError("unsupported_terminal_owned");
    },
    async revokeFocus() {},
  };
  const host = FocusHost.create({
    transport,
    environment: { TERM: "xterm-256color", HYPRLAND_INSTANCE_SIGNATURE: "instance_1" },
    stdoutIsTTY: true,
    terminalTitle: {
      claim() {
        return {
          release: () => {
            releases += 1;
            releaseEvents.emit("released");
          },
        };
      },
    },
    retryInitialMs: 1,
    randomToken: tokenFactory(),
  });
  assert.ok(host);
  host.prewarm();
  await released;
  assert.equal(releases, 1);
  assert.equal(host.isActive(), false);
});

test("OMP 18 lifecycle fixture emits attention only from semantic hooks", () => {
  assert.equal(omp18LifecycleFixture.source.package, "@oh-my-pi/pi-coding-agent");
  assert.equal(omp18LifecycleFixture.source.version, "18.0.11");
  assert.equal(omp18LifecycleFixture.source.tag, "v18.0.11");
  assert.equal(omp18LifecycleFixture.source.commit, "b8ce33a58911c26bed1d84f0db9a5e2e727c49a2");
  assert.deepEqual(
    omp18LifecycleFixture.events.map((event) => event.type),
    omp18LifecycleFixture.contract.order,
  );
  assert.deepEqual(omp18LifecycleFixture.contract.attentionHooks, ["tool_call", "tool_result"]);

  const directEvents = omp18LifecycleFixture.events.flatMap((event) =>
    mapOmpDirectAttentionEvents(event, {
      ...context,
      sessionId: "session-fixture",
    }),
  );
  assert.deepEqual(
    directEvents.map((event) => event.classification),
    ["input_requested", "input_resolved"],
  );
  assert.equal(new Set(directEvents.map((event) => event.eventId)).size, directEvents.length);

  const nativeTransitions = omp18LifecycleFixture.events.flatMap((event) =>
    mapOmpNotificationTransitions(event, {
      ...context,
      sessionId: "session-fixture",
    }),
  );
  assert.deepEqual(
    nativeTransitions.map((transition) => transition.kind),
    ["upsert", "close"],
  );

  for (const event of omp18LifecycleFixture.events.filter((candidate) =>
    omp18LifecycleFixture.contract.telemetryHooks.includes(candidate.type),
  )) {
    assert.deepEqual(
      mapOmpDirectAttentionEvents(event, context),
      [],
      `${event.type} produced a direct attention event`,
    );
    assert.deepEqual(
      mapOmpNotificationTransitions(event, context),
      [],
      `${event.type} produced a native attention transition`,
    );
  }
});

test("duplicate OMP facts retain stable direct identities while distinct turns remain unambiguous", () => {
  const stop: OmpEvent = {
    type: "session_stop",
    messages: [],
    turn_id: 0,
    session_id: "stock-session-repeated-turn-index",
  };
  const first = mapOmpDirectAttentionEvents(stop, {
    agentRunId: "test-agent-run",
    now: () => "2026-09-04T11:30:02.066Z",
  })[0];
  const duplicate = mapOmpDirectAttentionEvents(stop, {
    agentRunId: "test-agent-run",
    now: () => "2026-09-04T11:30:20.604Z",
  })[0];
  const nextTurn = mapOmpDirectAttentionEvents(
    { ...stop, turn_id: 1 },
    {
      agentRunId: "test-agent-run",
      now: () => "2026-09-04T11:30:21.000Z",
    },
  )[0];

  assert.ok(first);
  assert.ok(duplicate);
  assert.ok(nextTurn);
  assert.equal(first.interactionId, duplicate.interactionId);
  assert.equal(first.eventId, duplicate.eventId);
  assert.notEqual(first.occurredAt, duplicate.occurredAt);
  assert.notEqual(first.interactionId, nextTurn.interactionId);
  assert.notEqual(first.eventId, nextTurn.eventId);
  assert.throws(() => mapOmpDirectAttentionEvents(stop, {}));
});

test("session presentation and callback time do not change keyed source causality", () => {
  const event: OmpEvent = {
    type: "tool_approval_requested",
    sessionId: "session-stable",
    toolCallId: "tool-stable",
    toolName: "bash",
    approvalMode: "write",
  };
  const named = mapOmpDirectAttentionEvents(event, {
    sessionId: "session-stable",
    session: { label: "first", facets: [{ id: "branch", label: "Branch", value: "main" }] },
    now: () => "2026-09-04T11:30:02.066Z",
  })[0];
  const renamed = mapOmpDirectAttentionEvents(event, {
    sessionId: "session-stable",
    session: { label: "second", facets: [{ id: "branch", label: "Branch", value: "other" }] },
    now: () => "2026-09-04T11:30:20.604Z",
  })[0];
  assert.equal(named?.eventId, renamed?.eventId);
  assert.equal(named?.interactionId, renamed?.interactionId);
});

test("new interactive activity emits completion-family resolution facts", () => {
  const interactive = mapOmpDirectAttentionEvents(
    { type: "input", text: "Continue", source: "interactive" },
    context,
  );
  assert.equal(interactive[0]?.classification, "completion_resolved");
  assert.equal(interactive[0]?.transition, "resolved");
  assert.equal(interactive[0]?.interactionId, undefined);

  const resumed = mapOmpDirectAttentionEvents(
    { type: "before_agent_start", prompt: "Continue" },
    context,
  );
  assert.equal(resumed[0]?.classification, "completion_resolved");
  assert.deepEqual(
    mapOmpDirectAttentionEvents({ type: "input", text: "Continue", source: "extension" }, context),
    [],
  );
  assert.deepEqual(
    mapOmpDirectAttentionEvents({ type: "before_agent_start", prompt: "Continue" }, {}),
    [],
  );
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

test("direct session labels are bounded display metadata, never identity", () => {
  const ask: OmpEvent = {
    type: "tool_call",
    toolCallId: "ask-session-label",
    toolName: "ask",
  };
  const unnamedContext = { ...context };
  delete unnamedContext.session;
  const unnamed = mapOmpDirectAttentionEvents(ask, unnamedContext)[0];
  const named = mapOmpDirectAttentionEvents(ask, {
    ...context,
    session: {
      label: "  omarchy-aperture  ",
      facets: [{ id: "branch", label: " Branch ", value: " main " }],
    },
  })[0];
  const privateName = mapOmpDirectAttentionEvents(ask, {
    ...context,
    session: { label: "/home/tom/private" },
  })[0];
  const overlong = mapOmpDirectAttentionEvents(ask, {
    ...context,
    session: { label: "x".repeat(117) },
  })[0];

  assert.ok(unnamed);
  assert.ok(named);
  assert.equal(named.session?.label, "omarchy-aperture");
  assert.deepEqual(named.session?.facets, [{ id: "branch", label: "Branch", value: "main" }]);
  assert.equal(named.eventId, unnamed.eventId);
  assert.equal(privateName?.session, undefined);
  assert.equal(overlong?.session, undefined);
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
  direct.failure = new OmpDirectDeliveryError("definitely-not-accepted", "offline");
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

test("native-routed requests never enter focus replay after direct recovery", async () => {
  const direct = new FakeDirectTransport();
  direct.failure = new OmpDirectDeliveryError("definitely-not-accepted", "offline");
  const firstNativeDelivery = deferred<void>();
  let nativeDeliveries = 0;
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command) => {
      if (command === "omarchy-notification-send") {
        nativeDeliveries += 1;
        firstNativeDelivery.resolve(undefined);
        return { stdout: "44\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  const request: OmpEvent = {
    type: "tool_approval_requested",
    sessionId: "session-native",
    toolCallId: "tool-native",
    toolName: "bash",
    approvalMode: "write",
  };
  const mappingContext = { ...context, sessionId: "session-native" };
  await transport.handle(request, mappingContext);
  await firstNativeDelivery.promise;
  direct.failure = null;
  await transport.handle(request, mappingContext);
  await flushMicrotasks();
  transport.replayFocus("G".repeat(32), "H".repeat(32), "I".repeat(32));
  await flushMicrotasks();
  assert.equal(direct.sent.length, 1);
  assert.equal(nativeDeliveries, 2);
  await transport.close();
});

test("direct-owned closure clears focus immediately and retries without native fallback", async () => {
  const closureAccepted = deferred<void>();
  class ClosureRetryTransport extends FakeDirectTransport {
    closureAttempts = 0;
    override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      if (message.type !== "omp.attention-event") return super.send(message);
      this.sent.push(message);
      if (message.classification === "approval_resolved") {
        const transientCodes = [
          "capacity",
          "processing_failed",
          "attention_engine_failed",
        ] as const;
        const code = transientCodes[this.closureAttempts];
        this.closureAttempts += 1;
        if (code) throw new WorkerDirectRejectedError(code);
        closureAccepted.resolve(undefined);
      }
      return { schemaVersion: 4, status: "accepted", requestId: message.eventId };
    }
  }
  const direct = new ClosureRetryTransport();
  const nativeCalls: string[] = [];
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command) => {
      nativeCalls.push(command);
      return { stdout: "", stderr: "" };
    },
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  const mappingContext = { ...context, sessionId: "session-resolution" };
  const request: OmpEvent = {
    type: "tool_approval_requested",
    sessionId: "session-resolution",
    toolCallId: "tool-resolution",
    toolName: "bash",
    approvalMode: "write",
  };
  const resolution: OmpEvent = {
    type: "tool_approval_resolved",
    sessionId: "session-resolution",
    toolCallId: "tool-resolution",
    toolName: "bash",
    approved: true,
  };
  await transport.handle(request, mappingContext);
  await flushMicrotasks();
  await transport.handle(resolution, mappingContext);
  await flushMicrotasks();
  transport.replayFocus("J".repeat(32), "K".repeat(32), "L".repeat(32));
  await flushMicrotasks();
  assert.equal(
    direct.sent.filter((event) => event.classification === "approval_requested").length,
    1,
  );
  await closureAccepted.promise;
  assert.equal(direct.closureAttempts, 4);
  assert.deepEqual(nativeCalls, []);
  await transport.close();
});

test("retry displacement enforces native fallback capacity and preserves post-write authority", async () => {
  const directRelease = deferred<void>();
  const nativeRelease = deferred<void>();
  const nativeCapacityReached = deferred<void>();
  const retryDisplaced = deferred<void>();
  const capacityExhausted = deferred<void>();
  class AmbiguousOnceTransport extends FakeDirectTransport {
    attempts = 0;
    override async send(message: WorkerDirectMessage): Promise<WorkerDirectAcknowledgement> {
      if (message.type !== "omp.attention-event") return super.send(message);
      this.sent.push(message);
      this.attempts += 1;
      if (this.attempts <= 3) {
        await directRelease.promise;
        throw new OmpDirectDeliveryError("acceptance-unknown", "simulated post-write ambiguity");
      }
      return { schemaVersion: 4, status: "accepted", requestId: message.eventId };
    }
  }
  const direct = new AmbiguousOnceTransport();
  let nativeConcurrent = 0;
  let maximumNativeConcurrent = 0;
  let nativeStarts = 0;
  const failures: string[] = [];
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command) => {
      if (command !== "omarchy-notification-send") return { stdout: "", stderr: "" };
      nativeStarts += 1;
      nativeConcurrent += 1;
      maximumNativeConcurrent = Math.max(maximumNativeConcurrent, nativeConcurrent);
      if (nativeStarts === MAXIMUM_CONCURRENT_NATIVE_FALLBACKS) {
        nativeCapacityReached.resolve(undefined);
      }
      await nativeRelease.promise;
      nativeConcurrent -= 1;
      return { stdout: `${nativeStarts}\n`, stderr: "" };
    },
  });
  const transport = new OmarchyAttentionTransport({
    direct,
    notification,
    onFailure: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      if (message.includes("capacity was exhausted")) capacityExhausted.resolve(undefined);
      if (message.includes("after ambiguous direct delivery")) retryDisplaced.resolve(undefined);
    },
  });
  const enqueue = (serial: number) =>
    transport.handle(
      {
        type: "tool_approval_requested",
        sessionId: "session-capacity",
        toolCallId: `tool-capacity-${serial}`,
        toolName: "bash",
        approvalMode: "write",
      },
      { ...context, sessionId: "session-capacity" },
    );
  await enqueue(0);
  await flushMicrotasks();
  for (let serial = 1; serial <= 68; serial += 1) await enqueue(serial);
  await nativeCapacityReached.promise;
  directRelease.resolve(undefined);
  await capacityExhausted.promise;
  for (let serial = 69; serial < 133; serial += 1) await enqueue(serial);
  await retryDisplaced.promise;
  assert.equal(nativeStarts, MAXIMUM_CONCURRENT_NATIVE_FALLBACKS);
  assert.equal(maximumNativeConcurrent, MAXIMUM_CONCURRENT_NATIVE_FALLBACKS);
  nativeRelease.resolve(undefined);
  await transport.close();
});
test("close drains an enqueued session shutdown before transport teardown", async () => {
  const direct = new FakeDirectTransport();

  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => false,
  });
  const transport = new OmarchyAttentionTransport({ direct, notification });
  await transport.handle(
    { type: "session_shutdown" },
    { ...context, sessionId: "session-shutdown" },
  );
  await transport.close();
  assert.deepEqual(
    direct.sent.map((event) => event.classification),
    ["session_shutdown"],
  );
});

test("ambiguous post-write delivery retries without native fallback", async () => {
  const direct = new FakeDirectTransport();
  direct.failure = new OmpDirectDeliveryError(
    "acceptance-unknown",
    "simulated acknowledgement loss",
  );
  const calls: Array<{ command: string; args: string[] }> = [];
  const notification = new OmarchyNotificationTransport({
    availabilityCheck: async () => true,
    commandRunner: async (command, args) => {
      calls.push({ command, args: [...args] });
      return { stdout: "", stderr: "" };
    },
  });
  const failures: unknown[] = [];
  const transport = new OmarchyAttentionTransport({
    direct,
    notification,
    onFailure: (error) => failures.push(error),
  });
  await transport.handle(
    {
      type: "tool_approval_requested",
      sessionId: "session-1",
      toolCallId: "tool-ambiguous",
      toolName: "bash",
      approvalMode: "write",
    },
    context,
  );
  await transport.close();
  assert.equal(direct.sent.length, 3);
  assert.deepEqual(calls, []);
  assert.equal(failures.length, 0);
});

test("direct resolution closes a prior native fallback without a new notice", async () => {
  const direct = new FakeDirectTransport();
  direct.failure = new OmpDirectDeliveryError("definitely-not-accepted", "offline");
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
