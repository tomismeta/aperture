import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOmpDirectMessage,
  type OmpFocusRegistration,
} from "../src/omp-direct-message.js";
import {
  FocusBroker,
  type FocusBrokerOptions,
} from "../src/notification-worker/focus-broker.js";

const generationA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const generationB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const handleA = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const handleB = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

function registration(
  overrides: Partial<OmpFocusRegistration> = {},
): OmpFocusRegistration {
  return assertOmpDirectMessage({
    schemaVersion: 2,
    type: "omp.focus.register",
    requestId: "request-1",
    publicHandle: handleA,
    hostGeneration: generationA,
    herdrSocketPath: "/run/user/1000/herdr.sock",
    paneId: "w2:p1",
    compositorAddress: "instance_1",
    ...overrides,
  }) as OmpFocusRegistration;
}

function tokenFactory(): () => string {
  let value = 0;
  return () => `${String.fromCharCode(65 + (value++ % 26))}`.repeat(32);
}

test("worker lease keeps two authoritative panes focusable and clears after the final owner", async () => {
  const clients = [{ address: "0xabc", class: "foot", title: "shape: dev" }];
  let focusedPane = "w1:p1";
  let activeAddress = "0xabc";
  let clearCount = 0;
  let setCount = 0;
  const dispatches: string[] = [];
  const invalidated: string[] = [];
  const options: FocusBrokerOptions = {
    randomToken: tokenFactory(),
    onInvalidated: (handle) => invalidated.push(handle),
    herdrRequest: async (_socket, method, params) => {
      if (method === "pane.current") {
        const caller = String(params.caller_pane_id);
        return {
          type: "pane_current",
          pane: { pane_id: caller === "w2:p1" ? "w4:p3" : caller },
        };
      }
      if (method === "client.window_title.set") {
        setCount += 1;
        clients[0]!.title = String(params.title);
        return { type: "client_window_title", changed: true, reason: "set" };
      }
      if (method === "client.window_title.clear") {
        clearCount += 1;
        clients[0]!.title = "shape: dev";
        return { type: "client_window_title", changed: true, reason: "cleared" };
      }
      if (method === "pane.focus") {
        focusedPane = String(params.pane_id);
        return { type: "pane_focus", changed: true };
      }
      return { focused_pane_id: focusedPane };
    },
    hyprctlRequest: async (_instance, args) => {
      if (args[1] === "clients") return clients;
      if (args[1] === "activewindow") {
        return { ...clients[0], address: activeAddress };
      }
      const command = String(args[1]);
      dispatches.push(command);
      activeAddress = "0xabc";
      return null;
    },
  };
  const broker = new FocusBroker(options);
  await broker.register(registration());
  const stableTitle = clients[0]!.title;
  await broker.register(
    registration({
      requestId: "request-2",
      publicHandle: handleB,
      hostGeneration: generationB,
      paneId: "w3:p2",
    }),
  );
  await broker.register(registration({ requestId: "old-member-heartbeat" }));
  assert.equal(setCount, 3);
  assert.equal(clients[0]!.title, stableTitle);

  assert.equal(await broker.activate(handleA), "focused");
  assert.equal(focusedPane, "w4:p3");
  assert.equal(await broker.activate(handleB), "focused");
  await broker.revoke({
    schemaVersion: 2,
    type: "omp.focus.revoke",
    requestId: "close-a",
    publicHandle: handleA,
    hostGeneration: generationA,
  });
  assert.equal(clearCount, 0);
  assert.equal(await broker.activate(handleB), "focused");
  await broker.revoke({
    schemaVersion: 2,
    type: "omp.focus.revoke",
    requestId: "close-b",
    publicHandle: handleB,
    hostGeneration: generationB,
  });
  assert.equal(clearCount, 1);
  assert(invalidated.includes(handleA));
  assert(invalidated.includes(handleB));
  assert(dispatches.every((value) => value.includes('address:0xabc')));
  await broker.close();

  clients[0]!.title = "shape: dev";
  const restarted = new FocusBroker({ ...options, randomToken: tokenFactory() });
  await restarted.register(registration({ requestId: "restart-heartbeat" }));
  assert.deepEqual(restarted.navigationFor(handleA), {
    kind: "opaque-focus",
    handle: handleA,
  });
  await restarted.close();
});

