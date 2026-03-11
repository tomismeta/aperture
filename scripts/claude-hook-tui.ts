import { stderr } from "node:process";

import { ApertureRuntimeClient, discoverLocalRuntimes } from "../packages/runtime/src/index.ts";
import { runAttentionTui } from "../packages/tui/src/index.ts";

async function main(): Promise<void> {
  const baseUrl = await resolveRuntimeUrl();

  const client = await ApertureRuntimeClient.connect({
    baseUrl,
    label: "tui",
  });

  stderr.write(`Connected Aperture TUI to ${baseUrl}\n`);

  try {
    await runAttentionTui(client, { title: "Aperture" });
  } finally {
    await client.close();
  }
}

async function resolveRuntimeUrl(): Promise<string> {
  const explicit = process.env.APERTURE_RUNTIME_URL ?? process.env.APERTURE_CLAUDE_RUNTIME_URL;
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
      const adapters = runtime.metadata?.adapters ?? "unknown";
      stderr.write(`- ${runtime.controlUrl} (adapters ${adapters}, pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

void main();
