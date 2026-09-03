import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkerDirectMessage,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRevocation,
  type FocusTarget,
} from "../src/worker-direct-message.js";
import {
  FocusCoordinator,
  type FocusCoordinatorOptions,
} from "../src/notification-worker/focus/focus-coordinator.js";
import {
  HyprlandFootSurfaceController,
  markerTitleFor,
} from "../src/notification-worker/focus/hyprland-foot-surface-controller.js";
import { FocusRegistrationError } from "../src/notification-worker/focus/types.js";

type Client = { address: string; class: string; title: string };
type TmuxState = {
  socketPath: string;
  sessionId: string;
  clientName: string;
  paneId: string;
  address: string;
  setTitles: string;
  titleString: string;
  explicitSetTitles: boolean;
  explicitTitleString: boolean;
};

const HANDLES = {
  herdr: "H".repeat(32),
  "direct-terminal": "D".repeat(32),
  tmux: "T".repeat(32),
} as const;
const GENERATIONS = {
  herdr: "I".repeat(32),
  "direct-terminal": "E".repeat(32),
  tmux: "U".repeat(32),
} as const;
const DIRECT_MARKER = "M".repeat(32);

class NativeHarness {
  readonly clients: Client[] = [
    { address: "0x101", class: "foot", title: "herdr-original" },
    { address: "0x202", class: "foot", title: "direct-original" },
    { address: "0x303", class: "footclient", title: "tmux-original" },
  ];
  readonly tmux: TmuxState = {
    socketPath: "/run/user/1000/tmux.sock",
    sessionId: "$0",
    clientName: "/dev/pts/7",
    paneId: "%0",
    address: "0x303",
    setTitles: "off",
    titleString: "tmux-original",
    explicitSetTitles: true,
    explicitTitleString: true,
  };
  herdrPane = "w1:p1";
  activeAddress = "0x101";
  nativeCalls = 0;
  tmuxClientOutput = `${this.tmux.clientName}\n`;
  duplicateHerdrTitle = false;
  herdrClearCalls = 0;
  failTmuxTitleWrite = false;
  innerConfirmationMutation: (() => void) | undefined;
  outerMutation: (() => void) | undefined;
  activeWindowConfirmationMutation: (() => void) | undefined;
  deferredPaneCurrent: Promise<void> | undefined;
  clientQueryCount = 0;
  stalledClientQuery = 0;
  clientQueryGate: Promise<void> | undefined;

