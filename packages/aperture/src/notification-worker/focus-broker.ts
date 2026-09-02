import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";
import { performance } from "node:perf_hooks";

import {
  assertOmpHerdrPaneId,
  type OmpFocusRegistration,
  type OmpFocusRevocation,
} from "../omp-direct-message.js";
import type { ApertureSurfaceNavigation } from "../surface/protocol.js";

const REGISTRATION_TTL_MS = 15_000;
const HERDR_CONNECT_TIMEOUT_MS = 100;
const HERDR_RESPONSE_TIMEOUT_MS = 300;
const HERDR_OUTPUT_BYTES = 64 * 1024;
const HYPRCTL_TIMEOUT_MS = 300;
const HYPRCTL_OUTPUT_BYTES = 128 * 1024;
const ACTIVATION_EXPIRY_FENCE_MS = 3_000;
const BLOCKED_CONTEXT_TTL_MS = 60_000;
const MAXIMUM_BLOCKED_CONTEXTS = 64;
const ACTIVE_WINDOW_CONFIRM_INTERVAL_MS = 25;
const ACTIVE_WINDOW_CONFIRM_TIMEOUT_MS = 1_000;
const HYPRCTL_PATH = "/usr/bin/hyprctl";
const FOOT_CLASSES: Readonly<Record<string, true>> = { foot: true, footclient: true };
const HYPRLAND_ADDRESS = /^0x[0-9a-fA-F]{1,16}$/;

export type FocusActivationResult = "focused" | "stale" | "missing";
export class FocusRegistrationError extends Error {
  constructor(
    readonly code:
      | "unsupported_terminal_owned"
      | "marker_missing"
      | "marker_ambiguous"
      | "invalid_context",
  ) {
    super("Aperture focus registration rejected");
    this.name = "FocusRegistrationError";
  }
}

export type FocusDiagnosticStage =
  | "resolve-pane"
  | "lease-before-focus"
  | "pane-focus"
  | "pane-snapshot"
  | "dispatch"
  | "active-confirm-timeout"
  | "exception";


type FootClient = { address: string; title: string; className: "foot" | "footclient" };
type TmuxSavedOption = { explicit: boolean; value: string };

type FocusClientLease = {
  contextKey: string;
  herdrSocketPath: string;
  compositorAddress: string;
  address: string;
  marker: string;
  markerTitle: string;
  epoch: string;
  backendKind: "herdr" | "direct-terminal-probe" | "tmux";
  tmux?: {
    socketPath: string;
    paneId: string;
    clientName: string;
    sessionId: string;
    originalSetTitles: TmuxSavedOption;
    originalTitleString: TmuxSavedOption;
  };
  members: Set<string>;
};

type FocusRegistrationRecord = OmpFocusRegistration & {
  authoritativePaneId: string;
  lease: FocusClientLease;
  expiresAt: number;
  expiry: NodeJS.Timeout;
};
type BlockedContext = {
  markers: Set<string>;
  expiresAt: number;
};


