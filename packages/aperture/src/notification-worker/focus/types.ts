import type { FocusRecovery, FocusTarget, SavedTmuxOption } from "../../worker-direct-message.js";

export const FOCUS_LIMITS = {
  directClients: 32,
  queuedOperations: 64,
  activeRegistrations: 128,
  leaseMembers: 32,
  shutdownMilliseconds: 3_000,
} as const;

export const FOCUS_TIMING = {
  registrationTtlMilliseconds: 15_000,
  activationExpiryFenceMilliseconds: 3_000,
  blockedContextTtlMilliseconds: 60_000,
  activeWindowConfirmIntervalMilliseconds: 25,
  activeWindowConfirmTimeoutMilliseconds: 1_000,
} as const;

export type FocusActivationResult = "focused" | "stale" | "missing";

export type FocusDiagnosticStage =
  | "resolve-pane"
  | "lease-before-focus"
  | "pane-focus"
  | "pane-snapshot"
  | "dispatch"
  | "active-confirm-timeout"
  | "inner-reconfirm"
  | "registration-lease-retained"
  | "registration-lease-invalid"
  | "capacity"
  | "exception";

export type FootSurface = {
  hyprlandInstance: string;
  address: string;
  className: "foot" | "footclient";
  marker: string;
  markerTitle: string;
};

export type FocusMember = { kind: "pane"; paneId: string } | { kind: "surface" };

type BaseFocusLease = {
  key: string;
  epoch: string;
  surface: FootSurface;
  members: Map<string, FocusMember>;
};

export type HerdrPaneLease = BaseFocusLease & {
  kind: "herdr";
  socketPath: string;
};

export type DirectTerminalLease = BaseFocusLease & {
  kind: "direct-terminal";
};

export type TmuxPaneLease = BaseFocusLease & {
  kind: "tmux";
  socketPath: string;
  sessionId: string;
  clientName: string;
  originalSetTitles: SavedTmuxOption;
  originalTitleString: SavedTmuxOption;
};

export type FocusLease = HerdrPaneLease | DirectTerminalLease | TmuxPaneLease;
export type KnownFocusSurface = {
  backend: FocusLease["kind"];
  leaseKey: string;
  epoch: string;
  surface: FootSurface;
};

export type FocusRegistrationRecord = {
  publicHandle: string;
  hostGeneration: string;
  targetKey: string;
  admissionKey: string;
  lease: FocusLease;
  expiresAt: number;
};

export type PreparedHerdrTarget = {
  kind: "herdr";
  leaseKey: string;
  socketPath: string;
  paneId: string;
  hyprlandInstance: string;
  recovery?: Extract<FocusRecovery, { kind: "herdr" }>;
};

export type PreparedDirectTerminalTarget = {
  kind: "direct-terminal";
  leaseKey: string;
  marker: string;
  hyprlandInstance: string;
  surface: FootSurface;
};

export type PreparedTmuxTarget = {
  kind: "tmux";
  leaseKey: string;
  socketPath: string;
  paneId: string;
  sessionId: string;
  clientName: string;
  hyprlandInstance: string;
  recovery?: Extract<FocusRecovery, { kind: "tmux" }>;
};

export type PreparedFocusTarget =
  | PreparedHerdrTarget
  | PreparedDirectTerminalTarget
  | PreparedTmuxTarget;

export type TargetFor<K extends FocusTarget["kind"]> = Extract<FocusTarget, { kind: K }>;
export type PreparedFor<K extends PreparedFocusTarget["kind"]> = Extract<
  PreparedFocusTarget,
  { kind: K }
>;
export type LeaseFor<K extends FocusLease["kind"]> = Extract<FocusLease, { kind: K }>;
export type RecoveryFor<K extends FocusTarget["kind"]> = Extract<FocusRecovery, { kind: K }>;

export interface FocusBackend<K extends FocusTarget["kind"]> {
  readonly kind: K;
  prepare(
    target: TargetFor<K>,
    recovery: RecoveryFor<K> | undefined,
    signal: AbortSignal,
  ): Promise<PreparedFor<K>>;
  acquire(
    prepared: PreparedFor<K>,
    knownSurfaces: readonly KnownFocusSurface[],
    randomToken: () => string,
    signal: AbortSignal,
  ): Promise<LeaseFor<K>>;
  validate(lease: LeaseFor<K>, signal: AbortSignal): Promise<void>;
  refresh(lease: LeaseFor<K>, prepared: PreparedFor<K>, signal: AbortSignal): Promise<void>;
  member(prepared: PreparedFor<K>): FocusMember;
  focusInner(lease: LeaseFor<K>, member: FocusMember, signal: AbortSignal): Promise<void>;
  confirmInner(lease: LeaseFor<K>, member: FocusMember, signal: AbortSignal): Promise<boolean>;
  release(lease: LeaseFor<K>, signal: AbortSignal): Promise<void>;
  recovery(lease: LeaseFor<K>): RecoveryFor<K> | undefined;
}

export type FocusBackendRegistry = {
  [K in FocusTarget["kind"]]: FocusBackend<K>;
};

export class FocusRegistrationError extends Error {
  constructor(
    readonly code:
      | "unsupported_terminal_owned"
      | "marker_missing"
      | "marker_ambiguous"
      | "invalid_context"
      | "capacity",
  ) {
    super("Aperture focus registration rejected");
    this.name = "FocusRegistrationError";
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function abortError(): Error {
  const error = new Error("Aperture focus operation was cancelled");
  error.name = "AbortError";
  return error;
}

export function targetKey(target: FocusTarget): string {
  switch (target.kind) {
    case "herdr":
      return `herdr\u0000${target.socketPath}\u0000${target.paneId}\u0000${target.hyprlandInstance}`;
    case "direct-terminal":
      return `direct-terminal\u0000${target.marker}\u0000${target.hyprlandInstance}`;
    case "tmux":
      return `tmux\u0000${target.socketPath}\u0000${target.paneId}\u0000${target.hyprlandInstance}`;
  }
}
export async function runBoundedCleanup(
  operation: (signal: AbortSignal) => Promise<void>,
  milliseconds = 750,
): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(controller.signal),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve();
        }, milliseconds);
      }),
    ]);
  } catch {
    // Cleanup is compare-and-restore and remains best-effort.
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

export function admissionKey(target: FocusTarget): string {
  switch (target.kind) {
    case "herdr":
      return `herdr\u0000${target.socketPath}\u0000${target.hyprlandInstance}`;
    case "direct-terminal":
      return `direct-terminal\u0000${target.marker}\u0000${target.hyprlandInstance}`;
    case "tmux":
      return `tmux\u0000${target.socketPath}\u0000${target.hyprlandInstance}`;
  }
}

export function paneMember(member: FocusMember): string {
  if (member.kind !== "pane") throw new Error("focus backend requires a pane member");
  return member.paneId;
}
