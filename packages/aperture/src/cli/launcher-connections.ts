import type { ApertureRuntimeSnapshot } from "@aperture/runtime";

import { LauncherConnectionStore } from "../connection-status.js";
import {
  claudeBridgeUrl,
  isClaudeBridgePortInUse,
  readyClaudeState,
  runtimeHasLiveClaudeActivity,
  startLauncherClaudeAdapter,
} from "./claude-adapter.js";
import type { ClaudeHookInstallResult } from "./claude-hooks.js";
import {
  codexHookBridgeUrl,
  isCodexHookPortInUse,
  readyCodexState,
  runtimeHasLiveCodexActivity,
  startLauncherCodexHookAdapter,
} from "./codex-adapter.js";
import type { CodexHookInstallResult } from "./codex-hooks.js";
import { fetchRuntimeSnapshot, runtimeHasAdapter } from "./runtime-support.js";

export async function startClaudeConnection(
  runtimeBaseUrl: string,
  runtimeSnapshot: ApertureRuntimeSnapshot,
  install: ClaudeHookInstallResult | null,
  registerCleanup: (cleanup: () => Promise<void>) => void,
  connections: LauncherConnectionStore,
): Promise<void> {
  if (runtimeHasAdapter(runtimeSnapshot, "claude-code")) {
    connections.update("claude", readyClaudeState(install?.changed ?? false, true));
    return;
  }

  connections.update("claude", {
    state: "starting",
    detail: install?.changed
      ? "Claude bridge is starting. Restart Claude Code after it comes up."
      : "Starting the Claude Code bridge.",
    ...(install?.changed
      ? { hint: "Restart Claude Code and run /hooks once to load the updated hooks." }
      : {}),
  });

  try {
    const adapter = await startLauncherClaudeAdapter(runtimeBaseUrl);
    registerCleanup(() => adapter.close());
    connections.update("claude", readyClaudeState(install?.changed ?? false, false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isClaudeBridgePortInUse(message)) {
      const endpoint = claudeBridgeUrl();
      const latestSnapshot = await fetchRuntimeSnapshot(runtimeBaseUrl);
      if (
        runtimeHasAdapter(latestSnapshot, "claude-code") ||
        runtimeHasLiveClaudeActivity(latestSnapshot)
      ) {
        connections.update("claude", {
          ...readyClaudeState(install?.changed ?? false, true),
          detail: install?.changed
            ? "Using an existing Claude bridge. Claude Code still needs to reload the updated hooks."
            : `Using an existing Claude bridge at ${endpoint}.`,
        });
        return;
      }
      connections.update("claude", {
        state: "action",
        detail: `Another Claude bridge is already listening at ${endpoint}.`,
        hint: "If Claude is already working, keep using that bridge. Otherwise stop the other process and retry, or launch with --no-claude.",
      });
      return;
    }
    connections.update("claude", {
      state: "error",
      detail: `Claude bridge failed to start: ${message}`,
      hint: "Run `aperture internal claude-adapter` directly to inspect the failure.",
    });
  }
}

export async function startCodexConnection(
  runtimeBaseUrl: string,
  runtimeSnapshot: ApertureRuntimeSnapshot,
  install: CodexHookInstallResult | null,
  registerCleanup: (cleanup: () => Promise<void>) => void,
  connections: LauncherConnectionStore,
): Promise<void> {
  if (runtimeHasAdapter(runtimeSnapshot, "codex")) {
    connections.update("codex", readyCodexState(install?.changed ?? false, true));
    return;
  }

  connections.update("codex", {
    state: "starting",
    detail: install?.changed
      ? "Codex hook bridge is starting. Restart Codex after it comes up."
      : "Starting the Codex hook bridge.",
    ...(install?.changed
      ? { hint: "Restart Codex and run /hooks if available to load the updated hooks." }
      : {}),
  });

  try {
    const adapter = await startLauncherCodexHookAdapter(runtimeBaseUrl);
    registerCleanup(() => adapter.close());
    connections.update("codex", readyCodexState(install?.changed ?? false, false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCodexHookPortInUse(message)) {
      const endpoint = codexHookBridgeUrl();
      const latestSnapshot = await fetchRuntimeSnapshot(runtimeBaseUrl);
      if (
        runtimeHasAdapter(latestSnapshot, "codex") ||
        runtimeHasLiveCodexActivity(latestSnapshot)
      ) {
        connections.update("codex", {
          ...readyCodexState(install?.changed ?? false, true),
          detail: install?.changed
            ? "Using an existing Codex hook bridge. Codex still needs to reload the updated hooks."
            : `Using an existing Codex hook bridge at ${endpoint}.`,
        });
        return;
      }
      connections.update("codex", {
        state: "action",
        detail: `Another Codex hook bridge is already listening at ${endpoint}.`,
        hint: "If Codex is already working, keep using that bridge. Otherwise stop the other process and retry, or launch without --codex.",
      });
      return;
    }
    connections.update("codex", {
      state: "error",
      detail: `Codex hook bridge failed to start: ${message}`,
      hint: "Run `aperture internal codex-hook-adapter` directly to inspect the failure.",
    });
  }
}
