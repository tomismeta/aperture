import { stderr } from "node:process";

import { createCodexHookServer, codexHookFallbackEvent } from "../packages/codex/src/index.ts";
import { ApertureRuntimeAdapterClient } from "@aperture/runtime";
import { createStderrLogger, resolveCodexRuntimeUrl } from "./codex-shared.ts";

async function main(): Promise<void> {
  const host = process.env.APERTURE_CODEX_HOOK_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CODEX_HOOK_PORT) ?? 4547;
  const path = process.env.APERTURE_CODEX_HOOK_PATH ?? "/hook";
  const runtimeBaseUrl = await resolveCodexRuntimeUrl();
  const logger = createStderrLogger();
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "codex",
    id: "codex-hooks",
    label: "Codex hook server",
    metadata: {
      transport: "hooks",
    },
  });

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
      publishFallback(event, reason);
    },
    onPermissionRequestFallback: (event, reason) => {
      publishFallback(event, reason);
    },
  });

  function publishFallback(
    event: Parameters<typeof codexHookFallbackEvent>[0],
    reason: Parameters<typeof codexHookFallbackEvent>[1],
  ): void {
      void adapterClient.publishSourceEvent(
        codexHookFallbackEvent(
          event,
          reason,
          process.env.APERTURE_CODEX_SOURCE_LABEL
            ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
            : undefined,
        ),
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Unable to publish Codex hook fallback event: ${message}`);
      });
  }

  const binding = await hookServer.listen();

  stderr.write(`Aperture Codex hook adapter listening at ${binding.url}\n`);
  stderr.write(`Connected Codex hook adapter to runtime ${runtimeBaseUrl}\n`);
  stderr.write("Run the TUI separately with: pnpm tui\n");

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

function readNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
