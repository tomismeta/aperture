import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";

import type { OmpFocusRegistration, OmpFocusRevocation } from "../omp-direct-message.js";
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
const HYPRCTL_PATH = "/usr/bin/hyprctl";
const FOOT_CLASSES: Readonly<Record<string, true>> = { foot: true, footclient: true };
const HYPRLAND_ADDRESS = /^0x[0-9a-fA-F]{1,16}$/;
const PANE_ID = /^w[1-9]\d*:p[1-9]\d*$/;

export type FocusActivationResult = "focused" | "stale" | "missing";

type FootClient = { address: string; title: string; className: "foot" | "footclient" };

type FocusClientLease = {
  contextKey: string;
  herdrSocketPath: string;
  compositorAddress: string;
  address: string;
  marker: string;
  markerTitle: string;
  epoch: string;
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

export type FocusBrokerOptions = {
  now?: () => number;
  ttlMs?: number;
  randomToken?: () => string;
  herdrRequest?: HerdrRequest;
  hyprctlRequest?: HyprctlRequest;
  onInvalidated?: (publicHandle: string) => void;
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
  private readonly onInvalidated: (publicHandle: string) => void;
  private operationQueue = Promise.resolve();

  constructor(options: FocusBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? REGISTRATION_TTL_MS;
    this.randomToken = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    this.herdrRequest = options.herdrRequest ?? requestHerdr;
    this.hyprctlRequest = options.hyprctlRequest ?? requestHyprctl;
    this.onInvalidated = options.onInvalidated ?? (() => undefined);
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
    const contextKey = focusContextKey(
      registration.herdrSocketPath,
      registration.compositorAddress,
    );
    await this.assertContextUnblocked(contextKey, registration.compositorAddress);
    const authoritativePaneId = await this.resolvePane(
      registration.herdrSocketPath,
      registration.paneId,
    );
    const existing = this.registrations.get(registration.publicHandle);
    if (
      existing &&
      (existing.hostGeneration !== registration.hostGeneration ||
        existing.herdrSocketPath !== registration.herdrSocketPath ||
        existing.compositorAddress !== registration.compositorAddress)
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

    const before = await this.listFootClients(registration.compositorAddress);
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
        registration.herdrSocketPath,
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
      const clients = await this.listFootClients(registration.compositorAddress);
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
          registration.herdrSocketPath,
          "client.window_title.clear",
          {},
        );
        titleSet = false;
        throw new Error("Aperture rejected multiple Herdr Foot clients");
      }
      const lease: FocusClientLease = {
        contextKey,
        herdrSocketPath: registration.herdrSocketPath,
        compositorAddress: registration.compositorAddress,
        address: candidate.address,
        marker,
        markerTitle,
        epoch,
        members: new Set<string>(),
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
          registration.herdrSocketPath,
          registration.compositorAddress,
          markerTitle,
          epoch,
        );
      }
      throw new Error("Aperture rejected an invalid focus registration");
    }
  }

  private async activateSerialized(publicHandle: string): Promise<FocusActivationResult> {
    const record = this.registrations.get(publicHandle);
    if (!record || this.cancelledHandles.has(publicHandle)) return "missing";
    if (record.expiresAt <= this.now() + ACTIVATION_EXPIRY_FENCE_MS) {
      await this.invalidate(record);
      return "missing";
    }
    const lease = record.lease;
    const epoch = lease.epoch;
    try {
      const authoritativePaneId = await this.resolvePane(
        record.herdrSocketPath,
        record.authoritativePaneId,
      );
      record.authoritativePaneId = authoritativePaneId;
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      await this.assertLease(lease, epoch);
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      await this.herdrRequest(record.herdrSocketPath, "pane.focus", {
        pane_id: authoritativePaneId,
      });
      const snapshot = await this.herdrRequest(record.herdrSocketPath, "session.snapshot", {});
      if (snapshot.focused_pane_id !== authoritativePaneId) {
        await this.invalidate(record);
        return "stale";
      }
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      await this.hyprctlRequest(lease.compositorAddress, [
        "dispatch",
        `hl.dsp.focus({ window = "address:${lease.address}" })`,
      ]);
      const active = asRecord(
        await this.hyprctlRequest(lease.compositorAddress, ["-j", "activewindow"]),
      );
      if (
        active.address !== lease.address ||
        active.title !== lease.markerTitle ||
        typeof active.class !== "string" ||
        FOOT_CLASSES[active.class] !== true
      ) {
        await this.invalidateLeaseWithoutClear(lease);
        return "stale";
      }
      if (!this.isCurrent(record, lease, epoch)) return "missing";
      return "focused";
    } catch {
      if (this.registrations.get(publicHandle) === record) await this.invalidate(record);
      return "stale";
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
    if (
      result.type !== "pane_current" ||
      typeof pane.pane_id !== "string" ||
      pane.pane_id.length > 64 ||
      !PANE_ID.test(pane.pane_id)
    ) {
      throw new Error("Herdr focus pane was invalid");
    }
    return pane.pane_id;
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
      await this.herdrRequest(lease.herdrSocketPath, "client.window_title.clear", {});
    } catch {
      // A missing or replaced epoch is not this cleanup's title to clear.
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