type HerdrRequest = (
  socketPath: string,
  method:
    | "pane.current"
    | "pane.focus"
    | "session.snapshot"
    | "client.window_title.set"
    | "client.window_title.clear",
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type HyprctlRequest = (
  compositorAddress: string,
  args: readonly string[],
) => Promise<unknown>;
type TmuxRequest = (socketPath: string, args: string[]) => Promise<string>;

export type FocusBrokerOptions = {
  now?: () => number;
  ttlMs?: number;
  randomToken?: () => string;
  herdrRequest?: HerdrRequest;
  hyprctlRequest?: HyprctlRequest;
  sleep?: (milliseconds: number) => Promise<void>;
  monotonicNow?: () => number;
  onInvalidated?: (publicHandle: string) => void;
  onDiagnostic?: (stage: FocusDiagnosticStage) => void;
  tmuxRequest?: TmuxRequest;
  socketValidator?: (socketPath: string) => Promise<void>;
};

export class FocusBroker {
  private readonly registrations = new Map<string, FocusRegistrationRecord>();
  private readonly leases = new Map<string, FocusClientLease>();
  private readonly blockedContexts = new Map<string, BlockedContext>();
  private readonly cancelledHandles = new Set<string>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly randomToken: () => string;
  private readonly herdrRequest: HerdrRequest;
  private readonly hyprctlRequest: HyprctlRequest;
  private readonly tmuxRequest: TmuxRequest;
  private readonly onInvalidated: (publicHandle: string) => void;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly socketValidator: (socketPath: string) => Promise<void>;
  private readonly monotonicNow: () => number;
  private readonly onDiagnostic: (stage: FocusDiagnosticStage) => void;
  private operationQueue = Promise.resolve();

  constructor(options: FocusBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? REGISTRATION_TTL_MS;
    this.randomToken = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    this.herdrRequest = options.herdrRequest ?? requestHerdr;
    this.hyprctlRequest = options.hyprctlRequest ?? requestHyprctl;
    this.onInvalidated = options.onInvalidated ?? (() => undefined);
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.tmuxRequest = options.tmuxRequest ?? runTmux;
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.socketValidator = options.socketValidator ?? assertOwnedHerdrSocket;
  }

  register(registration: OmpFocusRegistration): Promise<void> {
    return this.serialize(() => this.registerSerialized(registration));
  }

  revoke(revocation: OmpFocusRevocation): Promise<void> {
    this.cancelledHandles.add(revocation.publicHandle);
    return this.serialize(async () => {
      try {
        const existing = this.registrations.get(revocation.publicHandle);
        if (!existing) return;
        await this.invalidate(existing);
      } finally {
        this.cancelledHandles.delete(revocation.publicHandle);
      }
    });
  }

  navigationFor(publicHandle: string | undefined): ApertureSurfaceNavigation | undefined {
    if (!publicHandle || this.cancelledHandles.has(publicHandle)) return undefined;
    const record = this.registrations.get(publicHandle);
    if (!record) return undefined;
    if (record.expiresAt <= this.now()) {
      this.cancelledHandles.add(publicHandle);
      void this.serialize(async () => {
        try {
          await this.invalidate(record);
        } finally {
          this.cancelledHandles.delete(publicHandle);
        }
      });
      return undefined;
    }
    return { kind: "opaque-focus", handle: publicHandle };
  }

  activate(publicHandle: string): Promise<FocusActivationResult> {
    return this.serialize(() => this.activateSerialized(publicHandle));
  }

  close(): Promise<void> {
    for (const handle of this.registrations.keys()) this.cancelledHandles.add(handle);
    return this.serialize(async () => {
      for (const lease of [...this.leases.values()]) {
        for (const handle of [...lease.members]) {
          const record = this.registrations.get(handle);
          if (record) this.removeRecord(record);
        }
        await this.clearLeaseTitle(lease);
        this.leases.delete(lease.contextKey);
      }
      this.blockedContexts.clear();
      this.cancelledHandles.clear();
    });
  }

  private async registerSerialized(registration: OmpFocusRegistration): Promise<void> {
    const target = registration.target;
    if (target.kind !== "herdr") {
      await this.registerNonHerdr(registration);
      return;
    }
    const contextKey = focusContextKey(
      target.socketPath,
      target.hyprlandInstance,
    );
    await this.assertContextUnblocked(contextKey, target.hyprlandInstance);
    const authoritativePaneId = await this.resolvePane(
      target.socketPath,
      target.paneId,
    );
    const existing = this.registrations.get(registration.publicHandle);
    if (
      existing &&
      (existing.hostGeneration !== registration.hostGeneration ||
        existing.target.kind !== "herdr" ||
        existing.target.socketPath !== target.socketPath ||
        existing.target.hyprlandInstance !== target.hyprlandInstance)
    ) {
      await this.invalidate(existing);
      throw new Error("Aperture rejected a stale focus registration");
    }

    const priorLease = this.leases.get(contextKey);
    if (priorLease) {
      if (existing && existing.lease !== priorLease) {
        await this.invalidate(existing);
        throw new Error("Aperture rejected a stale focus lease");
      }
      try {
        await this.assertLease(priorLease, priorLease.epoch);
        const probe = await this.herdrRequest(
          priorLease.herdrSocketPath,
          "client.window_title.set",
          { title: priorLease.markerTitle },
        );
        if (
          probe.type !== "client_window_title" ||
          typeof probe.changed !== "boolean" ||
          probe.reason !== "set"
        ) {
          throw new Error("Herdr focus marker probe failed");
        }
        await this.assertLease(priorLease, priorLease.epoch);
      } catch {
        this.blockContext(contextKey, [priorLease.markerTitle]);
        await this.invalidateLeaseWithoutClear(priorLease);
        throw new Error("Aperture rejected a lost focus title");
      }
      if (existing) {
        existing.authoritativePaneId = authoritativePaneId;
        this.renew(existing, registration.requestId);
      } else {
        const record = this.newRecord(
          registration,
          authoritativePaneId,
          priorLease,
        );
        priorLease.members.add(registration.publicHandle);
        this.registrations.set(registration.publicHandle, record);
      }
      this.cancelledHandles.delete(registration.publicHandle);
      return;
    }

    const before = await this.listFootClients(target.hyprlandInstance);
    const foreignMarkers = before
      .filter((client) => client.title.startsWith("Aperture Focus "))
      .map((client) => client.title);
    if (foreignMarkers.length > 0) {
      this.blockContext(contextKey, foreignMarkers);
      throw new Error("Aperture rejected a foreign focus marker");
    }

    const marker = this.randomToken();
    const epoch = this.randomToken();
    if (!/^[A-Za-z0-9_-]{32}$/.test(marker) || !/^[A-Za-z0-9_-]{32}$/.test(epoch)) {
      throw new Error("Aperture focus lease entropy was invalid");
    }
    const markerTitle = `Aperture Focus ${marker}`;
    let titleSet = false;
    try {
      const titleResult = await this.herdrRequest(
        target.socketPath,
        "client.window_title.set",
        { title: markerTitle },
      );
      if (
        titleResult.type !== "client_window_title" ||
        titleResult.changed !== true ||
        titleResult.reason !== "set"
      ) {
        throw new Error("Herdr did not establish focus marker ownership");
      }
      titleSet = true;
      const clients = await this.listFootClients(target.hyprlandInstance);
      const candidate = exactMarkerClient(clients, markerTitle);
      if (!candidate) throw new Error("Aperture focus marker did not resolve uniquely");
      const unexpectedMarkers = clients
        .filter(
          (client) =>
            client.title.startsWith("Aperture Focus ") &&
            client.title !== markerTitle,
        )
        .map((client) => client.title);
      if (unexpectedMarkers.length > 0) {
        this.blockContext(contextKey, [...unexpectedMarkers, markerTitle]);
        await this.herdrRequest(
          target.socketPath,
          "client.window_title.clear",
          {},
        );
        titleSet = false;
        throw new Error("Aperture rejected multiple Herdr Foot clients");
      }
      const lease: FocusClientLease = {
        contextKey,
        herdrSocketPath: target.socketPath,
        compositorAddress: target.hyprlandInstance,
        address: candidate.address,
        marker,
        markerTitle,
        epoch,
        members: new Set<string>(),
        backendKind: "herdr",
      };
      const record = this.newRecord(registration, authoritativePaneId, lease);
      lease.members.add(registration.publicHandle);
      this.leases.set(contextKey, lease);
      this.registrations.set(registration.publicHandle, record);
      this.cancelledHandles.delete(registration.publicHandle);
    } catch {
      if (titleSet) {
        await this.clearUncommittedTitle(
          contextKey,
          target.socketPath,

          target.hyprlandInstance,
          markerTitle,
          epoch,
        );
      }
      throw new Error("Aperture rejected an invalid focus registration");
    }
  }
  private async registerNonHerdr(registration: OmpFocusRegistration): Promise<void> {
    const target = registration.target;
    if (target.kind === "herdr") throw new Error("invalid backend dispatch");
    const existing = this.registrations.get(registration.publicHandle);
    if (existing) {
      if (
        existing.hostGeneration !== registration.hostGeneration ||
        JSON.stringify(existing.target) !== JSON.stringify(target)
      ) {
        await this.invalidate(existing);
        throw new Error("Aperture rejected a stale focus registration");
      }
      try {
        if (existing.lease.backendKind === "tmux") {
          await this.assertTmuxLease(existing.lease);
          await this.assertLease(existing.lease, existing.lease.epoch);
        } else if (existing.lease.backendKind === "direct-terminal-probe") {
          const candidate = await this.resolveDirectProbe(
            existing.lease.compositorAddress,
            existing.lease.markerTitle,
          );
          if (candidate.address !== existing.lease.address) {
            throw new FocusRegistrationError("invalid_context");
          }
        } else {
          await this.assertLease(existing.lease, existing.lease.epoch);
        }
      } catch (error) {
        if (existing.lease.backendKind === "tmux") {
          await this.invalidateLease(existing.lease);
        } else {
          await this.invalidate(existing);
        }
        if (error instanceof FocusRegistrationError) throw error;
        throw new Error("Aperture rejected a lost focus target");
      }
      this.renew(existing, registration.requestId);
      this.cancelledHandles.delete(registration.publicHandle);
      return;
    }
    let marker: string;
    let markerTitle: string;
    let tmux: FocusClientLease["tmux"];
    let candidate: FootClient | undefined;
    if (target.kind === "direct-terminal-probe") {
      marker = target.marker;
      markerTitle = `Aperture Focus ${marker}`;
      candidate = await this.resolveDirectProbe(target.hyprlandInstance, markerTitle);
      const shared = [...this.leases.values()].find(
        (lease) =>
          lease.backendKind === "direct-terminal-probe" &&
          lease.compositorAddress === target.hyprlandInstance &&
          lease.marker === target.marker,
      );
      if (shared) {
        await this.assertLease(shared, shared.epoch);
        const record = this.newRecord(registration, "", shared);
        shared.members.add(registration.publicHandle);
        this.registrations.set(registration.publicHandle, record);
        this.cancelledHandles.delete(registration.publicHandle);
        return;
      }
    } else {
      const sessionId = (
        await this.tmuxRequest(target.socketPath, [
          "display-message", "-p", "-t", target.paneId, "#{session_id}",
        ])
      ).trim();
      if (!/^\$\d{1,10}$/.test(sessionId)) throw new Error("invalid tmux session");
      const clientName = await this.soleTmuxClientForSession(
        target.socketPath,
        sessionId,
      );
      const shared = [...this.leases.values()].find(
        (lease) =>
          lease.backendKind === "tmux" &&
          lease.tmux?.socketPath === target.socketPath &&
          lease.tmux.sessionId === sessionId,
      );
      if (shared) {
        if (
          shared.compositorAddress !== target.hyprlandInstance ||
          shared.tmux?.clientName !== clientName
        ) {
          await this.invalidateLease(shared);
          throw new Error("Aperture rejected changed tmux client");
        }
        await this.assertTmuxLease(shared);
        await this.assertLease(shared, shared.epoch);
        const record = this.newRecord(registration, target.paneId, shared);
        shared.members.add(registration.publicHandle);
        this.registrations.set(registration.publicHandle, record);
        this.cancelledHandles.delete(registration.publicHandle);
        return;
      }
      marker = this.randomToken();
      if (!/^[A-Za-z0-9_-]{32}$/.test(marker)) throw new Error("invalid tmux marker");
      markerTitle = `Aperture Focus ${marker}`;
      const originalSetTitles = await readTmuxExplicitOption(
        this.tmuxRequest,
        target.socketPath,
        sessionId,
        "set-titles",
      );
      const originalTitleString = await readTmuxExplicitOption(
        this.tmuxRequest,
        target.socketPath,
        sessionId,
        "set-titles-string",
      );
      tmux = {
        socketPath: target.socketPath,
        paneId: target.paneId,
        clientName,
        sessionId,
        originalSetTitles,
        originalTitleString,
      };
      try {
        await this.tmuxRequest(target.socketPath, [
          "set-option", "-t", sessionId, "set-titles", "on",
        ]);
        await this.tmuxRequest(target.socketPath, [
          "set-option", "-t", sessionId, "set-titles-string", markerTitle,
        ]);
      } catch {
        await rollbackTmuxSetup(this.tmuxRequest, tmux, markerTitle);
        throw new Error("Aperture tmux title transaction failed");
      }
    }
    if (!candidate) {
      try {
        candidate = await this.resolveMarkerClient(
          target.hyprlandInstance,
          markerTitle,
        );
      } catch {
        if (tmux) await restoreTmuxOptions(this.tmuxRequest, tmux, markerTitle);
        throw new Error("Aperture focus marker did not resolve");
      }
    }
    const contextKey = `${target.kind}\u0000${target.hyprlandInstance}\u0000${candidate.address}`;
    const epoch = this.randomToken();
    if (!/^[A-Za-z0-9_-]{32}$/.test(epoch)) throw new Error("invalid focus epoch");
    const lease: FocusClientLease = {
      contextKey,
      herdrSocketPath: "",
      compositorAddress: target.hyprlandInstance,
      address: candidate.address,
      marker,
      markerTitle,
      epoch,
      backendKind: target.kind,
      ...(tmux ? { tmux } : {}),
      members: new Set<string>(),
    };
    const record = this.newRecord(
      registration,
      target.kind === "tmux" ? target.paneId : "",
      lease,
    );
    lease.members.add(registration.publicHandle);
    this.leases.set(contextKey, lease);
    this.registrations.set(registration.publicHandle, record);
    this.cancelledHandles.delete(registration.publicHandle);
  }

  private async resolveDirectProbe(
    hyprlandInstance: string,
    markerTitle: string,
  ): Promise<FootClient> {
    const inspect = async (): Promise<Record<string, unknown>[]> => {
      const value = await this.hyprctlRequest(hyprlandInstance, ["-j", "clients"]);
      if (!Array.isArray(value)) throw new FocusRegistrationError("invalid_context");
      return value
        .map((item) => asRecord(item))
        .filter((item) => item.title === markerTitle);
    };
    const first = await inspect();
    if (first.length === 0) throw new FocusRegistrationError("marker_missing");
    if (first.length !== 1) throw new FocusRegistrationError("marker_ambiguous");
    const owner = first[0]!;
    if (
      typeof owner.address !== "string" ||
      !HYPRLAND_ADDRESS.test(owner.address) ||
      typeof owner.class !== "string"
    ) {
      throw new FocusRegistrationError("invalid_context");
    }
    if (FOOT_CLASSES[owner.class] === true) {
      return {
        address: owner.address,
        title: markerTitle,
        className: owner.class as "foot" | "footclient",
      };
    }
    const second = await inspect();
    if (
      second.length === 1 &&
      second[0]?.address === owner.address &&
      second[0]?.class === owner.class
    ) {
      throw new FocusRegistrationError("unsupported_terminal_owned");
    }
    throw new FocusRegistrationError(
      second.length === 0 ? "marker_missing" : "marker_ambiguous",
    );
  }

  private async resolveMarkerClient(
    hyprlandInstance: string,
    markerTitle: string,
  ): Promise<FootClient> {
    for (let attempt = 0; attempt < 41; attempt += 1) {
      const candidate = exactMarkerClient(
        await this.listFootClients(hyprlandInstance),
        markerTitle,
      );
      if (candidate) return candidate;
      if (attempt < 40) await this.sleep(25);
    }
    throw new Error("Aperture focus marker did not resolve");
  }

  private async soleTmuxClientForSession(
    socketPath: string,
    sessionId: string,
  ): Promise<string> {
    const names = (
      await this.tmuxRequest(socketPath, [
        "list-clients",
        "-t",
        sessionId,
        "-F",
        "#{client_name}",
      ])
    )
      .split(/\r?\n/)
      .filter((name) => name.length > 0);
    if (names.length > 32) throw new Error("too many tmux clients");
    const unique = [...new Set(names)];
    if (unique.length !== names.length || unique.length !== 1) {
      throw new Error("ambiguous tmux clients");
    }
    assertTmuxClientName(unique[0]!);
    return unique[0]!;
  }

  private async assertTmuxLease(lease: FocusClientLease): Promise<void> {
    const tmux = lease.tmux;
    if (!tmux) throw new Error("invalid tmux lease");
    await this.socketValidator(tmux.socketPath);
    const clientName = await this.soleTmuxClientForSession(
      tmux.socketPath,
      tmux.sessionId,
    );
    if (clientName !== tmux.clientName) throw new Error("changed tmux client");
    const enabled = await readTmuxOption(
      this.tmuxRequest,
      tmux.socketPath,
      tmux.sessionId,
      "set-titles",
    );
    const title = await readTmuxOption(
      this.tmuxRequest,
      tmux.socketPath,
      tmux.sessionId,
      "set-titles-string",
    );
    if (enabled !== "on" || title !== lease.markerTitle) {
      throw new Error("changed tmux title options");
    }
  }

  private async activateNonHerdr(
    record: FocusRegistrationRecord,
  ): Promise<FocusActivationResult> {
    const lease = record.lease;
    const epoch = lease.epoch;
    try {
      if (lease.backendKind === "tmux") await this.assertTmuxLease(lease);
      await this.assertLease(lease, epoch);
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      if (lease.backendKind === "tmux") {
        const tmux = lease.tmux;
        if (!tmux) throw new Error("invalid tmux lease");
        await this.tmuxRequest(tmux.socketPath, [
          "switch-client",
          "-c",
          tmux.clientName,
          "-t",
          record.authoritativePaneId,
        ]);
        const focused = (
          await this.tmuxRequest(tmux.socketPath, [
            "display-message",
            "-p",
            "-c",
            tmux.clientName,
            "#{pane_id}",
          ])
        ).trim();
        if (focused !== record.authoritativePaneId) throw new Error("tmux focus mismatch");
      }
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      this.onDiagnostic("dispatch");
      await this.hyprctlRequest(lease.compositorAddress, [
        "dispatch",
        `hl.dsp.focus({ window = "address:${lease.address}" })`,
      ]);
      const confirmation = await this.confirmActiveWindow(record, lease, epoch);
      if (confirmation === "stale") await this.invalidateLease(lease);
      return confirmation;
    } catch {
      this.onDiagnostic("exception");
      if (this.registrations.get(record.publicHandle) === record) {
        if (lease.backendKind === "tmux") await this.invalidateLease(lease);
        else await this.invalidate(record);
      }
      return "stale";
    }
  }

  private async activateSerialized(publicHandle: string): Promise<FocusActivationResult> {
    const record = this.registrations.get(publicHandle);
    if (!record || this.cancelledHandles.has(publicHandle)) return "missing";
    if (record.target.kind !== "herdr") {
      return this.activateNonHerdr(record);
    }
    if (record.expiresAt <= this.now() + ACTIVATION_EXPIRY_FENCE_MS) {
      await this.invalidate(record);
      return "missing";
    }
    const lease = record.lease;
    const epoch = lease.epoch;
    try {
      this.onDiagnostic("resolve-pane");
      const authoritativePaneId = await this.resolvePane(
        record.target.socketPath,
        record.authoritativePaneId,
      );
      record.authoritativePaneId = authoritativePaneId;
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      this.onDiagnostic("lease-before-focus");
      await this.assertLease(lease, epoch);
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      this.onDiagnostic("pane-focus");
      await this.herdrRequest(record.target.socketPath, "pane.focus", {
        pane_id: authoritativePaneId,
      });
      this.onDiagnostic("pane-snapshot");
      const snapshotResult = await this.herdrRequest(
        record.target.socketPath,
        "session.snapshot",
        {},
      );
      const focusedPaneId = focusedPaneFromSnapshot(snapshotResult);
      if (focusedPaneId !== authoritativePaneId) {
        await this.invalidate(record);
        return "stale";
      }
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      this.onDiagnostic("dispatch");
      await this.hyprctlRequest(lease.compositorAddress, [
        "dispatch",
        `hl.dsp.focus({ window = "address:${lease.address}" })`,
      ]);
      const confirmation = await this.confirmActiveWindow(record, lease, epoch);
      if (confirmation === "stale") {
        this.onDiagnostic("active-confirm-timeout");
        await this.invalidateLease(lease);
      }
      return confirmation;
    } catch {
      this.onDiagnostic("exception");
      if (this.registrations.get(publicHandle) === record) await this.invalidate(record);
      return "stale";
    }
  }

  private async confirmActiveWindow(
    record: FocusRegistrationRecord,
    lease: FocusClientLease,
    epoch: string,
  ): Promise<FocusActivationResult> {
    const deadline = this.monotonicNow() + ACTIVE_WINDOW_CONFIRM_TIMEOUT_MS;
    const maximumAttempts =
      Math.floor(
        ACTIVE_WINDOW_CONFIRM_TIMEOUT_MS / ACTIVE_WINDOW_CONFIRM_INTERVAL_MS,
      ) + 1;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      const active = asRecord(
        await this.hyprctlRequest(lease.compositorAddress, ["-j", "activewindow"]),
      );
      if (
        active.address === lease.address &&
        active.title === lease.markerTitle &&
        typeof active.class === "string" &&
        FOOT_CLASSES[active.class] === true
      ) {
        return this.isCurrent(record, lease, epoch) ? "focused" : "missing";
      }
      if (
        attempt === maximumAttempts - 1 ||
        this.monotonicNow() >= deadline
      ) {
        return "stale";
      }
      await this.sleep(ACTIVE_WINDOW_CONFIRM_INTERVAL_MS);
    }
    return "stale";
  }

  private async invalidateLease(lease: FocusClientLease): Promise<void> {
    for (const handle of [...lease.members]) {
      const record = this.registrations.get(handle);
      if (record) await this.invalidate(record);
    }
  }

  private isCurrent(
    record: FocusRegistrationRecord,
    lease: FocusClientLease,
    epoch: string,
  ): boolean {
    return (
      !this.cancelledHandles.has(record.publicHandle) &&
      this.registrations.get(record.publicHandle) === record &&
      this.leases.get(lease.contextKey) === lease &&
      record.lease === lease &&
      lease.epoch === epoch
    );
  }

  private newRecord(
    registration: OmpFocusRegistration,
    authoritativePaneId: string,
    lease: FocusClientLease,
  ): FocusRegistrationRecord {
    const record = {
      ...registration,
      authoritativePaneId,
      lease,
      expiresAt: this.now() + this.ttlMs,
      expiry: setTimeout(() => {
        this.cancelledHandles.add(registration.publicHandle);
        void this.serialize(async () => {
          try {
            const current = this.registrations.get(registration.publicHandle);
            if (current?.hostGeneration === registration.hostGeneration) {
              await this.invalidate(current);
            }
          } finally {
            this.cancelledHandles.delete(registration.publicHandle);
          }
        });
      }, this.ttlMs),
    };
    record.expiry.unref?.();
    return record;
  }

  private renew(record: FocusRegistrationRecord, requestId: string): void {
    clearTimeout(record.expiry);
    record.requestId = requestId;
    record.expiresAt = this.now() + this.ttlMs;
    record.expiry = setTimeout(() => {
      this.cancelledHandles.add(record.publicHandle);
      void this.serialize(async () => {
        try {
          if (this.registrations.get(record.publicHandle) === record) {
            await this.invalidate(record);
          }
        } finally {
          this.cancelledHandles.delete(record.publicHandle);
        }
      });
    }, this.ttlMs);
    record.expiry.unref?.();
  }

  private async resolvePane(socketPath: string, callerPaneId: string): Promise<string> {
    const result = await this.herdrRequest(socketPath, "pane.current", {
      caller_pane_id: callerPaneId,
    });
    const pane = asRecord(result.pane);
    if (result.type !== "pane_current") {
      throw new Error("Herdr focus pane was invalid");
    }
    try {
      return assertOmpHerdrPaneId(pane.pane_id);
    } catch {
      throw new Error("Herdr focus pane was invalid");
    }
  }

  private async assertLease(lease: FocusClientLease, epoch = lease.epoch): Promise<void> {
    if (this.leases.get(lease.contextKey) !== lease || lease.epoch !== epoch) {
      throw new Error("Aperture focus lease changed");
    }
    const clients = await this.listFootClients(lease.compositorAddress);
    const client = exactMarkerClient(clients, lease.markerTitle);
    if (!client || client.address !== lease.address) {
      throw new Error("Aperture focus client changed");
    }
    if (this.leases.get(lease.contextKey) !== lease || lease.epoch !== epoch) {
      throw new Error("Aperture focus lease changed");
    }
  }

  private async listFootClients(compositorAddress: string): Promise<FootClient[]> {
    const value = await this.hyprctlRequest(compositorAddress, ["-j", "clients"]);
    if (!Array.isArray(value)) throw new Error("Hyprland client data was invalid");
    const clients: FootClient[] = [];
    for (const item of value) {
      const client = asRecord(item);
      if (typeof client.class !== "string" || FOOT_CLASSES[client.class] !== true) continue;
      if (
        typeof client.address !== "string" ||
        !HYPRLAND_ADDRESS.test(client.address) ||
        typeof client.title !== "string"
      ) {
        throw new Error("Hyprland client data was invalid");
      }
      clients.push({
        address: client.address,
        title: client.title,
        className: client.class as "foot" | "footclient",
      });
    }
    return clients;
  }

  private blockContext(contextKey: string, markers: string[]): void {
    const now = this.now();
    for (const [key, blocked] of this.blockedContexts) {
      if (blocked.expiresAt <= now) this.blockedContexts.delete(key);
    }
    if (
      !this.blockedContexts.has(contextKey) &&
      this.blockedContexts.size >= MAXIMUM_BLOCKED_CONTEXTS
    ) {
      const oldest = this.blockedContexts.keys().next().value;
      if (typeof oldest === "string") this.blockedContexts.delete(oldest);
    }
    this.blockedContexts.set(contextKey, {
      markers: new Set(markers),
      expiresAt: now + BLOCKED_CONTEXT_TTL_MS,
    });
  }

  private async assertContextUnblocked(
    contextKey: string,
    compositorAddress: string,
  ): Promise<void> {
    const blocked = this.blockedContexts.get(contextKey);
    if (!blocked) return;
    if (blocked.expiresAt <= this.now()) {
      this.blockedContexts.delete(contextKey);
      return;
    }
    const clients = await this.listFootClients(compositorAddress);
    if (clients.some((client) => blocked.markers.has(client.title))) {
      throw new Error("Aperture focus context remains blocked");
    }
    throw new Error("Aperture focus context is cooling down");
  }

  private async invalidate(record: FocusRegistrationRecord): Promise<void> {
    if (this.registrations.get(record.publicHandle) !== record) return;
    this.removeRecord(record);
    const lease = record.lease;
    if (lease.members.size > 0) return;
    await this.clearLeaseTitle(lease);
    if (this.leases.get(lease.contextKey) === lease && lease.members.size === 0) {
      this.leases.delete(lease.contextKey);
    }
  }

  private removeRecord(record: FocusRegistrationRecord): void {
    if (this.registrations.get(record.publicHandle) !== record) return;
    clearTimeout(record.expiry);
    this.registrations.delete(record.publicHandle);
    record.lease.members.delete(record.publicHandle);
    this.onInvalidated(record.publicHandle);
  }

  private async invalidateLeaseWithoutClear(lease: FocusClientLease): Promise<void> {
    for (const handle of [...lease.members]) {
      const record = this.registrations.get(handle);
      if (record) this.removeRecord(record);
    }
    if (this.leases.get(lease.contextKey) === lease) this.leases.delete(lease.contextKey);
  }

  private async clearLeaseTitle(lease: FocusClientLease): Promise<void> {
    const epoch = lease.epoch;
    if (this.leases.get(lease.contextKey) !== lease || lease.members.size > 0) return;
    try {
      await this.assertLease(lease, epoch);
      if (
        this.leases.get(lease.contextKey) !== lease ||
        lease.epoch !== epoch ||
        lease.members.size > 0
      ) {
        return;
      }
      if (lease.backendKind === "herdr") {
        await this.herdrRequest(lease.herdrSocketPath, "client.window_title.clear", {});
      } else if (lease.backendKind === "tmux" && lease.tmux) {
        await restoreTmuxOptions(this.tmuxRequest, lease.tmux, lease.markerTitle);
      }
    } catch {
      // A missing, mutated, or replaced epoch is not this cleanup's title to clear.
    }
  }

  private async clearUncommittedTitle(
    contextKey: string,
    socketPath: string,
    compositorAddress: string,
    markerTitle: string,
    epoch: string,
  ): Promise<void> {
    const current = this.leases.get(contextKey);
    if (current && current.epoch !== epoch) return;
    try {
      const clients = await this.listFootClients(compositorAddress);
      if (!exactMarkerClient(clients, markerTitle)) return;
      const afterLookup = this.leases.get(contextKey);
      if (afterLookup && afterLookup.epoch !== epoch) return;
      await this.herdrRequest(socketPath, "client.window_title.clear", {});
    } catch {
      // Failed registration remains fail-closed; no private value is logged.
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,


      () => undefined,
    );
    return result;
  }
}
function assertTmuxClientName(value: string): void {
  if (value.length < 1 || value.length > 160 || !/^[\x20-\x7e]+$/.test(value)) {
    throw new Error("invalid tmux client identity");
  }
}

