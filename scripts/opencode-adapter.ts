import { stderr } from "node:process";

import { createOpencodeBridge } from "../packages/opencode/src/index.ts";
import { discoverLocalRuntimes } from "../packages/runtime/src/index.ts";
import {
  listEnabledGlobalOpencodeProfiles,
  resolveProfilePassword,
} from "./opencode-config.ts";

async function main(): Promise<void> {
  const profiles = await listEnabledGlobalOpencodeProfiles();

  if (profiles.length === 0) {
    stderr.write("No enabled OpenCode connection profiles found. Use `pnpm opencode:connect --global`.\n");
    return;
  }

  const runtimeBaseUrl = await resolveRuntimeUrl();

  const bridges = [];
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
  stderr.write("Run the TUI separately with: pnpm tui\n");

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

async function resolveRuntimeUrl(): Promise<string> {
  const explicit = process.env.APERTURE_RUNTIME_URL ?? process.env.APERTURE_OPENCODE_RUNTIME_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error("No live Aperture runtime found. Start one with `pnpm serve`.");
  }

  if (runtimes.length > 1) {
    stderr.write("Multiple live Aperture runtimes detected:\n");
    for (const runtime of runtimes) {
      stderr.write(`- ${runtime.controlUrl} (pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting OpenCode adapter to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
