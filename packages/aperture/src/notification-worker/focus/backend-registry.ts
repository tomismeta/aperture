import type { FocusRecovery, FocusRegistration } from "../../worker-direct-message.js";
import { DirectTerminalBackend } from "./direct-terminal-backend.js";
import { HerdrPaneBackend } from "./herdr-pane-backend.js";
import type { HyprlandFootSurfaceController } from "./hyprland-foot-surface-controller.js";
import type { HerdrRequest, SocketValidator, TmuxRequest } from "./native.js";
import { TmuxPaneBackend } from "./tmux-pane-backend.js";
import type {
  FocusBackendRegistry,
  FocusLease,
  FocusMember,
  KnownFocusSurface,
  PreparedDirectTerminalTarget,
  PreparedFocusTarget,
  PreparedHerdrTarget,
  PreparedTmuxTarget,
} from "./types.js";

export type ClosedFocusBackendRegistryOptions = {
  surfaceController: HyprlandFootSurfaceController;
  herdrRequest?: HerdrRequest;
  tmuxRequest?: TmuxRequest;
  socketValidator?: SocketValidator;
};

export class ClosedFocusBackendRegistry {
  private readonly backends: FocusBackendRegistry;

  constructor(options: ClosedFocusBackendRegistryOptions) {
    this.backends = {
      herdr: new HerdrPaneBackend({
        surfaceController: options.surfaceController,
        ...(options.herdrRequest ? { herdrRequest: options.herdrRequest } : {}),
        ...(options.socketValidator ? { socketValidator: options.socketValidator } : {}),
      }),
      "direct-terminal": new DirectTerminalBackend({
        surfaceController: options.surfaceController,
      }),
      tmux: new TmuxPaneBackend({
        surfaceController: options.surfaceController,
        ...(options.tmuxRequest ? { tmuxRequest: options.tmuxRequest } : {}),
        ...(options.socketValidator ? { socketValidator: options.socketValidator } : {}),
      }),
    } satisfies FocusBackendRegistry;
  }

  async prepare(
    registration: FocusRegistration,
    signal: AbortSignal,
  ): Promise<PreparedFocusTarget> {
    switch (registration.target.kind) {
      case "herdr":
        return this.backends.herdr.prepare(
          registration.target,
          registration.recovery?.kind === "herdr" ? registration.recovery : undefined,
          signal,
        );
      case "direct-terminal":
        return this.backends["direct-terminal"].prepare(registration.target, undefined, signal);
      case "tmux":
        return this.backends.tmux.prepare(
          registration.target,
          registration.recovery?.kind === "tmux" ? registration.recovery : undefined,
          signal,
        );
    }
  }

  async acquire(
    prepared: PreparedFocusTarget,
    knownSurfaces: readonly KnownFocusSurface[],
    randomToken: () => string,
    signal: AbortSignal,
  ): Promise<FocusLease> {
    switch (prepared.kind) {
      case "herdr":
        return this.backends.herdr.acquire(prepared, knownSurfaces, randomToken, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].acquire(
          prepared,
          knownSurfaces,
          randomToken,
          signal,
        );
      case "tmux":
        return this.backends.tmux.acquire(prepared, knownSurfaces, randomToken, signal);
    }
  }

  async validate(lease: FocusLease, signal: AbortSignal): Promise<void> {
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.validate(lease, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].validate(lease, signal);
      case "tmux":
        return this.backends.tmux.validate(lease, signal);
    }
  }

  async refresh(
    lease: FocusLease,
    prepared: PreparedFocusTarget,
    signal: AbortSignal,
  ): Promise<void> {
    if (lease.kind !== prepared.kind) throw new Error("focus backend changed");
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.refresh(lease, prepared as PreparedHerdrTarget, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].refresh(
          lease,
          prepared as PreparedDirectTerminalTarget,
          signal,
        );
      case "tmux":
        return this.backends.tmux.refresh(lease, prepared as PreparedTmuxTarget, signal);
    }
  }

  member(prepared: PreparedFocusTarget): FocusMember {
    switch (prepared.kind) {
      case "herdr":
        return this.backends.herdr.member(prepared);
      case "direct-terminal":
        return this.backends["direct-terminal"].member(prepared);
      case "tmux":
        return this.backends.tmux.member(prepared);
    }
  }

  async focusInner(lease: FocusLease, member: FocusMember, signal: AbortSignal): Promise<void> {
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.focusInner(lease, member, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].focusInner(lease, member, signal);
      case "tmux":
        return this.backends.tmux.focusInner(lease, member, signal);
    }
  }

  async confirmInner(
    lease: FocusLease,
    member: FocusMember,
    signal: AbortSignal,
  ): Promise<boolean> {
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.confirmInner(lease, member, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].confirmInner(lease, member, signal);
      case "tmux":
        return this.backends.tmux.confirmInner(lease, member, signal);
    }
  }

  recovery(lease: FocusLease): FocusRecovery | undefined {
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.recovery(lease);
      case "direct-terminal":
        return this.backends["direct-terminal"].recovery(lease);
      case "tmux":
        return this.backends.tmux.recovery(lease);
    }
  }

  async release(lease: FocusLease, signal: AbortSignal): Promise<void> {
    switch (lease.kind) {
      case "herdr":
        return this.backends.herdr.release(lease, signal);
      case "direct-terminal":
        return this.backends["direct-terminal"].release(lease, signal);
      case "tmux":
        return this.backends.tmux.release(lease, signal);
    }
  }
}
