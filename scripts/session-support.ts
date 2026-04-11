import { stderr } from "node:process";

import { discoverLocalRuntimes, type ApertureRuntimeSessionCapture } from "@aperture/runtime";

export function normalizeRuntimeUrl(runtimeUrl: string): string {
  return runtimeUrl.replace(/\/+$/, "");
}

export async function resolveSessionRuntimeUrl(
  explicit?: string,
  options: {
    envVars?: string[];
    emptyMessage?: string;
    multipleLabel?: string;
    defaultUrl?: string;
  } = {},
): Promise<string> {
  if (explicit) {
    return normalizeRuntimeUrl(explicit);
  }

  for (const envVar of options.envVars ?? ["APERTURE_RUNTIME_URL"]) {
    const value = process.env[envVar];
    if (value) {
      return normalizeRuntimeUrl(value);
    }
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error(options.emptyMessage ?? "No live Aperture runtime found.");
  }

  if (runtimes.length > 1) {
    const label = options.multipleLabel ?? "session tools";
    stderr.write("Multiple live Aperture runtimes detected:\n");
    for (const runtime of runtimes) {
      stderr.write(`- ${runtime.controlUrl} (pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting ${label} to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? options.defaultUrl ?? "http://127.0.0.1:4546/runtime";
}

export async function fetchRuntimeSessionCapture(
  runtimeUrl: string,
): Promise<ApertureRuntimeSessionCapture> {
  const response = await fetch(`${normalizeRuntimeUrl(runtimeUrl)}/session`);
  if (!response.ok) {
    throw new Error(
      `Failed to export runtime session capture from ${normalizeRuntimeUrl(runtimeUrl)} (${response.status})`,
    );
  }

  return response.json() as Promise<ApertureRuntimeSessionCapture>;
}
