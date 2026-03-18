import { stderr } from "node:process";

import { createCodexBridge } from "../packages/codex/src/index.ts";
import { discoverLocalRuntimes } from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const runtimeBaseUrl = await resolveRuntimeUrl();
  const bridge = createCodexBridge({
    runtimeBaseUrl,
    runtimeLabel: process.env.APERTURE_CODEX_LABEL ?? "Codex adapter",
    ...(process.env.APERTURE_CODEX_SOURCE_LABEL
      ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
      : {}),
    appServer: {
      ...(process.env.APERTURE_CODEX_COMMAND
        ? { command: process.env.APERTURE_CODEX_COMMAND }
        : {}),
      ...(process.env.APERTURE_CODEX_CWD ? { cwd: process.env.APERTURE_CODEX_CWD } : {}),
    },
    logger: {
      info(message: string) {
        stderr.write(`${message}\n`);
      },
      warn(message: string) {
        stderr.write(`${message}\n`);
      },
      error(message: string) {
        stderr.write(`${message}\n`);
      },
    },
  });

  await bridge.start();

  stderr.write(`Aperture Codex adapter ready via runtime ${runtimeBaseUrl}\n`);
  stderr.write("Run the TUI separately with: pnpm tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await bridge.close();
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

async function resolveRuntimeUrl(): Promise<string> {
  const explicit = process.env.APERTURE_RUNTIME_URL ?? process.env.APERTURE_CODEX_RUNTIME_URL;
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
    stderr.write(`Connecting Codex adapter to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
