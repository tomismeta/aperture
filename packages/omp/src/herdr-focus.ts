import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import type { OmpFocusRegistration } from "@tomismeta/aperture/omp-direct-message";

import { OmpDirectWorkerTransport } from "./direct-worker-transport.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const MAXIMUM_SOCKET_PATH_BYTES = 100;
const MAXIMUM_COMPOSITOR_ADDRESS_CHARACTERS = 160;
const MAXIMUM_PANE_ID_CHARACTERS = 64;

export type HerdrFocusContext = {
  herdrSocketPath: string;
  paneId: string;
  compositorAddress: string;
};

export type HerdrFocusHostOptions = {
  direct: OmpDirectWorkerTransport;
  environment?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
  randomToken?: () => string;
  heartbeatIntervalMs?: number;
};

export class HerdrFocusHost {
  private readonly direct: OmpDirectWorkerTransport;
  private readonly heartbeatIntervalMs: number;
  private readonly registration: OmpFocusRegistration;
  private heartbeat: NodeJS.Timeout | undefined;
  private heartbeatPending = false;
  private active = false;
  private closing = false;

  private constructor(
    options: HerdrFocusHostOptions,
    registration: OmpFocusRegistration,
  ) {
    this.direct = options.direct;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.registration = registration;
  }

  static async create(options: HerdrFocusHostOptions): Promise<HerdrFocusHost | undefined> {
    const context = resolveHerdrFocusContext(
      options.environment ?? process.env,
      options.stdoutIsTTY ?? process.stdout.isTTY === true,
    );
    if (!context) return undefined;

    const token = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    const hostGeneration = token();
    const publicHandle = token();
    if (![hostGeneration, publicHandle].every((value) => /^[A-Za-z0-9_-]{32}$/.test(value))) {
      return undefined;
    }
    const registration: OmpFocusRegistration = {
      schemaVersion: 2,
      type: "omp.focus.register",
      requestId: randomUUID(),
      publicHandle,
      hostGeneration,
      herdrSocketPath: context.herdrSocketPath,
      paneId: context.paneId,
      compositorAddress: context.compositorAddress,
    };
    const host = new HerdrFocusHost(options, registration);
    try {
      await host.direct.registerFocus(registration);
      host.active = true;
      host.heartbeat = setInterval(() => void host.refresh(), host.heartbeatIntervalMs);
      host.heartbeat.unref?.();
      return host;
    } catch {
      try {
        await host.direct.revokeFocus({
          schemaVersion: 2,
          type: "omp.focus.revoke",
          requestId: randomUUID(),
          publicHandle,
          hostGeneration,
        });
      } catch {
        // Worker TTL is the final cleanup if registration committed after timeout.
      }
      return undefined;
    }
  }

  focusHandle(): string | undefined {
    return this.active && !this.closing ? this.registration.publicHandle : undefined;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.active = false;
    clearInterval(this.heartbeat);
    try {
      await this.direct.revokeFocus({
        schemaVersion: 2,
        type: "omp.focus.revoke",
        requestId: randomUUID(),
        publicHandle: this.registration.publicHandle,
        hostGeneration: this.registration.hostGeneration,
      });
    } catch {
      // Worker TTL owns unreachable-registration cleanup and title release.
    }
  }

  private async refresh(): Promise<void> {
    if (this.closing || this.heartbeatPending) return;
    this.heartbeatPending = true;
    try {
      await this.direct.registerFocus({ ...this.registration, requestId: randomUUID() });
      this.active = true;
    } catch {
      this.active = false;
      // Keep retrying: worker restart recreates the volatile lease and marker.
    } finally {
      this.heartbeatPending = false;
    }
  }
}

export function resolveHerdrFocusContext(
  environment: NodeJS.ProcessEnv,
  stdoutIsTTY: boolean,
): HerdrFocusContext | undefined {
  if (
    environment.HERDR_ENV !== "1" ||
    !stdoutIsTTY ||
    environment.TMUX !== undefined ||
    environment.STY !== undefined ||
    environment.ZELLIJ !== undefined ||
    environment.OMP_RPC !== undefined ||
    environment.PI_RPC !== undefined ||
    environment.OMP_HEADLESS !== undefined ||
    environment.PI_HEADLESS !== undefined ||
    environment.TERM === "dumb"
  ) {
    return undefined;
  }
  const herdrSocketPath = environment.HERDR_SOCKET_PATH;
  const paneId = environment.HERDR_PANE_ID;
  const compositorAddress = environment.HYPRLAND_INSTANCE_SIGNATURE;
  if (
    !herdrSocketPath ||
    !path.isAbsolute(herdrSocketPath) ||
    path.normalize(herdrSocketPath) !== herdrSocketPath ||
    herdrSocketPath.includes("\0") ||
    Buffer.byteLength(herdrSocketPath, "utf8") > MAXIMUM_SOCKET_PATH_BYTES ||
    !paneId ||
    paneId.length > MAXIMUM_PANE_ID_CHARACTERS ||
    !/^w[1-9]\d*:p[1-9]\d*$/.test(paneId) ||
    !compositorAddress ||
    compositorAddress.length > MAXIMUM_COMPOSITOR_ADDRESS_CHARACTERS ||
    !/^[A-Za-z0-9_.-]+$/.test(compositorAddress)
  ) {
    return undefined;
  }
  return { herdrSocketPath, paneId, compositorAddress };
}