function tmuxLine(output: string): string {
  const line = output.endsWith("\r\n")
    ? output.slice(0, -2)
    : output.endsWith("\n")
      ? output.slice(0, -1)
      : output;
  if (/[\r\n\u0000]/.test(line)) throw new Error("invalid tmux output");
  return line;
}

async function readTmuxOption(
  request: TmuxRequest,
  socketPath: string,
  sessionId: string,
  option: "set-titles" | "set-titles-string",
): Promise<string> {
  return tmuxLine(
    await request(socketPath, ["show-options", "-Av", "-t", sessionId, option]),
  );
}

async function readTmuxExplicitOption(
  request: TmuxRequest,
  socketPath: string,
  sessionId: string,
  option: "set-titles" | "set-titles-string",
): Promise<TmuxSavedOption> {
  const presentation = tmuxLine(
    await request(socketPath, ["show-options", "-q", "-t", sessionId, option]),
  );
  if (presentation === "") return { explicit: false, value: "" };
  const value = tmuxLine(
    await request(socketPath, ["show-options", "-qv", "-t", sessionId, option]),
  );
  return { explicit: true, value };
}

async function restoreTmuxOption(
  request: TmuxRequest,
  tmux: NonNullable<FocusClientLease["tmux"]>,
  option: "set-titles" | "set-titles-string",
  saved: TmuxSavedOption,
): Promise<void> {
  await request(
    tmux.socketPath,
    saved.explicit
      ? ["set-option", "-t", tmux.sessionId, option, saved.value]
      : ["set-option", "-u", "-t", tmux.sessionId, option],
  );
}