test("a second Foot client on one Herdr context invalidates and blocks rebind", async () => {
  const clients = [
    { address: "0xaaa", class: "foot", title: "first" },
    { address: "0xbbb", class: "footclient", title: "second" },
  ];
  let foreground = 0;
  let now = 1_000;
  const options: FocusBrokerOptions = {
    now: () => now,
    randomToken: tokenFactory(),
    herdrRequest: async (_socket, method, params) => {
      if (method === "pane.current") {
        return { type: "pane_current", pane: { pane_id: params.caller_pane_id } };
      }
      if (method === "client.window_title.set") {
        clients[foreground]!.title = String(params.title);
        return { type: "client_window_title", changed: true, reason: "set" };
      }
      if (method === "client.window_title.clear") {
        clients[foreground]!.title = foreground === 0 ? "first" : "second";
        return { type: "client_window_title", changed: true, reason: "cleared" };
      }
      return { focused_pane_id: String(params.pane_id ?? "w2:p1") };
    },
    hyprctlRequest: async (_instance, args) =>
      args[1] === "clients" ? clients : { ...clients[foreground] },
  };
  const broker = new FocusBroker(options);
  await broker.register(registration());
  const oldMarker = clients[0]!.title;
  foreground = 1;
  await assert.rejects(() =>
    broker.register(
      registration({
        requestId: "second-client",
        publicHandle: handleB,
        hostGeneration: generationB,
        paneId: "w3:p2",
      }),
    ),
  );
  assert.equal(broker.navigationFor(handleA), undefined);
  assert.equal(broker.navigationFor(handleB), undefined);
  await assert.rejects(() => broker.register(registration({ requestId: "blocked" })));
  clients[0]!.title = "first";
  clients[1]!.title = "second";
  assert.notEqual(clients[0]!.title, oldMarker);
  foreground = 0;
  now += 60_001;
  await broker.register(registration({ requestId: "unblocked" }));
  assert.deepEqual(broker.navigationFor(handleA), {
    kind: "opaque-focus",
    handle: handleA,
  });
  await broker.close();
});

test("revocation during pane confirmation fences compositor dispatch and focused result", async () => {
  const client = { address: "0xabc", class: "foot", title: "initial" };
  let dispatchCount = 0;
  let broker: FocusBroker;
  const options: FocusBrokerOptions = {
    randomToken: tokenFactory(),
    herdrRequest: async (_socket, method, params) => {
      if (method === "pane.current") {
        if (String(params.caller_pane_id) === "w2:p1" && broker.navigationFor(handleA)) {
          void broker.revoke({
            schemaVersion: 2,
            type: "omp.focus.revoke",
            requestId: "mid-activation",
            publicHandle: handleA,
            hostGeneration: generationA,
          });
        }
        return { type: "pane_current", pane: { pane_id: params.caller_pane_id } };
      }
      if (method === "client.window_title.set") {
        client.title = String(params.title);
        return { type: "client_window_title", changed: true, reason: "set" };
      }
      if (method === "client.window_title.clear") {
        client.title = "initial";
        return { type: "client_window_title", changed: true, reason: "cleared" };
      }
      return { focused_pane_id: "w2:p1" };
    },
    hyprctlRequest: async (_instance, args) => {
      if (args[1] === "clients") return [client];
      if (args[0] === "dispatch") dispatchCount += 1;
      return client;
    },
  };
  broker = new FocusBroker(options);
  await broker.register(registration());
  assert.equal(await broker.activate(handleA), "missing");
  assert.equal(dispatchCount, 0);
  await broker.close();
});

test("private registration accepts only context references and rejects extension markers", () => {
  assert.throws(
    () => assertOmpDirectMessage({ ...registration(), marker: "A".repeat(32) }),
    /fields/,
  );
  assert.throws(() => registration({ herdrSocketPath: "relative.sock" }), /socket context/);
  assert.throws(() => registration({ paneId: "bad-pane" }), /pane context/);
  assert.throws(() => registration({ compositorAddress: "bad address" }), /compositor context/);
  assert.throws(() => registration({ publicHandle: "short" }), /public focus handle/);
});

