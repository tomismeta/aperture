import { randomBytes, randomUUID } from "node:crypto";

import {
  WORKER_DIRECT_PROTOCOL_VERSION,
  assertWorkerDirectMessage,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRegistrationResult,
  type FocusRevocation,
  type FocusTarget,
} from "./worker-direct-message.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const RETRY_INITIAL_MS = 250;
const RETRY_MAXIMUM_MS = 5_000;
const CLOSE_TIMEOUT_MS = 3_000;
export type FocusHostStatus = "registered" | "unavailable" | "unsupported";

export type FocusControlTransport = {
  registerFocus(registration: FocusRegistration): Promise<FocusRegistrationResult>;
  revokeFocus(revocation: FocusRevocation): Promise<void>;
};

export type TerminalTitleLease = {
  release(): void;
};

export type TerminalTitleCapability = {
  claim(title: string): TerminalTitleLease;
};

export type FocusHostOptions = {
  transport: FocusControlTransport;
  environment?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
  terminalTitle?: TerminalTitleCapability;
  randomToken?: () => string;
  heartbeatIntervalMs?: number;
  retryInitialMs?: number;
  retryMaximumMs?: number;
  closeTimeoutMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  onRegistered?: (
    publicHandle: string,
    workerGeneration: string,
    receiptEpisodeToken: string,
  ) => void;
  onStatus?: (status: FocusHostStatus) => void;
};

export class FocusHost {
  private readonly transport: FocusControlTransport;
  private readonly heartbeatIntervalMs: number;
  private readonly retryInitialMs: number;
  private readonly retryMaximumMs: number;
  private readonly closeTimeoutMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly onRegistered: NonNullable<FocusHostOptions["onRegistered"]>;
  private readonly randomToken: () => string;
  private readonly onStatus: (status: FocusHostStatus) => void;
  private readonly baseRegistration: Omit<FocusRegistration, "requestId" | "recovery">;
  private readonly titleLease: TerminalTitleLease | undefined;
  private recovery: FocusRecovery | undefined;
  private workerGeneration: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private attempt: Promise<void> | undefined;
  private active = false;
  private closing = false;
  private retryAttempt = 0;
  private lastStatus: FocusHostStatus | undefined;

  private constructor(
    options: FocusHostOptions,
    registration: Omit<FocusRegistration, "requestId" | "recovery">,
    titleLease?: TerminalTitleLease,
  ) {
    this.transport = options.transport;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.retryInitialMs = options.retryInitialMs ?? RETRY_INITIAL_MS;
    this.retryMaximumMs = options.retryMaximumMs ?? RETRY_MAXIMUM_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.randomToken = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    this.onRegistered = options.onRegistered ?? (() => undefined);
    this.onStatus = options.onStatus ?? (() => undefined);
    this.baseRegistration = registration;
    this.titleLease = titleLease;
  }

  static create(options: FocusHostOptions): FocusHost | undefined {
    const environment = options.environment ?? process.env;
    const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
    const token = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    const hostGeneration = token();
    const publicHandle = token();
    if (![hostGeneration, publicHandle].every(validToken)) return undefined;
    const resolved = resolveFocusTarget(environment, stdoutIsTTY, options.terminalTitle, token);
    if (!resolved) return undefined;
    const registration = assertWorkerDirectMessage({
      schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
      type: "focus.register",
      requestId: randomUUID(),
      publicHandle,
      hostGeneration,
      target: resolved.target,
    }) as FocusRegistration;
    const { requestId: _requestId, recovery: _recovery, ...baseRegistration } = registration;
    return new FocusHost(options, baseRegistration, resolved.titleLease);
  }

  focusHandle(): string | undefined {
    return this.active && !this.closing ? this.baseRegistration.publicHandle : undefined;
  }

  isActive(): boolean {
    return this.active && !this.closing;
  }

  prewarm(): void {
    if (this.closing || this.attempt || this.timer) return;
    this.startAttempt();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.active = false;
    this.clearScheduled();
    const deadline = Date.now() + this.closeTimeoutMs;
    const priorSettled = this.attempt
      ? await succeedsWithin(this.attempt, Math.max(0, deadline - Date.now()))
      : true;

    let ownsDirectTitle = false;
    if (this.titleLease && priorSettled && Date.now() < deadline) {
      ownsDirectTitle = await succeedsWithin(
        this.transport.registerFocus(this.registration()),
        Math.max(0, deadline - Date.now()),
      );
    }
    const revoked = await succeedsWithin(
      this.transport.revokeFocus({
        schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
        type: "focus.revoke",
        requestId: randomUUID(),
        publicHandle: this.baseRegistration.publicHandle,
        hostGeneration: this.baseRegistration.hostGeneration,
      }),
      Math.max(0, deadline - Date.now()),
    );
    if (ownsDirectTitle && revoked) {
      try {
        this.titleLease?.release();
      } catch {
        // Harness title restoration remains best-effort after ownership proof.
      }
    }
  }

