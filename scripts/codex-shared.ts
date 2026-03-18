import { stderr } from "node:process";

import { discoverLocalRuntimes } from "../packages/runtime/src/index.ts";

export async function resolveCodexRuntimeUrl(
  envVar: "APERTURE_CODEX_RUNTIME_URL" | "APERTURE_RUNTIME_URL" = "APERTURE_CODEX_RUNTIME_URL",
): Promise<string> {
  const explicit = process.env[envVar] ?? process.env.APERTURE_RUNTIME_URL;
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

export function createStderrLogger(): Pick<Console, "info" | "warn" | "error"> {
  return {
    info(message: string) {
      stderr.write(`${message}\n`);
    },
    warn(message: string) {
      stderr.write(`${message}\n`);
    },
    error(message: string) {
      stderr.write(`${message}\n`);
    },
  };
}
