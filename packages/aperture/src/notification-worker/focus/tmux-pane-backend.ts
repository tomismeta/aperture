import type { FocusRecovery, FocusTarget } from "../../worker-direct-message.js";
import {
  HyprlandFootSurfaceController,
  markerTitleFor,
} from "./hyprland-foot-surface-controller.js";
import {
  assertOwnedSocket,
  readTmuxExplicitOption,
  readTmuxOption,
  restoreTmuxOption,
  runTmux,
  tmuxLine,
  type SocketValidator,
  type TmuxRequest,
} from "./native.js";
import {
  type FocusBackend,
  type FocusMember,
  type KnownFocusSurface,
  type PreparedTmuxTarget,
  type TmuxPaneLease,
  paneMember,
  runBoundedCleanup,
  throwIfAborted,
} from "./types.js";

export type TmuxPaneBackendOptions = {
  surfaceController: HyprlandFootSurfaceController;
  tmuxRequest?: TmuxRequest;
  socketValidator?: SocketValidator;
};

export class TmuxPaneBackend implements FocusBackend<"tmux"> {
  readonly kind = "tmux" as const;
  private readonly surfaceController: HyprlandFootSurfaceController;
  private readonly tmuxRequest: TmuxRequest;
  private readonly socketValidator: SocketValidator;

  constructor(options: TmuxPaneBackendOptions) {
    this.surfaceController = options.surfaceController;
    this.tmuxRequest = options.tmuxRequest ?? runTmux;
    this.socketValidator = options.socketValidator ?? assertOwnedSocket;
  }

  async prepare(
    target: Extract<FocusTarget, { kind: "tmux" }>,
    recovery: Extract<FocusRecovery, { kind: "tmux" }> | undefined,
    signal: AbortSignal,
  ): Promise<PreparedTmuxTarget> {
    await this.socketValidator(target.socketPath, signal);
    throwIfAborted(signal);
    const sessionId = tmuxLine(
      await this.tmuxRequest(
        target.socketPath,
        ["display-message", "-p", "-t", target.paneId, "#{session_id}"],
        signal,
      ),
    );
    if (!/^\$\d{1,10}$/.test(sessionId)) throw new Error("invalid tmux session");
    const clientName = await this.soleClient(target.socketPath, sessionId, signal);
    if (recovery && (recovery.sessionId !== sessionId || recovery.clientName !== clientName)) {
      throw new Error("tmux recovery identity changed");
    }
    return {
      kind: "tmux",
      leaseKey: `tmux\u0000${target.socketPath}\u0000${sessionId}`,
      socketPath: target.socketPath,
      paneId: target.paneId,
      sessionId,
      clientName,
      hyprlandInstance: target.hyprlandInstance,
      ...(recovery ? { recovery } : {}),
    };
  }

