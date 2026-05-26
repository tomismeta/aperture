import { stderr, stdin, stdout } from "node:process";

import { createCodexHookServer } from "@aperture/codex/hook-server";
import { codexHookFallbackEvent } from "@aperture/codex/hook-server-support";
import { ApertureRuntimeAdapterClient, type ApertureRuntimeSnapshot } from "@aperture/runtime";

import { codexHookBridgeUrl, codexHookForwardUrl } from "./codex-hook-url.js";
import { readNumber } from "./shared.js";

export async function runCodexForward(args: string[] = []): Promise<void> {
  const chunks: Buffer[] = [];
  const targetOverride = parseForwardUrl(args);

  stdin.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  stdin.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const target = targetOverride ?? codexHookForwardUrl();

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body,
      });

      const text = await response.text();
      if (!response.ok) {
        stderr.write(
          `Aperture Codex hook forward failed: ${response.status} ${response.statusText}\n`,
        );
        if (text) {
          stderr.write(`${text}\n`);
        }
        process.exit(0);
        return;
      }

      if (text) {
        stdout.write(text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Aperture Codex hook forward failed: ${message}\n`);
      process.exit(0);
    }
  });
}

export async function runCodexHookAdapter(runtimeBaseUrl: string): Promise<void> {
  const host = process.env.APERTURE_CODEX_HOOK_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CODEX_HOOK_PORT) ?? 4547;
  const path = process.env.APERTURE_CODEX_HOOK_PATH ?? "/hook";
  const adapterClient = await createCodexHookAdapterClient(runtimeBaseUrl);
  const hookServer = createCodexHookServer(adapterClient, {
    host,
    port,
    path,
    ...(process.env.APERTURE_CODEX_SOURCE_LABEL
      ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
      : {}),
    preToolUsePolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "allow"),
    permissionRequestPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "allow"),
    onPreToolUseFallback: (event, reason) => {
      publishCodexFallback(adapterClient, event, reason);
    },
    onPermissionRequestFallback: (event, reason) => {
      publishCodexFallback(adapterClient, event, reason);
    },
  });
  const binding = await hookServer.listen();

  stderr.write(`Aperture Codex hook adapter listening at ${binding.url}\n`);
  stderr.write(`Connected Codex hook adapter to runtime ${runtimeBaseUrl}\n`);
  stderr.write("Run the TUI separately with: aperture internal tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await hookServer.close();
    await adapterClient.close();
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export async function startLauncherCodexHookAdapter(runtimeBaseUrl: string) {
  const adapterClient = await createCodexHookAdapterClient(runtimeBaseUrl);
  const hookServer = createCodexHookServer(adapterClient, {
    host: process.env.APERTURE_CODEX_HOOK_HOST ?? "127.0.0.1",
    port: readNumber(process.env.APERTURE_CODEX_HOOK_PORT) ?? 4547,
    path: process.env.APERTURE_CODEX_HOOK_PATH ?? "/hook",
    ...(process.env.APERTURE_CODEX_SOURCE_LABEL
      ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
      : {}),
    preToolUsePolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "allow"),
    permissionRequestPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "allow"),
    onPreToolUseFallback: (event, reason) => {
      publishCodexFallback(adapterClient, event, reason);
    },
    onPermissionRequestFallback: (event, reason) => {
      publishCodexFallback(adapterClient, event, reason);
    },
  });
  await hookServer.listen();

  return {
    async close() {
      await hookServer.close();
      await adapterClient.close();
    },
  };
}

export function readyCodexState(
  changedHooks: boolean,
  attachedExisting: boolean,
): {
  state: "ready" | "action";
  detail: string;
  hint?: string;
} {
  const endpoint = codexHookBridgeUrl();
  if (changedHooks) {
    return {
      state: "action",
      detail: attachedExisting
        ? `Using an existing Codex hook bridge at ${endpoint}, but Codex still needs to reload the updated hooks.`
        : `Codex hook bridge is ready at ${endpoint}. Codex still needs to reload the updated hooks.`,
      hint: "Restart Codex and run /hooks if available to review and trust the hooks.",
    };
  }

  return {
    state: "ready",
    detail: attachedExisting
      ? `Using an existing Codex hook bridge at ${endpoint}.`
      : `Listening for Codex hooks at ${endpoint}.`,
  };
}

export function runtimeHasLiveCodexActivity(snapshot: ApertureRuntimeSnapshot): boolean {
  const frames = [
    ...(snapshot.attentionView.now ? [snapshot.attentionView.now] : []),
    ...snapshot.attentionView.next,
    ...snapshot.attentionView.ambient,
  ];

  return frames.some((frame) => frame.source?.kind === "codex");
}

export function isCodexHookPortInUse(message: string): boolean {
  return message.includes("EADDRINUSE");
}

function createCodexHookAdapterClient(runtimeBaseUrl: string) {
  return ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "codex",
    id: "codex-hooks",
    label: "Codex hook server",
    metadata: {
      transport: "hooks",
    },
  });
}

function publishCodexFallback(
  adapterClient: Awaited<ReturnType<typeof createCodexHookAdapterClient>>,
  event: Parameters<typeof codexHookFallbackEvent>[0],
  reason: Parameters<typeof codexHookFallbackEvent>[1],
): void {
  void adapterClient
    .publishSourceEvent(
      codexHookFallbackEvent(
        event,
        reason,
        process.env.APERTURE_CODEX_SOURCE_LABEL
          ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
          : undefined,
      ),
    )
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Unable to publish Codex hook fallback event: ${message}\n`);
    });
}

function parseForwardUrl(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Usage: aperture internal hook codex-forward [--url URL]");
      }
      return value;
    }

    if (arg?.startsWith("--url=")) {
      const value = arg.slice("--url=".length);
      if (!value) {
        throw new Error("Usage: aperture internal hook codex-forward [--url URL]");
      }
      return value;
    }
  }

  return undefined;
}