  readonly options: FocusCoordinatorOptions = {
    randomToken: tokenFactory(),
    herdrRequest: async (_socketPath, method, params) => {
      this.nativeCalls += 1;
      if (method === "pane.current") {
        await this.deferredPaneCurrent;
        return { type: "pane_current", pane: { pane_id: String(params.caller_pane_id) } };
      }
      if (method === "client.window_title.set") {
        const client = this.client("0x101");
        const title = String(params.title);
        const changed = client.title !== title;
        client.title = title;
        if (this.duplicateHerdrTitle) this.client("0x202").title = title;
        return { type: "client_window_title", changed, reason: "set" };
      }
      if (method === "client.window_title.clear") {
        this.herdrClearCalls += 1;
        this.client("0x101").title = "herdr-original";
        return { type: "client_window_title", changed: true, reason: "clear" };
      }
      if (method === "pane.focus") {
        this.herdrPane = String(params.pane_id);
        return { type: "pane_focused" };
      }
      if (method === "session.snapshot") {
        const focusedPaneId = this.herdrPane;
        const mutation = this.innerConfirmationMutation;
        this.innerConfirmationMutation = undefined;
        mutation?.();
        return {
          type: "session_snapshot",
          snapshot: { focused_pane_id: focusedPaneId },
        };
      }
      throw new Error("unexpected Herdr call");
    },
    hyprctlRequest: async (_instance, args) => {
      this.nativeCalls += 1;
      if (args[0] === "-j" && args[1] === "clients") {
        this.clientQueryCount += 1;
        if (this.clientQueryCount === this.stalledClientQuery) await this.clientQueryGate;
        return this.clients.map((client) => ({ ...client }));
      }
      if (args[0] === "dispatch") {
        const match = String(args[1]).match(/address:(0x[0-9a-f]+)/i);
        assert.ok(match);
        this.activeAddress = match[1]!;
        this.outerMutation?.();
        return null;
      }
      if (args[0] === "-j" && args[1] === "activewindow") {
        const client = this.client(this.activeAddress);
        const active = { address: client.address, class: client.class, title: client.title };
        const mutation = this.activeWindowConfirmationMutation;
        this.activeWindowConfirmationMutation = undefined;
        mutation?.();
        return active;
      }
      throw new Error("unexpected hyprctl call");
    },
    tmuxRequest: async (socketPath, args) => {
      this.nativeCalls += 1;
      assert.equal(socketPath, this.tmux.socketPath);
      const command = args[0];
      if (command === "display-message" && args.includes("#{session_id}")) {
        return `${this.tmux.sessionId}\n`;
      }
      if (command === "list-clients") return this.tmuxClientOutput;
      if (command === "show-options") {
        const option = args.at(-1);
        const explicit = args.includes("-q") && !args.includes("-qv");
        const valueOnly = args.includes("-qv");
        if (option === "set-titles") {
          if (explicit) return this.tmux.explicitSetTitles ? "set-titles\n" : "";
          if (valueOnly) return this.tmux.explicitSetTitles ? `${this.tmux.setTitles}\n` : "";
          return `${this.tmux.setTitles}\n`;
        }
        if (option === "set-titles-string") {
          if (explicit) return this.tmux.explicitTitleString ? "set-titles-string\n" : "";
          if (valueOnly) return this.tmux.explicitTitleString ? `${this.tmux.titleString}\n` : "";
          return `${this.tmux.titleString}\n`;
        }
      }
      if (command === "set-option") {
        const unset = args.includes("-u");
        const optionIndex = unset ? args.indexOf("-t") + 2 : args.indexOf("-t") + 2;
        const option = args[optionIndex];
        const value = args[optionIndex + 1];
        if (option === "set-titles") {
          this.tmux.explicitSetTitles = !unset;
          this.tmux.setTitles = unset ? "on" : String(value);
        } else if (option === "set-titles-string") {
          if (this.failTmuxTitleWrite && !unset) throw new Error("tmux title write failed");
          this.tmux.explicitTitleString = !unset;
          this.tmux.titleString = unset ? "#{host}:#{window_index}" : String(value);
          this.client(this.tmux.address).title = unset ? "tmux-inherited" : String(value);
        } else {
          throw new Error("unexpected tmux option");
        }
        return "";
      }
      if (command === "switch-client") {
        this.tmux.paneId = String(args.at(-1));
        return "";
      }
      if (command === "display-message" && args.includes("#{pane_id}")) {
        const paneId = this.tmux.paneId;
        const mutation = this.innerConfirmationMutation;
        this.innerConfirmationMutation = undefined;
        mutation?.();
        return `${paneId}\n`;
      }
      throw new Error(`unexpected tmux command ${String(command)}`);
    },
    socketValidator: async () => undefined,
    sleep: async () => undefined,
    monotonicNow: (() => {
      let now = 0;
      return () => (now += 25);
    })(),
  };