async function restoreTmuxOptions(
  request: TmuxRequest,
  tmux: NonNullable<FocusClientLease["tmux"]>,
  markerTitle: string,
): Promise<void> {
  const effectiveSetTitles = await readTmuxOption(
    request, tmux.socketPath, tmux.sessionId, "set-titles",
  );
  const effectiveTitle = await readTmuxOption(
    request, tmux.socketPath, tmux.sessionId, "set-titles-string",
  );
  if (effectiveSetTitles !== "on" || effectiveTitle !== markerTitle) return;
  await restoreTmuxOption(request, tmux, "set-titles-string", tmux.originalTitleString);
  await restoreTmuxOption(request, tmux, "set-titles", tmux.originalSetTitles);
}

async function rollbackTmuxSetup(
  request: TmuxRequest,
  tmux: NonNullable<FocusClientLease["tmux"]>,
  markerTitle: string,
): Promise<void> {
  const title = await readTmuxOption(
    request, tmux.socketPath, tmux.sessionId, "set-titles-string",
  );
  if (title === markerTitle) {
    await restoreTmuxOption(request, tmux, "set-titles-string", tmux.originalTitleString);
  }
  const enabled = await readTmuxOption(
    request, tmux.socketPath, tmux.sessionId, "set-titles",
  );
  if (enabled === "on") {
    await restoreTmuxOption(request, tmux, "set-titles", tmux.originalSetTitles);
  }
}
async function runTmux(socketPath: string, args: string[]): Promise<string> {
  await assertOwnedHerdrSocket(socketPath);
  const allowed = new Set([
    "display-message",
    "list-clients",
    "show-options",
    "set-option",
    "switch-client",
  ]);
  if (!args[0] || !allowed.has(args[0])) throw new Error("unsupported tmux operation");
  return new Promise<string>((resolve, reject) => {
    execFile(
      "/usr/bin/tmux",
      ["-S", socketPath, ...args],
      {
        encoding: "utf8",
        timeout: 500,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(new Error("Aperture tmux operation failed"));
        else resolve(stdout);
      },
    );
  });
}