  async acquire(
    prepared: PreparedTmuxTarget,
    _knownSurfaces: readonly KnownFocusSurface[],
    randomToken: () => string,
    signal: AbortSignal,
  ): Promise<TmuxPaneLease> {
    throwIfAborted(signal);
    const epoch = randomToken();
    if (!/^[A-Za-z0-9_-]{32}$/.test(epoch)) throw new Error("invalid focus epoch");

    if (prepared.recovery) {
      const markerTitle = markerTitleFor(prepared.recovery.marker);
      await this.assertOwnedOptions(prepared.socketPath, prepared.sessionId, markerTitle, signal);
      const surface = await this.surfaceController.resolveMarker(
        prepared.hyprlandInstance,
        prepared.recovery.marker,
        signal,
        false,
      );
      return {
        kind: "tmux",
        key: prepared.leaseKey,
        epoch,
        surface,
        members: new Map<string, FocusMember>(),
        socketPath: prepared.socketPath,
        sessionId: prepared.sessionId,
        clientName: prepared.clientName,
        originalSetTitles: prepared.recovery.originalSetTitles,
        originalTitleString: prepared.recovery.originalTitleString,
      };
    }

    const marker = randomToken();
    const markerTitle = markerTitleFor(marker);
    const originalSetTitles = await readTmuxExplicitOption(
      this.tmuxRequest,
      prepared.socketPath,
      prepared.sessionId,
      "set-titles",
      signal,
    );
    const originalTitleString = await readTmuxExplicitOption(
      this.tmuxRequest,
      prepared.socketPath,
      prepared.sessionId,
      "set-titles-string",
      signal,
    );
    const restoreState = {
      socketPath: prepared.socketPath,
      sessionId: prepared.sessionId,
      originalSetTitles,
      originalTitleString,
    };
    let setTitlesWritten = false;
    let titleStringWritten = false;
    try {
      await this.tmuxRequest(
        prepared.socketPath,
        ["set-option", "-t", prepared.sessionId, "set-titles", "on"],
        signal,
      );
      setTitlesWritten = true;
      await this.tmuxRequest(
        prepared.socketPath,
        ["set-option", "-t", prepared.sessionId, "set-titles-string", markerTitle],
        signal,
      );
      titleStringWritten = true;
      const surface = await this.surfaceController.resolveMarker(
        prepared.hyprlandInstance,
        marker,
        signal,
      );
      throwIfAborted(signal);
      return {
        kind: "tmux",
        key: prepared.leaseKey,
        epoch,
        surface,
        members: new Map<string, FocusMember>(),
        socketPath: prepared.socketPath,
        sessionId: prepared.sessionId,
        clientName: prepared.clientName,
        originalSetTitles,
        originalTitleString,
      };
    } catch (error) {
      await runBoundedCleanup((cleanupSignal) =>
        this.rollbackAcquisition(
          restoreState,
          markerTitle,
          setTitlesWritten,
          titleStringWritten,
          cleanupSignal,
        ),
      );
      throw error;
    }
  }

  async validate(lease: TmuxPaneLease, signal: AbortSignal): Promise<void> {
    await this.assertLease(lease, signal);
    await this.surfaceController.validate(lease.surface, signal);
  }