test("title loss heartbeat removes navigation without setting or rebinding", async () => {
  const client = { address: "0xabc", class: "foot", title: "shape: dev" };
  let setCount = 0;
  let now = 1_000;
  const broker = new FocusBroker({
    now: () => now,
    randomToken: tokenFactory(),
    herdrRequest: async (_socket, method, params) => {
      if (method === "pane.current") {
        return { type: "pane_current", pane: { pane_id: params.caller_pane_id } };
      }
      if (method === "client.window_title.set") {
        setCount += 1;
        client.title = String(params.title);
        return { type: "client_window_title", changed: true, reason: "set" };
      }
      if (method === "client.window_title.clear") {
        client.title = "shape: dev";
        return { type: "client_window_title", changed: true, reason: "cleared" };
      }
      return { focused_pane_id: "w2:p1" };
    },
    hyprctlRequest: async (_instance, args) =>
      args[1] === "clients" ? [client] : client,
  });
  await broker.register(registration());
  assert.equal(setCount, 1);
  client.title = "renamed";
  await assert.rejects(() =>
    broker.register(registration({ requestId: "lost-title" })),
  );
  assert.equal(setCount, 1);
  assert.equal(broker.navigationFor(handleA), undefined);
  await assert.rejects(() =>
    broker.register(registration({ requestId: "cooldown" })),
  );
  assert.equal(setCount, 1);
  now += 60_001;
  await broker.register(registration({ requestId: "expired-tombstone" }));
  assert.equal(setCount, 2);
  for (let index = 0; index < 70; index += 1) {
    await broker.revoke({
      schemaVersion: 2,
      type: "omp.focus.revoke",
      requestId: `churn-revoke-${index}`,
      publicHandle: handleA,
      hostGeneration: generationA,
    });
    await broker.register(
      registration({ requestId: `churn-register-${index}` }),
    );
  }
  assert.deepEqual(broker.navigationFor(handleA), {
    kind: "opaque-focus",
    handle: handleA,
  });
  await broker.close();
});

test("activewindow confirmation polls, times out stale, and honors cancellation", async () => {
  for (const mode of ["eventual", "never", "cancel"] as const) {
    const client = { address: "0xabc", class: "foot", title: "initial" };
    let activeQueries = 0;
    let clock = 0;
    let broker: FocusBroker;
    const options: FocusBrokerOptions = {
      randomToken: tokenFactory(),
      monotonicNow: () => clock,
      sleep: async () => {
        clock += 25;
        if (mode === "cancel") {
          void broker.revoke({
            schemaVersion: 2,
            type: "omp.focus.revoke",
            requestId: "cancel-during-confirmation",
            publicHandle: handleA,
            hostGeneration: generationA,
          });
        }
      },
      herdrRequest: async (_socket, method, params) => {
        if (method === "pane.current") {
          return { type: "pane_current", pane: { pane_id: params.caller_pane_id } };
        }
        if (method === "client.window_title.set") {
          client.title = String(params.title);
          return { type: "client_window_title", changed: true, reason: "set" };
        }
        if (method === "client.window_title.clear") {
          client.title = "initial";
          return { type: "client_window_title", changed: true, reason: "cleared" };
        }
        if (method === "session.snapshot") return { focused_pane_id: "w2:p1" };
        return { type: "pane_focus", changed: true };
      },
      hyprctlRequest: async (_instance, args) => {
        if (args[1] === "clients") return [client];
        if (args[1] === "activewindow") {
          activeQueries += 1;
          if (mode === "eventual" && activeQueries >= 2) return client;
          return { address: "0xsource", class: "chromium", title: "Source" };
        }
        return null;
      },
    };
    broker = new FocusBroker(options);
    await broker.register(registration({ requestId: `poll-${mode}` }));
    const result = await broker.activate(handleA);
    assert.equal(
      result,
      mode === "eventual" ? "focused" : mode === "cancel" ? "missing" : "stale",
    );
    assert.equal(activeQueries, mode === "eventual" ? 2 : mode === "cancel" ? 1 : 41);
    await broker.close();
  }
});
