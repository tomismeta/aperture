import { performance } from "node:perf_hooks";

import type { HyprctlRequest } from "./native.js";
import { asRecord, requestHyprctl } from "./native.js";
import {
  FOCUS_TIMING,
  FocusRegistrationError,
  type FocusActivationResult,
  abortError,
  type FootSurface,
  throwIfAborted,
} from "./types.js";

const FOOT_CLASSES: Readonly<Record<string, true>> = { foot: true, footclient: true };
const HYPRLAND_ADDRESS = /^0x[0-9a-fA-F]{1,16}$/;
const MARKER_PREFIX = "Aperture Focus ";

export type FootClient = {
  address: string;
  title: string;
  className: "foot" | "footclient";
};

export type HyprlandFootSurfaceControllerOptions = {
  hyprctlRequest?: HyprctlRequest;
  sleep?: (milliseconds: number) => Promise<void>;
  monotonicNow?: () => number;
  confirmIntervalMs?: number;
  confirmTimeoutMs?: number;
};

export class HyprlandFootSurfaceController {
  private readonly hyprctlRequest: HyprctlRequest;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly monotonicNow: () => number;
  private readonly confirmIntervalMs: number;
  private readonly confirmTimeoutMs: number;

  constructor(options: HyprlandFootSurfaceControllerOptions = {}) {
    this.hyprctlRequest = options.hyprctlRequest ?? requestHyprctl;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.confirmIntervalMs =
      options.confirmIntervalMs ?? FOCUS_TIMING.activeWindowConfirmIntervalMilliseconds;
    this.confirmTimeoutMs =
      options.confirmTimeoutMs ?? FOCUS_TIMING.activeWindowConfirmTimeoutMilliseconds;
  }

  async list(hyprlandInstance: string, signal: AbortSignal): Promise<FootClient[]> {
    throwIfAborted(signal);
    const value = await this.hyprctlRequest(hyprlandInstance, ["-j", "clients"], signal);
    throwIfAborted(signal);
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

  async assertNoUnknownMarkers(
    hyprlandInstance: string,
    knownMarkerTitles: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const clients = await this.list(hyprlandInstance, signal);
    if (
      clients.some(
        (client) => client.title.startsWith(MARKER_PREFIX) && !knownMarkerTitles.has(client.title),
      )
    ) {
      throw new Error("Aperture rejected an unknown focus marker");
    }
  }

  async resolveDirectMarker(
    hyprlandInstance: string,
    marker: string,
    signal: AbortSignal,
  ): Promise<FootSurface> {
    const markerTitle = markerTitleFor(marker);
    const inspect = async (): Promise<Record<string, unknown>[]> => {
      throwIfAborted(signal);
      const value = await this.hyprctlRequest(hyprlandInstance, ["-j", "clients"], signal);
      throwIfAborted(signal);
      if (!Array.isArray(value)) throw new FocusRegistrationError("invalid_context");
      return value.map((item) => asRecord(item)).filter((item) => item.title === markerTitle);
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
        hyprlandInstance,
        address: owner.address,
        className: owner.class as "foot" | "footclient",
        marker,
        markerTitle,
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
    throw new FocusRegistrationError(second.length === 0 ? "marker_missing" : "marker_ambiguous");
  }

  async resolveMarker(
    hyprlandInstance: string,
    marker: string,
    signal: AbortSignal,
    retry = true,
  ): Promise<FootSurface> {
    const markerTitle = markerTitleFor(marker);
    const attempts = retry ? 41 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(signal);
      const matches = (await this.list(hyprlandInstance, signal)).filter(
        (client) => client.title === markerTitle,
      );
      if (matches.length === 1) {
        const match = matches[0]!;
        return { hyprlandInstance, marker, markerTitle, ...match };
      }
      if (matches.length > 1) throw new FocusRegistrationError("marker_ambiguous");
      if (attempt + 1 < attempts) await this.sleepWithAbort(25, signal);
    }
    throw new FocusRegistrationError("marker_missing");
  }

  async validate(surface: FootSurface, signal: AbortSignal): Promise<void> {
    const resolved = await this.resolveMarker(
      surface.hyprlandInstance,
      surface.marker,
      signal,
      false,
    );
    if (resolved.address !== surface.address || resolved.className !== surface.className) {
      throw new Error("Aperture focus surface changed");
    }
  }

  async focusAndConfirm(
    surface: FootSurface,
    isCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<FocusActivationResult> {
    throwIfAborted(signal);
    if (!isCurrent()) return "missing";
    await this.validate(surface, signal);
    if (!isCurrent()) return "missing";
    await this.hyprctlRequest(
      surface.hyprlandInstance,
      ["dispatch", `hl.dsp.focus({ window = "address:${surface.address}" })`],
      signal,
    );
    const deadline = this.monotonicNow() + this.confirmTimeoutMs;
    const maximumAttempts = Math.floor(this.confirmTimeoutMs / this.confirmIntervalMs) + 1;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      throwIfAborted(signal);
      if (!isCurrent()) return "missing";
      const active = asRecord(
        await this.hyprctlRequest(surface.hyprlandInstance, ["-j", "activewindow"], signal),
      );
      if (
        active.address === surface.address &&
        active.title === surface.markerTitle &&
        typeof active.class === "string" &&
        FOOT_CLASSES[active.class] === true
      ) {
        return isCurrent() ? "focused" : "missing";
      }
      if (attempt + 1 >= maximumAttempts || this.monotonicNow() >= deadline) return "stale";
      await this.sleepWithAbort(this.confirmIntervalMs, signal);
    }
    return "stale";
  }

  private async sleepWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => finish(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      this.sleep(milliseconds).then(
        () => finish(),
        (error) => finish(error),
      );
    });
    throwIfAborted(signal);
  }
}

export function markerTitleFor(marker: string): string {
  if (!/^[A-Za-z0-9_-]{32}$/.test(marker)) throw new Error("Aperture marker was invalid");
  return `${MARKER_PREFIX}${marker}`;
}