  async refresh(
    lease: TmuxPaneLease,
    prepared: PreparedTmuxTarget,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      lease.key !== prepared.leaseKey ||
      lease.clientName !== prepared.clientName ||
      (prepared.recovery && prepared.recovery.marker !== lease.surface.marker)
    ) {
      throw new Error("tmux focus context changed");
    }
    await this.assertLease(lease, signal);
    await this.surfaceController.validate(lease.surface, signal);
  }

  member(prepared: PreparedTmuxTarget): FocusMember {
    return { kind: "pane", paneId: prepared.paneId };
  }

  async focusInner(lease: TmuxPaneLease, member: FocusMember, signal: AbortSignal): Promise<void> {
    await this.tmuxRequest(
      lease.socketPath,
      ["switch-client", "-c", lease.clientName, "-t", paneMember(member)],
      signal,
    );
  }

  async confirmInner(
    lease: TmuxPaneLease,
    member: FocusMember,
    signal: AbortSignal,
  ): Promise<boolean> {
    const focused = tmuxLine(
      await this.tmuxRequest(
        lease.socketPath,
        ["display-message", "-p", "-c", lease.clientName, "#{pane_id}"],
        signal,
      ),
    );
    return focused === paneMember(member);
  }

  async release(lease: TmuxPaneLease, signal: AbortSignal): Promise<void> {
    await this.restoreIfOwned(lease, lease.surface.markerTitle, signal);
  }

  recovery(lease: TmuxPaneLease): Extract<FocusRecovery, { kind: "tmux" }> {
    return {
      kind: "tmux",
      marker: lease.surface.marker,
      sessionId: lease.sessionId,
      clientName: lease.clientName,
      originalSetTitles: lease.originalSetTitles,
      originalTitleString: lease.originalTitleString,
    };
  }

  private async soleClient(
    socketPath: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const names = (
      await this.tmuxRequest(
        socketPath,
        ["list-clients", "-t", sessionId, "-F", "#{client_name}"],
        signal,
      )
    )
      .split(/\r?\n/)
      .filter((name) => name.length > 0);
    if (names.length > 32) throw new Error("too many tmux clients");
    const unique = [...new Set(names)];
    if (unique.length !== names.length || unique.length !== 1) {
      throw new Error("ambiguous tmux clients");
    }
    if (unique[0]!.length > 160 || !/^[\x20-\x7e]+$/.test(unique[0]!)) {
      throw new Error("invalid tmux client identity");
    }
    return unique[0]!;
  }

  private async assertOwnedOptions(
    socketPath: string,
    sessionId: string,
    markerTitle: string,
    signal: AbortSignal,
  ): Promise<void> {
    const enabled = await readTmuxOption(
      this.tmuxRequest,
      socketPath,
      sessionId,
      "set-titles",
      signal,
    );
    const title = await readTmuxOption(
      this.tmuxRequest,
      socketPath,
      sessionId,
      "set-titles-string",
      signal,
    );
    if (enabled !== "on" || title !== markerTitle) {
      throw new Error("changed tmux title options");
    }
  }

  private async assertLease(lease: TmuxPaneLease, signal: AbortSignal): Promise<void> {
    await this.socketValidator(lease.socketPath, signal);
    const clientName = await this.soleClient(lease.socketPath, lease.sessionId, signal);
    if (clientName !== lease.clientName) throw new Error("changed tmux client");
    await this.assertOwnedOptions(
      lease.socketPath,
      lease.sessionId,
      lease.surface.markerTitle,
      signal,
    );
  }

  private async rollbackAcquisition(
    lease: {
      socketPath: string;
      sessionId: string;
      originalSetTitles: TmuxPaneLease["originalSetTitles"];
      originalTitleString: TmuxPaneLease["originalTitleString"];
    },
    markerTitle: string,
    setTitlesWritten: boolean,
    titleStringWritten: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    let titleRestored = !titleStringWritten;
    if (titleStringWritten) {
      const title = await readTmuxOption(
        this.tmuxRequest,
        lease.socketPath,
        lease.sessionId,
        "set-titles-string",
        signal,
      );
      if (title !== markerTitle) return;
      await restoreTmuxOption(
        this.tmuxRequest,
        lease,
        "set-titles-string",
        lease.originalTitleString,
        signal,
      );
      titleRestored = true;
    }
    if (!setTitlesWritten || !titleRestored) return;
    const enabled = await readTmuxOption(
      this.tmuxRequest,
      lease.socketPath,
      lease.sessionId,
      "set-titles",
      signal,
    );
    if (enabled !== "on") return;
    await restoreTmuxOption(this.tmuxRequest, lease, "set-titles", lease.originalSetTitles, signal);
  }

  private async restoreIfOwned(
    lease: {
      socketPath: string;
      sessionId: string;
      originalSetTitles: TmuxPaneLease["originalSetTitles"];
      originalTitleString: TmuxPaneLease["originalTitleString"];
    },
    markerTitle: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const enabled = await readTmuxOption(
        this.tmuxRequest,
        lease.socketPath,
        lease.sessionId,
        "set-titles",
        signal,
      );
      const title = await readTmuxOption(
        this.tmuxRequest,
        lease.socketPath,
        lease.sessionId,
        "set-titles-string",
        signal,
      );
      if (enabled !== "on" || title !== markerTitle) return;
      await restoreTmuxOption(
        this.tmuxRequest,
        lease,
        "set-titles-string",
        lease.originalTitleString,
        signal,
      );
      await restoreTmuxOption(
        this.tmuxRequest,
        lease,
        "set-titles",
        lease.originalSetTitles,
        signal,
      );
    } catch {
      // Unknown or changed option ownership is never overwritten.
    }
  }
}
