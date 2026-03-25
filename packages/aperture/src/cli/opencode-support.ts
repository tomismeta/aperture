import { stderr } from "node:process";

import { OpencodeClient, createOpencodeBridge, type OpencodeBridge } from "@aperture/opencode";
import type { ApertureRuntimeSnapshot } from "@aperture/runtime";

import {
  listEnabledGlobalOpencodeProfiles,
  resolveProfilePassword,
  type OpencodeConnectionProfile,
} from "../opencode-config.js";

export type LauncherOpencodeStartResult =
  | {
      kind: "started";
      close(): Promise<void>;
      detail: string;
      hint?: string;
    }
  | {
      kind: "waiting";
      detail: string;
      hint?: string;
    };

export type OpencodeProfileProbeResult =
  | { kind: "ready"; detail: string; hint?: string }
  | { kind: "waiting"; detail: string; hint?: string };

export async function runOpencodeAdapter(runtimeBaseUrl: string): Promise<void> {
  const profiles = await listEnabledGlobalOpencodeProfiles();

  if (profiles.length === 0) {
    stderr.write("No enabled OpenCode connection profiles found. Configure one before starting Aperture.\n");
    return;
  }

  const bridges: OpencodeBridge[] = [];
  for (const profile of profiles) {
    const password = resolveProfilePassword(profile);
    if (profile.auth && !password) {
      throw new Error(
        `OpenCode profile "${profile.id}" requires a password. Set ${profile.auth.passwordEnv ?? "the configured password env"} or reconnect the profile.`,
      );
    }
    const bridge = createOpencodeBridge({
      runtimeBaseUrl,
      runtimeLabel: profile.label ? `OpenCode adapter (${profile.label})` : `OpenCode adapter (${profile.id})`,
      runtimeMetadata: {
        profileId: profile.id,
      },
      ...(profile.label ? { sourceLabel: profile.label } : {}),
      client: {
        baseUrl: profile.baseUrl,
        ...(profile.auth
          ? {
              auth: {
                username: profile.auth.username,
                password: password as string,
              },
            }
          : {}),
        ...(profile.scope ? { scope: profile.scope } : {}),
      },
    });
    await bridge.start();
    bridges.push(bridge);
    stderr.write(`Connected OpenCode profile "${profile.id}" to runtime ${runtimeBaseUrl} via ${profile.baseUrl}\n`);
  }

  stderr.write(`Aperture OpenCode adapter ready (${bridges.length} profile${bridges.length === 1 ? "" : "s"})\n`);
  stderr.write("Run the TUI separately with: aperture internal tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    for (const bridge of bridges.reverse()) {
      await bridge.close();
    }
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export async function startLauncherOpencodeAdapter(runtimeBaseUrl: string): Promise<LauncherOpencodeStartResult> {
  const profiles = await listEnabledGlobalOpencodeProfiles();
  if (profiles.length === 0) {
    return {
      kind: "waiting",
      detail: "No enabled OpenCode profiles are configured.",
      hint: "Add or enable an OpenCode profile to connect OpenCode to Aperture.",
    };
  }

  const bridges: OpencodeBridge[] = [];
  const unavailable: string[] = [];
  for (const profile of profiles) {
    try {
      const password = resolveProfilePassword(profile);
      if (profile.auth && !password) {
        throw new Error(
          `Profile "${profile.id}" needs ${profile.auth.passwordEnv ?? "its configured password"} before Aperture can connect.`,
        );
      }

      const clientOptions = {
        baseUrl: profile.baseUrl,
        ...(profile.auth
          ? {
              auth: {
                username: profile.auth.username,
                password: password as string,
              },
            }
          : {}),
        ...(profile.scope ? { scope: profile.scope } : {}),
      };

      const probeClient = new OpencodeClient(clientOptions);
      await probeClient.listPermissions();

      const bridge = createOpencodeBridge({
        runtimeBaseUrl,
        runtimeLabel: profile.label ? `OpenCode adapter (${profile.label})` : `OpenCode adapter (${profile.id})`,
        runtimeMetadata: {
          profileId: profile.id,
        },
        ...(profile.label ? { sourceLabel: profile.label } : {}),
        client: clientOptions,
      });
      await bridge.start();
      bridges.push(bridge);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailable.push(
        profiles.length > 1
          ? `${profile.id}: ${humanizeOpencodeError(profile, message)}`
          : humanizeOpencodeError(profile, message),
      );
    }
  }

  if (bridges.length > 0) {
    const detail = unavailable.length > 0
      ? `Connected ${bridges.length} OpenCode profile${bridges.length === 1 ? "" : "s"} · ${unavailable.length} unavailable`
      : `Connected ${bridges.length} OpenCode profile${bridges.length === 1 ? "" : "s"}`;
    return {
      kind: "started",
      detail,
      ...(unavailable.length > 0 ? { hint: unavailable[0] } : {}),
      async close() {
        for (const bridge of bridges.reverse()) {
          await bridge.close();
        }
      },
    };
  }

  return {
    kind: "waiting",
    detail: `Waiting for OpenCode at ${describeProfileTargets(profiles)}.`,
    ...(unavailable[0] ? { hint: unavailable[0] } : {}),
  };
}

export async function probeOpencodeProfiles(
  profiles: OpencodeConnectionProfile[],
): Promise<OpencodeProfileProbeResult> {
  if (profiles.length === 0) {
    return {
      kind: "waiting",
      detail: "No enabled OpenCode profiles are configured.",
      hint: "Add or enable an OpenCode profile to connect OpenCode to Aperture.",
    };
  }

  const unavailable: string[] = [];
  let reachable = 0;

  for (const profile of profiles) {
    try {
      const password = resolveProfilePassword(profile);
      if (profile.auth && !password) {
        throw new Error(
          `Profile "${profile.id}" needs ${profile.auth.passwordEnv ?? "its configured password"} before Aperture can connect.`,
        );
      }

      const probeClient = new OpencodeClient({
        baseUrl: profile.baseUrl,
        ...(profile.auth
          ? {
              auth: {
                username: profile.auth.username,
                password: password as string,
              },
            }
          : {}),
        ...(profile.scope ? { scope: profile.scope } : {}),
      });
      await probeClient.listPermissions();
      reachable += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailable.push(
        profiles.length > 1
          ? `${profile.id}: ${humanizeOpencodeError(profile, message)}`
          : humanizeOpencodeError(profile, message),
      );
    }
  }

  if (reachable > 0) {
    return {
      kind: "ready",
      detail: opencodeReadyDetail(profiles, reachable),
      hint: unavailable[0] ?? opencodeAttachHint(profiles),
    };
  }

  return {
    kind: "waiting",
    detail: `Waiting for OpenCode at ${describeProfileTargets(profiles)}.`,
    ...(unavailable[0] ? { hint: unavailable[0] } : {}),
  };
}

export function describeProfileTargets(profiles: OpencodeConnectionProfile[]): string {
  const targets = [...new Set(profiles.map((profile) => profile.baseUrl))];
  if (targets.length === 1) {
    return targets[0] ?? "OpenCode";
  }
  return `${targets.length} OpenCode endpoints`;
}

export function humanizeOpencodeError(profile: OpencodeConnectionProfile, message: string): string {
  if (message === "fetch failed") {
    if (profile.baseUrl === "http://127.0.0.1:4096") {
      return "Run: opencode serve --port 4096, then opencode attach http://127.0.0.1:4096.";
    }
    return `Run: start OpenCode at ${profile.baseUrl}, then attach with opencode attach ${profile.baseUrl}.`;
  }

  return message;
}

export function opencodeAttachHint(profiles: OpencodeConnectionProfile[]): string {
  const targets = [...new Set(profiles.map((profile) => profile.baseUrl))];
  if (targets.length === 1 && targets[0]) {
    return `Run: opencode attach ${targets[0]}.`;
  }
  return "Run: opencode attach <url> for one of the configured OpenCode servers.";
}

export function opencodeReadyDetail(profiles: OpencodeConnectionProfile[], reachable: number): string {
  const targets = [...new Set(profiles.map((profile) => profile.baseUrl))];
  if (targets.length === 1 && targets[0]) {
    return `Connected OpenCode at ${targets[0]} (${reachable} profile${reachable === 1 ? "" : "s"}).`;
  }
  return `Connected ${reachable} OpenCode profile${reachable === 1 ? "" : "s"} across ${targets.length} servers.`;
}

export function runtimeHasLiveOpencodeActivity(snapshot: ApertureRuntimeSnapshot): boolean {
  const frames = [
    ...(snapshot.attentionView.active ? [snapshot.attentionView.active] : []),
    ...snapshot.attentionView.queued,
    ...snapshot.attentionView.ambient,
  ];

  return frames.some((frame) => {
    if (frame.source?.kind !== "opencode") {
      return false;
    }
    return frame.title.trim().toLowerCase() !== "opencode event stream disconnected";
  });
}