  registration(
    kind: keyof typeof HANDLES,
    suffix = "1",
    recovery?: FocusRecovery,
  ): FocusRegistration {
    if (kind === "direct-terminal") {
      this.client("0x202").title = `Aperture Focus ${DIRECT_MARKER}`;
    }
    const target: FocusTarget =
      kind === "herdr"
        ? {
            kind,
            socketPath: "/run/user/1000/herdr.sock",
            paneId: `w${suffix}:p1`,
            hyprlandInstance: "instance_1",
          }
        : kind === "direct-terminal"
          ? { kind, marker: DIRECT_MARKER, hyprlandInstance: "instance_1" }
          : {
              kind,
              socketPath: this.tmux.socketPath,
              paneId: `%${Number(suffix) - 1}`,
              hyprlandInstance: "instance_1",
            };
    return assertWorkerDirectMessage({
      schemaVersion: 4,
      type: "focus.register",
      requestId: `register-${kind}-${suffix}`,
      publicHandle: suffix === "1" ? HANDLES[kind] : token(`handle-${kind}-${suffix}`),
      hostGeneration: suffix === "1" ? GENERATIONS[kind] : token(`generation-${kind}-${suffix}`),
      target,
      ...(recovery ? { recovery } : {}),
    }) as FocusRegistration;
  }

  revoke(
    registration: FocusRegistration,
    generation = registration.hostGeneration,
  ): FocusRevocation {
    return {
      schemaVersion: 4,
      type: "focus.revoke",
      requestId: `revoke-${registration.requestId}`,
      publicHandle: registration.publicHandle,
      hostGeneration: generation,
    };
  }

  private client(address: string): Client {
    const client = this.clients.find((candidate) => candidate.address === address);
    assert.ok(client);
    return client;
  }
}

for (const [first, second] of orderedPairs(["herdr", "direct-terminal", "tmux"] as const)) {
  test(`independent ${first} then ${second} leases coexist`, async () => {
    const native = new NativeHarness();
    const coordinator = new FocusCoordinator(native.options);
    const firstRegistration = native.registration(first);
    await coordinator.register(firstRegistration);
    const secondRegistration = native.registration(second);
    await coordinator.register(secondRegistration);
    assert.ok(coordinator.navigationFor(firstRegistration.publicHandle));
    assert.ok(coordinator.navigationFor(secondRegistration.publicHandle));
    assert.equal(await coordinator.activate(firstRegistration.publicHandle), "focused");
    assert.equal(await coordinator.activate(secondRegistration.publicHandle), "focused");
    await coordinator.close();
  });
}

test("known marker ownership is scoped to exact instance address and class", async () => {
  const marker = "K".repeat(32);
  const markerTitle = markerTitleFor(marker);
  const ownership = [
    {
      backend: "herdr" as const,
      leaseKey: "herdr\u0000socket\u0000instance-A",
      epoch: "E".repeat(32),
      surface: {
        hyprlandInstance: "instance-A",
        address: "0x101",
        className: "foot" as const,
        marker,
        markerTitle,
      },
    },
  ];
  let clients: Client[] = [{ address: "0x101", class: "foot", title: markerTitle }];
  const controller = new HyprlandFootSurfaceController({
    hyprctlRequest: async () => clients.map((client) => ({ ...client })),
  });
  const signal = new AbortController().signal;
  await controller.assertNoUnknownMarkers("instance-A", ownership, signal);
  await assert.rejects(
    () => controller.assertNoUnknownMarkers("instance-B", ownership, signal),
    /unknown or duplicated/,
  );
  clients = [
    { address: "0x101", class: "foot", title: markerTitle },
    { address: "0x202", class: "foot", title: markerTitle },
  ];
  await assert.rejects(
    () => controller.assertNoUnknownMarkers("instance-A", ownership, signal),
    /unknown or duplicated/,
  );
  clients = [{ address: "0x101", class: "footclient", title: markerTitle }];
  await assert.rejects(
    () => controller.assertNoUnknownMarkers("instance-A", ownership, signal),
    /unknown or duplicated/,
  );
});