  private registration(): FocusRegistration {
    return {
      ...this.baseRegistration,
      requestId: randomUUID(),
      ...(this.recovery ? { recovery: this.recovery } : {}),
    };
  }

  private startAttempt(): void {
    if (this.closing || this.attempt) return;
    this.attempt = this.refresh().finally(() => {
      this.attempt = undefined;
      if (!this.closing) this.schedule(this.active ? this.heartbeatIntervalMs : this.retryDelay());
    });
  }

  private async refresh(): Promise<void> {
    try {
      const wasActive = this.active;
      const registration = await this.transport.registerFocus(this.registration());
      if (this.closing) return;
      const generationChanged = this.workerGeneration !== registration.workerGeneration;
      this.workerGeneration = registration.workerGeneration;
      this.recovery = registration.recovery;
      this.active = true;
      this.retryAttempt = 0;
      if (generationChanged || !wasActive) {
        const receiptEpisodeToken = this.randomToken();
        if (!validToken(receiptEpisodeToken)) {
          throw new Error("Aperture focus receipt episode token is invalid");
        }
        this.onRegistered(
          this.baseRegistration.publicHandle,
          registration.workerGeneration,
          receiptEpisodeToken,
        );
        this.lastStatus = "registered";
        this.onStatus("registered");
      } else {
        this.reportStatus("registered");
      }
    } catch (error) {
      if (this.closing) return;
      this.active = false;
      const unsupported = isWorkerDirectRejection(error, "unsupported_terminal_owned");
      this.reportStatus(unsupported ? "unsupported" : "unavailable");
      if (this.titleLease && unsupported) {
        this.closing = true;
        try {
          this.titleLease.release();
        } catch {
          // The worker proved this claim unsupported; cleanup remains best-effort.
        }
      }
    }
  }

  private retryDelay(): number {
    const delay = Math.min(
      this.retryInitialMs * Math.pow(2, this.retryAttempt),
      this.retryMaximumMs,
    );
    this.retryAttempt = Math.min(this.retryAttempt + 1, 30);
    return delay;
  }

  private schedule(milliseconds: number): void {
    if (this.closing || this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.startAttempt();
    }, milliseconds);
    this.timer.unref?.();
  }

  private clearScheduled(): void {
    this.clearTimer(this.timer);
    this.timer = undefined;
  }
  private reportStatus(status: FocusHostStatus): void {
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    this.onStatus(status);
  }
}

export function resolveFocusTarget(
  environment: NodeJS.ProcessEnv,
  stdoutIsTTY: boolean,
  terminalTitle: TerminalTitleCapability | undefined,
  token: () => string,
): { target: FocusTarget; titleLease?: TerminalTitleLease } | undefined {
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
    return validatedTarget({
      kind: "herdr",
      socketPath: environment.HERDR_SOCKET_PATH,
      paneId: environment.HERDR_PANE_ID,
      hyprlandInstance,
    });
  }
  if (environment.TMUX !== undefined) {
    if (
      environment.KITTY_WINDOW_ID !== undefined ||
      environment.WEZTERM_PANE !== undefined ||
      environment.GHOSTTY_RESOURCES_DIR !== undefined ||
      environment.ALACRITTY_SOCKET !== undefined
    ) {
      return undefined;
    }
    return validatedTarget({
      kind: "tmux",
      socketPath: environment.TMUX.split(",", 1)[0],
      paneId: environment.TMUX_PANE,
      hyprlandInstance,
    });
  }
  if (
    !terminalTitle ||
    environment.TERM === "dumb" ||
    environment.HERDR_ENV !== undefined ||
    environment.KITTY_WINDOW_ID !== undefined ||
    environment.WEZTERM_PANE !== undefined ||
    environment.GHOSTTY_RESOURCES_DIR !== undefined ||
    environment.ALACRITTY_SOCKET !== undefined ||
    environment.TERM_PROGRAM !== undefined
  ) {
    return undefined;
  }
  const marker = token();
  if (!validToken(marker)) return undefined;
  const markerTitle = `Aperture Focus ${marker}`;
  try {
    return {
      target: { kind: "direct-terminal", marker, hyprlandInstance },
      titleLease: terminalTitle.claim(markerTitle),
    };
  } catch {
    return undefined;
  }
}

function validatedTarget(target: Record<string, unknown>): { target: FocusTarget } | undefined {
  try {
    const message = assertWorkerDirectMessage({
      schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
      type: "focus.register",
      requestId: "context",
      publicHandle: "A".repeat(32),
      hostGeneration: "B".repeat(32),
      target,
    });
    return message.type === "focus.register" ? { target: message.target } : undefined;
  } catch {
    return undefined;
  }
}

function validToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(value);
}

function isWorkerDirectRejection(error: unknown, code: string): boolean {
  return Boolean(
    error instanceof Error &&
    error.name === "WorkerDirectRejectedError" &&
    "code" in error &&
    error.code === code,
  );
}

async function succeedsWithin(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  if (milliseconds <= 0) {
    void operation.catch(() => undefined);
    return false;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
