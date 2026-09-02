import type { FocusRecovery, FocusTarget } from "../../worker-direct-message.js";
import { HyprlandFootSurfaceController } from "./hyprland-foot-surface-controller.js";
import {
  type DirectTerminalLease,
  type FocusBackend,
  type FocusMember,
  type PreparedDirectTerminalTarget,
  throwIfAborted,
} from "./types.js";

export type DirectTerminalBackendOptions = {
  surfaceController: HyprlandFootSurfaceController;
};

export class DirectTerminalBackend implements FocusBackend<"direct-terminal"> {
  readonly kind = "direct-terminal" as const;
  private readonly surfaceController: HyprlandFootSurfaceController;

  constructor(options: DirectTerminalBackendOptions) {
    this.surfaceController = options.surfaceController;
  }

  async prepare(
    target: Extract<FocusTarget, { kind: "direct-terminal" }>,
    _recovery: Extract<FocusRecovery, { kind: "direct-terminal" }> | undefined,
    signal: AbortSignal,
  ): Promise<PreparedDirectTerminalTarget> {
    const surface = await this.surfaceController.resolveDirectMarker(
      target.hyprlandInstance,
      target.marker,
      signal,
    );
    return {
      kind: "direct-terminal",
      leaseKey: `direct-terminal\u0000${target.hyprlandInstance}\u0000${target.marker}`,
      marker: target.marker,
      hyprlandInstance: target.hyprlandInstance,
      surface,
    };
  }

  async acquire(
    prepared: PreparedDirectTerminalTarget,
    _knownMarkerTitles: ReadonlySet<string>,
    randomToken: () => string,
    signal: AbortSignal,
  ): Promise<DirectTerminalLease> {
    throwIfAborted(signal);
    const epoch = randomToken();
    if (!/^[A-Za-z0-9_-]{32}$/.test(epoch)) throw new Error("invalid focus epoch");
    await this.surfaceController.validate(prepared.surface, signal);
    return {
      kind: "direct-terminal",
      key: prepared.leaseKey,
      epoch,
      surface: prepared.surface,
      members: new Map<string, FocusMember>(),
    };
  }

  async validate(lease: DirectTerminalLease, signal: AbortSignal): Promise<void> {
    await this.surfaceController.validate(lease.surface, signal);
  }

  async refresh(
    lease: DirectTerminalLease,
    prepared: PreparedDirectTerminalTarget,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      lease.key !== prepared.leaseKey ||
      lease.surface.address !== prepared.surface.address ||
      lease.surface.marker !== prepared.marker
    ) {
      throw new Error("direct terminal focus target changed");
    }
    await this.surfaceController.validate(lease.surface, signal);
  }

  member(_prepared: PreparedDirectTerminalTarget): FocusMember {
    return { kind: "surface" };
  }

  async focusInner(
    _lease: DirectTerminalLease,
    _member: FocusMember,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
  }

  async confirmInner(
    lease: DirectTerminalLease,
    _member: FocusMember,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      await this.surfaceController.validate(lease.surface, signal);
      return true;
    } catch {
      return false;
    }
  }

  async release(_lease: DirectTerminalLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    // The harness-owned title capability restores only after worker-confirmed revocation.
  }

  recovery(_lease: DirectTerminalLease): undefined {
    return undefined;
  }
}