test("all three backends coexist and one mutation stays isolated", async () => {
  const native = new NativeHarness();
  const coordinator = new FocusCoordinator(native.options);
  const registrations = [
    native.registration("direct-terminal"),
    native.registration("herdr"),
    native.registration("tmux"),
  ];
  for (const registration of registrations) await coordinator.register(registration);
  native.clients.find((client) => client.address === "0x202")!.title = "external rename";
  await assert.rejects(() => coordinator.register(registrations[0]!));
  assert.equal(coordinator.navigationFor(registrations[0]!.publicHandle), undefined);
  assert.ok(coordinator.navigationFor(registrations[1]!.publicHandle));
  assert.ok(coordinator.navigationFor(registrations[2]!.publicHandle));
  assert.equal(await coordinator.activate(registrations[1]!.publicHandle), "focused");
  assert.equal(await coordinator.activate(registrations[2]!.publicHandle), "focused");
  await coordinator.close();
});

test("Herdr and tmux re-confirm their inner pane after outer focus", async () => {
  for (const kind of ["herdr", "tmux"] as const) {
    for (const timing of ["before-outer", "during-outer", "after-outer-confirm"] as const) {
      const native = new NativeHarness();
      const coordinator = new FocusCoordinator(native.options);
      const registration = native.registration(kind);
      await coordinator.register(registration);
      const mutate = (): void => {
        if (kind === "herdr") native.herdrPane = "w9:p9";
        else native.tmux.paneId = "%9";
      };
      if (timing === "before-outer") native.innerConfirmationMutation = mutate;
      else if (timing === "during-outer") native.outerMutation = mutate;
      else native.activeWindowConfirmationMutation = mutate;
      assert.equal(await coordinator.activate(registration.publicHandle), "stale");
      assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
      await coordinator.close();
    }
  }
});

test("revocation is fenced by handle and host generation", async () => {
  const native = new NativeHarness();
  const coordinator = new FocusCoordinator(native.options);
  const registration = native.registration("herdr");
  await coordinator.register(registration);
  await coordinator.revoke(native.revoke(registration, "Z".repeat(32)));
  assert.ok(coordinator.navigationFor(registration.publicHandle));
  await coordinator.revoke(native.revoke(registration));
  assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
  await coordinator.close();
});

test("registration and lease-member caps reject before native work", async () => {
  const native = new NativeHarness();
  const coordinator = new FocusCoordinator({
    ...native.options,
    limits: { activeRegistrations: 1, leaseMembers: 1, queuedOperations: 4 },
  });
  await coordinator.register(native.registration("herdr"));
  const calls = native.nativeCalls;
  await assert.rejects(
    () => coordinator.register(native.registration("tmux")),
    (error: unknown) => error instanceof FocusRegistrationError && error.code === "capacity",
  );
  assert.equal(native.nativeCalls, calls);
  await coordinator.close();

  const sharedNative = new NativeHarness();
  const shared = new FocusCoordinator({
    ...sharedNative.options,
    limits: { activeRegistrations: 4, leaseMembers: 1, queuedOperations: 4 },
  });
  await shared.register(sharedNative.registration("herdr", "1"));
  const sharedCalls = sharedNative.nativeCalls;
  await assert.rejects(
    () => shared.register(sharedNative.registration("herdr", "2")),
    (error: unknown) => error instanceof FocusRegistrationError && error.code === "capacity",
  );
  assert.equal(sharedNative.nativeCalls, sharedCalls);
  await shared.close();
});

test("focus operation queue rejects cap plus one before native dispatch", async () => {
  const native = new NativeHarness();
  let release!: () => void;
  native.deferredPaneCurrent = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new FocusCoordinator({
    ...native.options,
    limits: { activeRegistrations: 4, leaseMembers: 4, queuedOperations: 1 },
  });
  const pending = coordinator.register(native.registration("herdr"));
  await flushMicrotasks();
  const calls = native.nativeCalls;
  await assert.rejects(
    () => coordinator.register(native.registration("tmux")),
    (error: unknown) => error instanceof FocusRegistrationError && error.code === "capacity",
  );
  assert.equal(native.nativeCalls, calls);
  release();
  await pending;
  await coordinator.close();
});