function focusedPaneFromSnapshot(result: Record<string, unknown>): string {
  if (
    result.type !== "session_snapshot" ||
    JSON.stringify(Object.keys(result).sort()) !==
      JSON.stringify(["snapshot", "type"])
  ) {
    throw new Error("Herdr session snapshot envelope was invalid");
  }
  const snapshot = asRecord(result.snapshot);
  const focusedPaneId = snapshot.focused_pane_id;
  try {
    return assertOmpHerdrPaneId(focusedPaneId);
  } catch {
    throw new Error("Herdr focused pane was invalid");
  }
}

function exactMarkerClient(clients: FootClient[], markerTitle: string): FootClient | undefined {
  const matches = clients.filter((client) => client.title === markerTitle);
  return matches.length === 1 ? matches[0] : undefined;
}

function focusContextKey(socketPath: string, compositorAddress: string): string {
  return `${socketPath}\u0000${compositorAddress}`;
}

async function assertOwnedHerdrSocket(socketPath: string): Promise<void> {
  const metadata = await lstat(socketPath);
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    metadata.isSymbolicLink() ||
    !metadata.isSocket() ||
    metadata.uid !== uid
  ) {
    throw new Error("Herdr focus socket metadata was invalid");
  }
}

async function requestHerdr(
  socketPath: string,
  method:
    | "pane.current"
    | "pane.focus"
    | "session.snapshot"
    | "client.window_title.set"
    | "client.window_title.clear",
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await assertOwnedHerdrSocket(socketPath);
  const requestId = randomUUID();
  const line = `${JSON.stringify({ id: requestId, method, params })}\n`;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let buffer = Buffer.alloc(0);
    let settled = false;
    let responseTimer: NodeJS.Timeout | undefined;
    const connectTimer = setTimeout(
      () => finish(undefined, new Error("Herdr focus connection timed out")),
      HERDR_CONNECT_TIMEOUT_MS,
    );
    const finish = (result?: Record<string, unknown>, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Herdr focus request failed"));
    };
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      responseTimer = setTimeout(
        () => finish(undefined, new Error("Herdr focus response timed out")),
        HERDR_RESPONSE_TIMEOUT_MS,
      );
      socket.write(line, "utf8", (error) => {
        if (error) finish(undefined, new Error("Herdr focus request failed"));
      });
    });
    socket.on("data", (chunk: Buffer) => {
      if (buffer.byteLength + chunk.byteLength > HERDR_OUTPUT_BYTES) {
        finish(undefined, new Error("Herdr focus response exceeded the byte limit"));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline === -1) return;
      try {
        const response = asRecord(JSON.parse(buffer.subarray(0, newline).toString("utf8")));
        if (response.id !== requestId) throw new Error("Herdr response identity mismatch");
        finish(asRecord(response.result));
      } catch {
        finish(undefined, new Error("Herdr focus response was invalid"));
      }
    });
    socket.once("error", () => finish(undefined, new Error("Herdr focus request failed")));
    socket.once("close", () => {
      if (!settled) finish(undefined, new Error("Herdr focus socket closed"));
    });
  });
}

