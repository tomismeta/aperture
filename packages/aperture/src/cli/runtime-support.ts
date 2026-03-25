import { stderr } from "node:process";

import {
  ApertureRuntimeClient,
  baseAttentionSurfaceCapabilities,
  bootstrapLearningPersistence,
  createApertureRuntime,
  discoverLocalRuntimes,
  type ApertureRuntimeSnapshot,
  type ApertureRuntimeSessionCapture,
} from "@aperture/runtime";
import { runAttentionTui } from "@aperture/tui";

import { apertureLearningWorkspaceRoot } from "../opencode-config.js";
import { readNumber } from "./shared.js";

export type RuntimeBinding = {
  runtimeBaseUrl: string;
  reusedExistingRuntime: boolean;
  close?: () => Promise<void>;
};

export async function runRuntimeServer(args: string[]): Promise<void> {
  const learning = readLearningMode(args);
  const controlHost = process.env.APERTURE_CONTROL_HOST ?? "127.0.0.1";
  const controlPort = readNumber(process.env.APERTURE_CONTROL_PORT) ?? 4546;
  const controlPathPrefix = process.env.APERTURE_CONTROL_PATH ?? "/runtime";
  const learningBootstrap = learning === "on"
    ? await bootstrapLearningPersistence(apertureLearningWorkspaceRoot())
    : null;

  const runtime = createApertureRuntime({
    kind: "aperture",
    controlHost,
    controlPort,
    controlPathPrefix,
    ...(learningBootstrap
      ? {
          core: learningBootstrap.core,
          learningPersistence: learningBootstrap.state,
        }
      : {}),
  });
  const binding = await runtime.listen();

  stderr.write(`Aperture runtime listening at ${binding.controlUrl}\n`);
  stderr.write(`Learning persistence ${learning === "on" ? "enabled" : "disabled"}\n`);
  stderr.write("Start adapters separately, for example: aperture internal claude-adapter or aperture internal opencode-adapter\n");
  stderr.write("Open the TUI separately with: aperture internal tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await runtime.close();
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export async function runTui(): Promise<void> {
  const baseUrl = await resolveRuntimeUrl("Aperture TUI", ["APERTURE_RUNTIME_URL", "APERTURE_CLAUDE_RUNTIME_URL"]);

  const client = await ApertureRuntimeClient.connect({
    baseUrl,
    label: "tui",
    surfaceCapabilities: {
      ...baseAttentionSurfaceCapabilities,
      responses: {
        ...baseAttentionSurfaceCapabilities.responses,
        supportsTextResponse: true,
      },
    },
  });

  stderr.write(`Connected Aperture TUI to ${baseUrl}\n`);

  try {
    await runAttentionTui(client, {
      title: "Aperture",
      terminalTitle: "Aperture",
    });
  } finally {
    await client.close();
  }
}

export async function fetchSessionCapture(runtimeUrl: string): Promise<ApertureRuntimeSessionCapture> {
  const response = await fetch(`${runtimeUrl}/session`);
  if (!response.ok) {
    throw new Error(`Failed to export runtime session capture from ${runtimeUrl} (${response.status})`);
  }

  return response.json() as Promise<ApertureRuntimeSessionCapture>;
}

export async function fetchRuntimeSnapshot(runtimeUrl: string): Promise<ApertureRuntimeSnapshot> {
  const response = await fetch(`${runtimeUrl}/state`);
  if (!response.ok) {
    throw new Error(`Failed to fetch runtime state from ${runtimeUrl} (${response.status})`);
  }

  return response.json() as Promise<ApertureRuntimeSnapshot>;
}

export async function discoverRuntimeUrl(): Promise<string | null> {
  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    return null;
  }

  if (runtimes.length > 1) {
    stderr.write("Multiple live Aperture runtimes detected:\n");
    for (const runtime of runtimes) {
      stderr.write(`- ${runtime.controlUrl} (pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl?.replace(/\/+$/, "") ?? null;
}

export async function resolveRuntimeUrl(label: string, envVars: string[]): Promise<string> {
  for (const envVar of envVars) {
    const explicit = process.env[envVar];
    if (explicit) {
      return explicit.replace(/\/+$/, "");
    }
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error(`No live Aperture runtime found. Start one with \`aperture\` or \`aperture internal runtime\` before launching ${label}.`);
  }

  if (runtimes.length > 1) {
    stderr.write("Multiple live Aperture runtimes detected:\n");
    for (const runtime of runtimes) {
      stderr.write(`- ${runtime.controlUrl} (pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting ${label} to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

export function runtimeHasAdapter(snapshot: ApertureRuntimeSnapshot, kind: string): boolean {
  return snapshot.adapters.some((adapter) => adapter.kind === kind);
}

function readLearningMode(args: string[]): "on" | "off" {
  const flagIndex = args.findIndex((arg) => arg === "--learning");
  if (flagIndex === -1) {
    return "on";
  }

  const value = args[flagIndex + 1];
  if (value === "off") {
    return "off";
  }
  return "on";
}