test("aborted registration cannot commit after native completion", async () => {
  const native = new NativeHarness();
  let release!: () => void;
  native.deferredPaneCurrent = new Promise<void>((resolve) => (release = resolve));
  const coordinator = new FocusCoordinator(native.options);
  const registration = native.registration("herdr");
  const controller = new AbortController();
  const pending = coordinator.register(registration, controller.signal);
  await Promise.resolve();
  controller.abort();
  release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
  await coordinator.close();
});

test("aborted Herdr acquisition retains its marker instead of unsafe clear", async () => {
  const native = new NativeHarness();
  let release!: () => void;
  native.stalledClientQuery = 2;
  native.clientQueryGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new FocusCoordinator(native.options);
  const registration = native.registration("herdr");
  const controller = new AbortController();
  const pending = coordinator.register(registration, controller.signal);
  await flushMicrotasks();
  assert.match(native.clients[0]!.title, /^Aperture Focus /);
  controller.abort();
  release();
  await assert.rejects(pending);
  assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
  assert.match(native.clients[0]!.title, /^Aperture Focus /);
  assert.equal(native.herdrClearCalls, 0);
  await coordinator.close();
});

test("aborted tmux acquisition restores original options without late commit", async () => {
  const native = new NativeHarness();
  let release!: () => void;
  native.stalledClientQuery = 2;
  native.clientQueryGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new FocusCoordinator(native.options);
  const registration = native.registration("tmux");
  const controller = new AbortController();
  const pending = coordinator.register(registration, controller.signal);
  await flushUntil(() => /^Aperture Focus /.test(native.tmux.titleString));
  assert.equal(native.tmux.setTitles, "on");
  assert.match(native.tmux.titleString, /^Aperture Focus /);
  controller.abort();
  release();
  await assert.rejects(pending);
  assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
  assert.equal(native.tmux.setTitles, "off");
  assert.equal(native.tmux.titleString, "tmux-original");
  await coordinator.close();
});

test("partial tmux setup restores set-titles after title write failure", async () => {
  const native = new NativeHarness();
  native.failTmuxTitleWrite = true;
  const coordinator = new FocusCoordinator(native.options);
  const registration = native.registration("tmux");
  await assert.rejects(() => coordinator.register(registration), /title write failed/);
  assert.equal(native.tmux.setTitles, "off");
  assert.equal(native.tmux.titleString, "tmux-original");
  assert.equal(coordinator.navigationFor(registration.publicHandle), undefined);
  await coordinator.close();
});

test("Herdr worker recovery retains marker when conditional clear is unavailable", async () => {
  const native = new NativeHarness();
  const registration = native.registration("herdr");
  const crashed = new FocusCoordinator({ ...native.options, ttlMs: 1_000_000 });
  const recovery = await crashed.register(registration);
  assert.equal(recovery?.kind, "herdr");
  if (!recovery || recovery.kind !== "herdr") throw new Error("missing Herdr recovery");
  assert.match(native.clients[0]!.title, /^Aperture Focus /);

  const restarted = new FocusCoordinator(native.options);
  await restarted.register({ ...registration, requestId: "recovered-herdr", recovery });
  await restarted.revoke(native.revoke(registration));
  assert.match(native.clients[0]!.title, /^Aperture Focus /);
  assert.equal(native.herdrClearCalls, 0);
  await restarted.close();
});

test("Herdr release never clears a newly foregrounded client", async () => {
  const native = new NativeHarness();
  const registration = native.registration("herdr");
  const coordinator = new FocusCoordinator(native.options);
  await coordinator.register(registration);
  native.clients[1]!.title = "user-owned-second-client";
  await coordinator.revoke(native.revoke(registration));
  assert.match(native.clients[0]!.title, /^Aperture Focus /);
  assert.equal(native.clients[1]!.title, "user-owned-second-client");
  assert.equal(native.herdrClearCalls, 0);
  await coordinator.close();
});

