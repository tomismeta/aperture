import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import {
  assertOmpDirectMessage,
  type OmpFocusRegistration,
  type OmpFocusTarget,
} from "@tomismeta/aperture/omp-direct-message";

import {
  OmpDirectWorkerTransport,
  OmpFocusRegistrationRejectedError,
} from "./direct-worker-transport.js";

const HEARTBEAT_INTERVAL_MS = 5_000;

export type OmpFocusContext = Extract<OmpFocusTarget, { kind: "herdr" }>;

export type OmpFocusHostOptions = {
  direct: OmpDirectWorkerTransport;
  environment?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
  ui?: { setTitle?: (title: string) => void };
  initialTitle?: string;
  randomToken?: () => string;
  heartbeatIntervalMs?: number;
};

export class OmpFocusHost {
  private readonly direct: OmpDirectWorkerTransport;
  private readonly heartbeatIntervalMs: number;
  private readonly registration: OmpFocusRegistration;
  private readonly resetDirectTitle: (() => void) | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private heartbeatPending = false;
  private active = false;
  private everActive = false;
  private closing = false;

  private constructor(
    options: OmpFocusHostOptions,
    registration: OmpFocusRegistration,
    resetDirectTitle?: () => void,
  ) {
    this.direct = options.direct;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.registration = registration;
    this.resetDirectTitle = resetDirectTitle;
  }