async function requestHyprctl(
  compositorAddress: string,
  args: readonly string[],
): Promise<unknown> {
  const allowed =
    (args.length === 2 &&
      args[0] === "-j" &&
      (args[1] === "clients" || args[1] === "activewindow")) ||
    (args.length === 2 &&
      args[0] === "dispatch" &&
      typeof args[1] === "string" &&
      /^hl\.dsp\.focus\(\{ window = "address:0x[0-9a-fA-F]{1,16}" \}\)$/.test(args[1]));
  if (!allowed) throw new Error("Aperture rejected an unsupported compositor operation");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      HYPRCTL_PATH,
      [...args],
      {
        encoding: "utf8",
        timeout: HYPRCTL_TIMEOUT_MS,
        maxBuffer: HYPRCTL_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: compositorAddress },
      },
      (error, stdout) => {
        if (error) reject(new Error("Aperture compositor operation failed"));
        else resolve(stdout);
      },
    );
  });
  if (Buffer.byteLength(output, "utf8") > HYPRCTL_OUTPUT_BYTES) {
    throw new Error("Aperture compositor response exceeded the byte limit");
  }
  if (args[0] !== "-j") return null;
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Aperture compositor response was invalid");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Aperture focus response was invalid");
  }
  return value as Record<string, unknown>;
}