test("tmux worker crash recovery restores true original options and title", async () => {
  const native = new NativeHarness();
  const registration = native.registration("tmux");
  const crashed = new FocusCoordinator({ ...native.options, ttlMs: 1_000_000 });
  const recovery = await crashed.register(registration);
  assert.equal(recovery?.kind, "tmux");
  if (!recovery || recovery.kind !== "tmux") throw new Error("missing tmux recovery");
  assert.equal(native.tmux.setTitles, "on");
  assert.match(native.tmux.titleString, /^Aperture Focus /);

  const restarted = new FocusCoordinator(native.options);
  await restarted.register({ ...registration, requestId: "recovered-tmux", recovery });
  await restarted.revoke(native.revoke(registration));
  assert.equal(native.tmux.setTitles, "off");
  assert.equal(native.tmux.titleString, "tmux-original");
  assert.equal(native.clients[2]!.title, "tmux-original");
  await restarted.close();
});

test("unknown orphan marker blocks fresh native acquisition but not its exact direct owner", async () => {
  const native = new NativeHarness();
  native.clients[1]!.title = `Aperture Focus ${DIRECT_MARKER}`;
  const coordinator = new FocusCoordinator(native.options);
  await assert.rejects(() => coordinator.register(native.registration("herdr")), /unknown.*marker/);
  const direct = native.registration("direct-terminal");
  await coordinator.register(direct);
  assert.ok(coordinator.navigationFor(direct.publicHandle));
  await coordinator.close();
});

test("unsupported and ambiguous native detector matrix remains fail-closed", async () => {
  for (const tmuxClientOutput of ["", "/dev/pts/7\n/dev/pts/8\n", "/dev/pts/7\n/dev/pts/7\n"]) {
    const native = new NativeHarness();
    native.tmuxClientOutput = tmuxClientOutput;
    const coordinator = new FocusCoordinator(native.options);
    await assert.rejects(() => coordinator.register(native.registration("tmux")));
    await coordinator.close();
  }

  const unsupported = new NativeHarness();
  unsupported.clients[1]!.class = "kitty";
  const unsupportedCoordinator = new FocusCoordinator(unsupported.options);
  await assert.rejects(
    () => unsupportedCoordinator.register(unsupported.registration("direct-terminal")),
    (error: unknown) =>
      error instanceof FocusRegistrationError && error.code === "unsupported_terminal_owned",
  );
  await unsupportedCoordinator.close();

  const ambiguous = new NativeHarness();
  const direct = ambiguous.registration("direct-terminal");
  ambiguous.clients.push({
    address: "0x404",
    class: "foot",
    title: `Aperture Focus ${DIRECT_MARKER}`,
  });
  const ambiguousCoordinator = new FocusCoordinator(ambiguous.options);
  await assert.rejects(
    () => ambiguousCoordinator.register(direct),
    (error: unknown) =>
      error instanceof FocusRegistrationError && error.code === "marker_ambiguous",
  );
  await ambiguousCoordinator.close();

  const multipleHerdr = new NativeHarness();
  multipleHerdr.duplicateHerdrTitle = true;
  const herdrCoordinator = new FocusCoordinator(multipleHerdr.options);
  await assert.rejects(() => herdrCoordinator.register(multipleHerdr.registration("herdr")));
  await herdrCoordinator.close();
});

function orderedPairs<const T extends readonly string[]>(values: T): Array<[T[number], T[number]]> {
  const result: Array<[T[number], T[number]]> = [];
  for (const first of values) {
    for (const second of values) {
      if (first !== second) result.push([first, second]);
    }
  }
  return result;
}

function token(seed: string): string {
  return seed
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .padEnd(32, "X")
    .slice(0, 32);
}

function tokenFactory(): () => string {
  let serial = 0;
  return () => token(`token-${serial++}`);
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 128; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("focus test condition did not settle within the microtask bound");
}