  static async create(options: OmpFocusHostOptions): Promise<OmpFocusHost | undefined> {
    const environment = options.environment ?? process.env;
    const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
    const token = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    const hostGeneration = token();
    const publicHandle = token();
    if (![hostGeneration, publicHandle].every((value) => /^[A-Za-z0-9_-]{32}$/.test(value))) {
      return undefined;
    }
    const resolved = resolveFocusTarget(
      environment,
      stdoutIsTTY,
      options.ui,
      options.initialTitle,
      token,
    );
    if (!resolved) return undefined;
    const registration = assertOmpDirectMessage({
      schemaVersion: 3,
      type: "omp.focus.register",
      requestId: randomUUID(),
      publicHandle,
      hostGeneration,
      target: resolved.target,
    }) as OmpFocusRegistration;
    const host = new OmpFocusHost(options, registration, resolved.resetTitle);
    try {
      await host.direct.registerFocus(registration);
      host.active = true;
      host.everActive = true;
      host.startHeartbeat();
      return host;
    } catch (error) {
      if (registration.target.kind === "direct-terminal-probe") {
        if (
          error instanceof OmpFocusRegistrationRejectedError &&
          error.code === "unsupported_terminal_owned"
        ) {
          try {
            host.resetDirectTitle?.();
          } catch {
            // Immediate owned-marker cleanup is best-effort.
          }
          return undefined;
        }
        host.startHeartbeat();
        return host;
      }
      try {
        await host.direct.revokeFocus({
          schemaVersion: 3,
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
  isActive(): boolean {
    return this.active && !this.closing;
  }
  shouldRecreate(): boolean {
    return this.everActive && !this.active && !this.closing;
  }
  async retryRegistration(): Promise<void> {
    await this.refresh();
  }


  focusHandle(): string | undefined {
    return this.active && !this.closing ? this.registration.publicHandle : undefined;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.active = false;
    clearInterval(this.heartbeat);
    let ownsDirectTitle = false;
    if (this.resetDirectTitle) {
      try {
        await this.direct.registerFocus({
          ...this.registration,
          requestId: randomUUID(),
        });
        ownsDirectTitle = true;
      } catch {
        // Rejected or unreachable ownership must never clobber an external title.
      }
    }
    try {
      await this.direct.revokeFocus({
        schemaVersion: 3,
        type: "omp.focus.revoke",
        requestId: randomUUID(),
        publicHandle: this.registration.publicHandle,
        hostGeneration: this.registration.hostGeneration,
      });
    } catch {
      // Worker TTL owns unreachable-registration cleanup.
    }
    if (ownsDirectTitle) {
      try {
        this.resetDirectTitle?.();
      } catch {
        // UI title cleanup is best-effort.
      }
    }
  }


  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => void this.refresh(), this.heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  private async refresh(): Promise<void> {
    if (this.closing || this.heartbeatPending) return;
    this.heartbeatPending = true;
    try {
      await this.direct.registerFocus({ ...this.registration, requestId: randomUUID() });
      this.active = true;
      this.everActive = true;
    } catch {
      this.active = false;
    } finally {
      this.heartbeatPending = false;
    }
  }
}

export function resolveHerdrFocusContext(
  environment: NodeJS.ProcessEnv,
  stdoutIsTTY: boolean,
): OmpFocusContext | undefined {
  const resolved = resolveFocusTarget(
    environment,
    stdoutIsTTY,
    undefined,
    undefined,
    () => "A".repeat(32),
  );
  return resolved?.target.kind === "herdr" ? resolved.target : undefined;
}

function resolveFocusTarget(
  environment: NodeJS.ProcessEnv,
  stdoutIsTTY: boolean,
  ui: { setTitle?: (title: string) => void } | undefined,
  initialTitle: string | undefined,
  token: () => string,
): {
  target: OmpFocusTarget;
  resetTitle?: () => void;
} | undefined {
  if (
    !stdoutIsTTY ||
    environment.STY !== undefined ||
    environment.ZELLIJ !== undefined ||
    environment.OMP_RPC !== undefined ||
    environment.PI_RPC !== undefined ||
    environment.OMP_ACP !== undefined ||
    environment.PI_ACP !== undefined ||
    environment.ACP_MODE !== undefined ||
    environment.OMP_HEADLESS !== undefined ||
    environment.PI_HEADLESS !== undefined
  ) {
    return undefined;
  }
  const hyprlandInstance = environment.HYPRLAND_INSTANCE_SIGNATURE;
  if (!hyprlandInstance) return undefined;
  if (environment.HERDR_ENV === "1") {
    if (environment.TMUX !== undefined) return undefined;
    try {
      const registration = assertOmpDirectMessage({
        schemaVersion: 3,
        type: "omp.focus.register",
        requestId: "context",
        publicHandle: "A".repeat(32),
        hostGeneration: "B".repeat(32),
        target: {
          kind: "herdr",
          socketPath: environment.HERDR_SOCKET_PATH,
          paneId: environment.HERDR_PANE_ID,
          hyprlandInstance,
        },
      }) as OmpFocusRegistration;
      return { target: registration.target };
    } catch {
      return undefined;
    }
  }
  if (environment.TMUX !== undefined) {
    const socketPath = environment.TMUX.split(",", 1)[0];
    try {
      const registration = assertOmpDirectMessage({
        schemaVersion: 3,
        type: "omp.focus.register",
        requestId: "context",
        publicHandle: "A".repeat(32),
        hostGeneration: "B".repeat(32),
        target: {
          kind: "tmux",
          socketPath,
          paneId: environment.TMUX_PANE,
          hyprlandInstance,
        },
      }) as OmpFocusRegistration;
      return { target: registration.target };
    } catch {
      return undefined;
    }
  }
  if (
    ui?.setTitle &&
    initialTitle &&
    initialTitle.trim() &&
    Array.from(initialTitle).length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(initialTitle) &&
    environment.TERM !== "dumb" &&
    environment.HERDR_ENV === undefined &&
    environment.TMUX === undefined &&
    environment.KITTY_WINDOW_ID === undefined &&
    environment.WEZTERM_PANE === undefined &&
    environment.GHOSTTY_RESOURCES_DIR === undefined &&
    environment.ALACRITTY_SOCKET === undefined &&
    environment.TERM_PROGRAM === undefined
  ) {
    const marker = token();
    if (!/^[A-Za-z0-9_-]{32}$/.test(marker)) return undefined;
    const markerTitle = `Aperture Focus ${marker}`;
    try {
      ui.setTitle(markerTitle);
    } catch {
      return undefined;
    }
    return {
      target: { kind: "direct-terminal-probe", marker, hyprlandInstance },
      resetTitle: () => ui.setTitle?.("π"),
    };
  }
  return undefined;
}
