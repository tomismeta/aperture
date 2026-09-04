import type { FocusRecovery, FocusTarget } from "../../worker-direct-message.js";
import { assertHerdrPaneId } from "../../worker-direct-message.js";
import {
  HyprlandFootSurfaceController,
  markerTitleFor,
} from "./hyprland-foot-surface-controller.js";
import { focusedPaneFromSnapshot, requestHerdr, type HerdrRequest } from "./native.js";
import {
  type FocusBackend,
  type FocusMember,
  type HerdrPaneLease,
  type KnownFocusSurface,
  type PreparedHerdrTarget,
  paneMember,
  throwIfAborted,
} from "./types.js";

export type HerdrPaneBackendOptions = {
  surfaceController: HyprlandFootSurfaceController;
  herdrRequest?: HerdrRequest;
};

export class HerdrPaneBackend implements FocusBackend<"herdr"> {
  readonly kind = "herdr" as const;
  private readonly surfaceController: HyprlandFootSurfaceController;
  private readonly herdrRequest: HerdrRequest;

  constructor(options: HerdrPaneBackendOptions) {
    this.surfaceController = options.surfaceController;
    this.herdrRequest = options.herdrRequest ?? requestHerdr;
  }

  async prepare(
    target: Extract<FocusTarget, { kind: "herdr" }>,
    recovery: Extract<FocusRecovery, { kind: "herdr" }> | undefined,
    signal: AbortSignal,
  ): Promise<PreparedHerdrTarget> {
    throwIfAborted(signal);
    const result = await this.herdrRequest(
      target.socketPath,
      "pane.current",
      { caller_pane_id: target.paneId },
      signal,
    );
    throwIfAborted(signal);
    const pane = asPane(result);
    return {
      kind: "herdr",
      leaseKey: `herdr\u0000${target.socketPath}\u0000${target.hyprlandInstance}`,
      socketPath: target.socketPath,
      paneId: pane,
      hyprlandInstance: target.hyprlandInstance,
      ...(recovery ? { recovery } : {}),
    };
  }

  async acquire(
    prepared: PreparedHerdrTarget,
    _knownSurfaces: readonly KnownFocusSurface[],
    randomToken: () => string,
    signal: AbortSignal,
  ): Promise<HerdrPaneLease> {
    throwIfAborted(signal);
    const marker = prepared.recovery?.marker ?? randomToken();
    const markerTitle = markerTitleFor(marker);
    const epoch = randomToken();
    markerTitleFor(epoch);

    if (prepared.recovery) {
      const surface = await this.surfaceController.resolveMarker(
        prepared.hyprlandInstance,
        marker,
        signal,
        false,
      );
      await this.surfaceController.validate(surface, signal);
      return {
        kind: "herdr",
        key: prepared.leaseKey,
        epoch,
        socketPath: prepared.socketPath,
        surface,
        members: new Map<string, FocusMember>(),
      };
    }

    const result = await this.herdrRequest(
      prepared.socketPath,
      "client.window_title.set",
      { title: markerTitle },
      signal,
    );
    if (
      result.type !== "client_window_title" ||
      result.changed !== true ||
      result.reason !== "set"
    ) {
      throw new Error("Herdr did not establish focus marker ownership");
    }
    const surface = await this.surfaceController.resolveMarker(
      prepared.hyprlandInstance,
      marker,
      signal,
    );
    throwIfAborted(signal);
    return {
      kind: "herdr",
      key: prepared.leaseKey,
      epoch,
      socketPath: prepared.socketPath,
      surface,
      members: new Map<string, FocusMember>(),
    };
  }

  async validate(lease: HerdrPaneLease, signal: AbortSignal): Promise<void> {
    await this.surfaceController.validate(lease.surface, signal);
  }

  async refresh(
    lease: HerdrPaneLease,
    prepared: PreparedHerdrTarget,
    signal: AbortSignal,
  ): Promise<void> {
    if (lease.key !== prepared.leaseKey) throw new Error("Herdr focus context changed");
    if (prepared.recovery && prepared.recovery.marker !== lease.surface.marker) {
      throw new Error("Herdr recovery marker changed");
    }
    await this.surfaceController.validate(lease.surface, signal);
  }

  member(prepared: PreparedHerdrTarget): FocusMember {
    return { kind: "pane", paneId: prepared.paneId };
  }

  async focusInner(lease: HerdrPaneLease, member: FocusMember, signal: AbortSignal): Promise<void> {
    await this.herdrRequest(
      lease.socketPath,
      "pane.focus",
      { pane_id: paneMember(member) },
      signal,
    );
  }

  async confirmInner(
    lease: HerdrPaneLease,
    member: FocusMember,
    signal: AbortSignal,
  ): Promise<boolean> {
    const snapshot = await this.herdrRequest(lease.socketPath, "session.snapshot", {}, signal);
    return focusedPaneFromSnapshot(snapshot) === paneMember(member);
  }

  async release(lease: HerdrPaneLease, signal: AbortSignal): Promise<void> {
    // Herdr has no conditional clear tied to an expected title and client.
    // Retain the marker rather than risk clearing a newly foregrounded client.
    await this.surfaceController.validate(lease.surface, signal);
  }

  recovery(lease: HerdrPaneLease): Extract<FocusRecovery, { kind: "herdr" }> {
    return { kind: "herdr", marker: lease.surface.marker };
  }
}

function asPane(result: Record<string, unknown>): string {
  if (result.type !== "pane_current" || !result.pane || typeof result.pane !== "object") {
    throw new Error("Herdr focus pane was invalid");
  }
  try {
    return assertHerdrPaneId((result.pane as Record<string, unknown>).pane_id);
  } catch {
    throw new Error("Herdr focus pane was invalid");
  }
}
