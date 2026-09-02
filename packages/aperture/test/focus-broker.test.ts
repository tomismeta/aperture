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
  overrides: Partial<OmpFocusRegistration> & {
    paneId?: string;
    socketPath?: string;
    hyprlandInstance?: string;
  } = {},
): OmpFocusRegistration {
  const {
    paneId = "w2:p1",
    socketPath = "/run/user/1000/herdr.sock",
    hyprlandInstance = "instance_1",
    ...common
  } = overrides;
  return assertOmpDirectMessage({
    schemaVersion: 3,
    type: "omp.focus.register",
    requestId: "request-1",
    publicHandle: handleA,
    hostGeneration: generationA,
    target: { kind: "herdr", socketPath, paneId, hyprlandInstance },
    ...common,
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
      return {
        type: "session_snapshot",
        snapshot: { focused_pane_id: focusedPane },
      };
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
  await broker.revoke({ schemaVersion: 3, type: "omp.focus.revoke", requestId: "close-a",
  publicHandle: handleA,
  hostGeneration: generationA, });
  assert.equal(clearCount, 0);
  assert.equal(await broker.activate(handleB), "focused");
  await broker.revoke({ schemaVersion: 3, type: "omp.focus.revoke", requestId: "close-b",
  publicHandle: handleB,
  hostGeneration: generationB, });
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
      return {
        type: "session_snapshot",
        snapshot: { focused_pane_id: String(params.pane_id ?? "w2:p1") },
      };
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
          void broker.revoke({ schemaVersion: 3, type: "omp.focus.revoke", requestId: "mid-activation",
          publicHandle: handleA,
          hostGeneration: generationA, });
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
      return {
        type: "session_snapshot",
        snapshot: { focused_pane_id: "w2:p1" },
      };
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
  const opaqueTarget = registration({ paneId: "wA:p1" }).target;
  assert.equal(opaqueTarget.kind, "herdr");
  assert.equal(opaqueTarget.kind === "herdr" ? opaqueTarget.paneId : undefined, "wA:p1");
  for (const paneId of ["", "w:p1", "wA:p", "wA:p1\n", "/tmp/wA:p1", `w${"a".repeat(31)}:p1`]) {
    assert.throws(() => registration({ paneId }), /pane context/);
  }
  assert.throws(
    () => assertOmpDirectMessage({ ...registration(), marker: "A".repeat(32) }),
    /fields/,
  );
  assert.throws(() => registration({ socketPath: "relative.sock" }), /socket context/);
  assert.throws(() => registration({ paneId: "bad-pane" }), /pane context/);
  assert.throws(() => registration({ hyprlandInstance: "bad address" }), /compositor context/);
  assert.throws(() => registration({ publicHandle: "short" }), /public focus handle/);
  assert.throws(
    () => assertOmpDirectMessage({ ...registration(), schemaVersion: 2 }),
    /schema version/,
  );
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
      return {
        type: "session_snapshot",
        snapshot: { focused_pane_id: "w2:p1" },
      };
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
    await broker.revoke({ schemaVersion: 3, type: "omp.focus.revoke", requestId: `churn-revoke-${index}`,
    publicHandle: handleA,
    hostGeneration: generationA, });
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
    const stages: string[] = [];
    let broker: FocusBroker;
    const options: FocusBrokerOptions = {
      randomToken: tokenFactory(),
      monotonicNow: () => clock,
      onDiagnostic: (stage) => stages.push(stage),
      sleep: async () => {
        clock += 25;
        if (mode === "cancel") {
          void broker.revoke({ schemaVersion: 3, type: "omp.focus.revoke", requestId: "cancel-during-confirmation",
          publicHandle: handleA,
          hostGeneration: generationA, });
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
        if (method === "session.snapshot") {
          return {
            type: "session_snapshot",
            snapshot: { focused_pane_id: "w2:p1" },
          };
        }
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
    assert.deepEqual(stages.slice(0, 5), [
      "resolve-pane",
      "lease-before-focus",
      "pane-focus",
      "pane-snapshot",
      "dispatch",
    ]);
    assert.equal(
      stages.includes("active-confirm-timeout"),
      mode === "never",
    );
    const renderedStages = JSON.stringify(stages);
    for (const privateValue of [
      handleA,
      client.address,
      client.title,
      "/run/user/1000/herdr.sock",
    ]) {
      assert.equal(renderedStages.includes(privateValue), false);
    }
    assert.equal(activeQueries, mode === "eventual" ? 2 : mode === "cancel" ? 1 : 41);
    await broker.close();
  }
});

test("session snapshot requires the strict nested Herdr envelope", async () => {
  const malformed = [
    { focused_pane_id: "w2:p1" },
    { type: "snapshot", snapshot: { focused_pane_id: "w2:p1" } },
    {
      type: "session_snapshot",
      snapshot: { focused_pane_id: "w2:p1" },
      extra: true,
    },
  ];
  for (const snapshotResult of malformed) {
    const client = { address: "0xabc", class: "foot", title: "initial" };
    const broker = new FocusBroker({
      randomToken: tokenFactory(),
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
        if (method === "session.snapshot") return snapshotResult;
        return { type: "pane_focus", changed: true };
      },
      hyprctlRequest: async (_instance, args) =>
        args[1] === "clients" ? [client] : client,
    });
    await broker.register(registration());
    assert.equal(await broker.activate(handleA), "stale");
    assert.equal(broker.navigationFor(handleA), undefined);
    await broker.close();
  }
});

test("direct Foot backend performs only exact outer focus and worker never reasserts title", async () => {
  const marker = "C".repeat(32);
  const client = { address: "0xabc", class: "foot", title: `Aperture Focus ${marker}` };
  let herdrCalls = 0;
  const broker = new FocusBroker({
    randomToken: tokenFactory(),
    herdrRequest: async () => {
      herdrCalls += 1;
      throw new Error("unexpected inner action");
    },
    hyprctlRequest: async (_instance, args) => {
      if (args[1] === "clients") return [client];
      if (args[1] === "activewindow") return client;
      return null;
    },
  });
  const direct = assertOmpDirectMessage({
    schemaVersion: 3,
    type: "omp.focus.register",
    requestId: "foot",
    publicHandle: handleA,
    hostGeneration: generationA,
    target: { kind: "direct-foot", marker, hyprlandInstance: "instance_1" },
  }) as OmpFocusRegistration;
  await broker.register(direct);
  assert.equal(await broker.activate(handleA), "focused");
  assert.equal(herdrCalls, 0);
  client.title = "lost";
  await assert.rejects(() => broker.register({ ...direct, requestId: "lost" }));
  assert.equal(broker.navigationFor(handleA), undefined);
  assert.equal(await broker.activate(handleA), "missing");
  await broker.close();
});

test("tmux backend uses fixed commands, shares refcount, focuses pane, and CAS restores", async () => {
  const socketPath = "/run/user/1000/tmux.sock";
  const client = { address: "0xabc", class: "foot", title: "old" };
  let titleString = "";
  let setTitles = "off";
  let explicitSetTitles = false;
  let explicitTitleString = true;
  let focusedPane = "%0";
  let tmuxClientName = "/dev/pts/3";
  const commands: string[][] = [];
  const tmuxRequest = async (socket: string, args: string[]): Promise<string> => {
    assert.equal(socket, socketPath);
    commands.push([...args]);
    const command = args[0];
    if (command === "display-message" && args.includes("#{session_id}")) return "$0\n";
    if (command === "list-clients") return `${tmuxClientName}\t$0\n`;
    if (command === "show-options") {
      const option = args.at(-1);
      const value = option === "set-titles" ? setTitles : titleString;
      const explicit = option === "set-titles" ? explicitSetTitles : explicitTitleString;
      if (args.includes("-qv")) return explicit ? `${value}\n` : "";
      if (args.includes("-q")) {
        if (!explicit) return "";
        const presentation = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        return `${option} "${presentation}"\n`;
      }
      return `${value}\n`;
    }
    if (command === "set-option") {
      const option = args.includes("set-titles-string")
        ? "set-titles-string"
        : "set-titles";
      if (args.includes("-u")) {
        if (option === "set-titles") {
          explicitSetTitles = false;
          setTitles = "off";
        } else {
          explicitTitleString = false;
          titleString = "old";
          client.title = titleString;
        }
        return "";
      }
      const value = args.at(-1)!;
      if (option === "set-titles") {
        explicitSetTitles = true;
        setTitles = value;
      } else {
        explicitTitleString = true;
        titleString = value;
        client.title = titleString;
      }
      return "";
    }
    if (command === "switch-client") {
      focusedPane = args.at(-1)!;
      return "";
    }
    if (command === "display-message" && args.includes("#{pane_id}")) {
      return `${focusedPane}\n`;
    }
    throw new Error("unexpected tmux argv");
  };
  const broker = new FocusBroker({
    randomToken: tokenFactory(),
    tmuxRequest,
    socketValidator: async () => undefined,
    hyprctlRequest: async (_instance, args) =>
      args[1] === "clients" ? [client] : args[1] === "activewindow" ? client : null,
  });
  const target = { kind: "tmux" as const, socketPath, paneId: "%0", hyprlandInstance: "instance_1" };
  const first = assertOmpDirectMessage({
    schemaVersion: 3, type: "omp.focus.register", requestId: "tmux-1",
    publicHandle: handleA, hostGeneration: generationA, target,
  }) as OmpFocusRegistration;
  const second = assertOmpDirectMessage({
    schemaVersion: 3, type: "omp.focus.register", requestId: "tmux-2",
    publicHandle: handleB, hostGeneration: generationB, target: { ...target, paneId: "%2" },
  }) as OmpFocusRegistration;
  await broker.register(first);
  const markerTitle = titleString;
  await broker.register(second);
  assert.equal(titleString, markerTitle);
  assert(
    commands
      .filter((args) => args[0] === "show-options" || args[0] === "set-option")
      .every((args) => args.includes("-t") && args.includes("$0") && !args.includes("-g")),
  );
  assert.equal(await broker.activate(handleB), "focused");
  assert.equal(focusedPane, "%2");
  await broker.revoke({
    schemaVersion: 3, type: "omp.focus.revoke", requestId: "revoke-1",
    publicHandle: handleA, hostGeneration: generationA,
  });
  assert.equal(titleString, markerTitle);
  await broker.revoke({
    schemaVersion: 3, type: "omp.focus.revoke", requestId: "revoke-2",
    publicHandle: handleB, hostGeneration: generationB,
  });
  assert.equal(titleString, "");
  assert.equal(setTitles, "off");
  assert(commands.every((args) => ["display-message", "list-clients", "show-options", "set-option", "switch-client"].includes(args[0]!)));
  const quotedTitle = ` # "quoted" \\ #{pane_id} `;
  titleString = quotedTitle;
  explicitTitleString = true;
  client.title = "old";
  await broker.register({ ...first, requestId: "tmux-quoted" });
  await broker.revoke({
    schemaVersion: 3,
    type: "omp.focus.revoke",
    requestId: "revoke-quoted",
    publicHandle: handleA,
    hostGeneration: generationA,
  });
  assert.equal(titleString, quotedTitle);
  await broker.register({ ...first, requestId: "tmux-client-replacement" });
  tmuxClientName = "/dev/pts/4";
  await assert.rejects(() =>
    broker.register({ ...first, requestId: "tmux-client-changed" }),
  );
  assert.equal(broker.navigationFor(handleA), undefined);
  tmuxClientName = "/dev/pts/3";
  await broker.register({ ...first, requestId: "tmux-mutation" });
  setTitles = "off";
  await assert.rejects(() =>
    broker.register({ ...first, requestId: "tmux-title-loss" }),
  );
  assert.equal(broker.navigationFor(handleA), undefined);
  await broker.revoke({
    schemaVersion: 3,
    type: "omp.focus.revoke",
    requestId: "revoke-mutation",
    publicHandle: handleA,
    hostGeneration: generationA,
  });
  assert.equal(setTitles, "off");
  assert.equal(titleString.startsWith("Aperture Focus "), true);
  await broker.close();
});

test("tmux backend rejects detached, multiple, and malformed client output", async () => {
  for (const clientsOutput of [
    "",
    "client0\t$1\nclient1\t$1\n",
    "malformed-without-session\n",
  ]) {
    const broker = new FocusBroker({
      randomToken: tokenFactory(),
      socketValidator: async () => undefined,
      tmuxRequest: async (_socket, args) => {
        if (args[0] === "display-message") return "$1\n";
        if (args[0] === "list-clients") return clientsOutput;
        throw new Error("unexpected tmux continuation");
      },
      hyprctlRequest: async () => {
        throw new Error("tmux rejection must precede compositor access");
      },
    });
    const message = assertOmpDirectMessage({
      schemaVersion: 3,
      type: "omp.focus.register",
      requestId: "tmux-reject",
      publicHandle: handleA,
      hostGeneration: generationA,
      target: {
        kind: "tmux",
        socketPath: "/run/user/1000/tmux.sock",
        paneId: "%1",
        hyprlandInstance: "instance_1",
      },
    }) as OmpFocusRegistration;
    await assert.rejects(() => broker.register(message));
    assert.equal(broker.navigationFor(handleA), undefined);
    await broker.close();
  }
});
