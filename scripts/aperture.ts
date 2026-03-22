import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { stderr, stdout } from "node:process";

import {
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  sliceRuntimeSessionCapture,
  writeSessionBundle,
  type RuntimeSessionCaptureCursor,
} from "../packages/lab/src/index.ts";
import {
  discoverLocalRuntimes,
  type ApertureRuntimeSnapshot,
  type ApertureRuntimeSessionCapture,
} from "../packages/runtime/src/index.ts";
import {
  listEnabledGlobalOpencodeProfiles,
  normalizeBaseUrl,
  saveGlobalOpencodeProfile,
} from "./opencode-config.ts";

type CaptureOptions = {
  outputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags: string[];
};

type CliOptions = {
  help: boolean;
  learningMode: "on" | "off";
  learningExplicit: boolean;
  enableClaude: boolean;
  enableOpencode: boolean;
  enableCodex: boolean;
  codexArgs: string[];
  capture: CaptureOptions | null;
};

type RuntimeBinding = {
  runtimeBaseUrl: string;
  reusedExistingRuntime: boolean;
};

type ReadyOptions = {
  timeoutMs?: number;
};

const REQUIRED_STARTUP_TIMEOUT_MS = 15_000;
const OPTIONAL_STARTUP_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const children: ChildProcess[] = [];
  let shuttingDown = false;
  let runtimeBaseUrl: string | null = null;
  let captureCursor: RuntimeSessionCaptureCursor | null = null;

  process.title = "aperture";

  const close = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);

    let nextExitCode = exitCode;

    if (runtimeBaseUrl && options.capture && captureCursor) {
      try {
        await exportCapturedSession(runtimeBaseUrl, captureCursor, options.capture);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`Failed to export captured session bundle: ${message}\n`);
        if (nextExitCode === 0) {
          nextExitCode = 1;
        }
      }
    }

    for (const child of [...children].reverse()) {
      child.kill("SIGTERM");
    }

    await Promise.all(children.map(waitForExit));
    process.exit(nextExitCode);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    if (options.enableClaude) {
      await ensureClaudeHooksConfigured();
    }

    if (options.enableOpencode) {
      await ensureDefaultOpencodeProfile();
    }

    const runtime = await ensureRuntime(options, children);
    runtimeBaseUrl = runtime.runtimeBaseUrl;

    if (runtime.reusedExistingRuntime) {
      stdout.write(`Reusing existing Aperture runtime at ${runtime.runtimeBaseUrl}\n`);
      if (options.learningExplicit) {
        stdout.write(
          `Learning mode remains unchanged because the runtime is already running (${options.learningMode} was requested).\n`,
        );
      }
    }

    const childEnv = {
      ...process.env,
      APERTURE_RUNTIME_URL: runtime.runtimeBaseUrl,
    };
    const runtimeSnapshot = await fetchRuntimeSnapshot(runtime.runtimeBaseUrl);

    if (options.enableClaude) {
      if (runtimeHasAdapter(runtimeSnapshot, "claude-code")) {
        stdout.write("Claude Code adapter already attached to this runtime.\n");
      } else {
        await startOptionalService(
          "Claude Code adapter",
          ["claude:start"],
          "Aperture Claude adapter listening",
          childEnv,
          children,
        );
      }
    }

    if (options.enableOpencode) {
      const hasOpencodeProfiles = (await listEnabledGlobalOpencodeProfiles()).length > 0;
      if (hasOpencodeProfiles) {
        if (runtimeHasAdapter(runtimeSnapshot, "opencode")) {
          stdout.write("OpenCode adapter already attached to this runtime.\n");
        } else {
          await startOptionalService(
            "OpenCode adapter",
            ["opencode:start"],
            "Aperture OpenCode adapter ready",
            childEnv,
            children,
          );
        }
      }
    }

    if (options.enableCodex) {
      if (runtimeHasAdapter(runtimeSnapshot, "codex")) {
        stdout.write("Codex adapter already attached to this runtime.\n");
      } else {
        await startOptionalService(
          "Codex adapter",
          ["codex:start", ...(options.codexArgs.length > 0 ? ["--", ...options.codexArgs] : [])],
          "Aperture Codex adapter ready",
          childEnv,
          children,
        );
      }
    }

    if (options.capture) {
      captureCursor = await beginCapture(runtime.runtimeBaseUrl);
    }

    const tui = spawn("pnpm", ["tui"], {
      stdio: "inherit",
      env: childEnv,
    });

    tui.once("exit", (code) => {
      void close(code ?? 0);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    await close(1);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    learningMode: "on",
    learningExplicit: false,
    enableClaude: true,
    enableOpencode: true,
    enableCodex: process.env.APERTURE_ENABLE_CODEX === "1",
    codexArgs: [],
    capture: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        continue;
      case "--learning":
        if (!next || next.startsWith("-")) {
          throw new Error("--learning requires a value");
        }
        options.learningMode = next === "off" ? "off" : "on";
        options.learningExplicit = true;
        index += 1;
        continue;
      case "--no-claude":
        options.enableClaude = false;
        continue;
      case "--no-opencode":
        options.enableOpencode = false;
        continue;
      case "--codex":
        options.enableCodex = true;
        continue;
      case "--codex-transport":
        if (!next || next.startsWith("-")) {
          throw new Error("--codex-transport requires a value");
        }
        options.enableCodex = true;
        options.codexArgs.push("--transport", next);
        index += 1;
        continue;
      case "--codex-url":
        if (!next || next.startsWith("-")) {
          throw new Error("--codex-url requires a value");
        }
        options.enableCodex = true;
        options.codexArgs.push("--url", next);
        index += 1;
        continue;
      case "--codex-command":
        if (!next || next.startsWith("-")) {
          throw new Error("--codex-command requires a value");
        }
        options.enableCodex = true;
        options.codexArgs.push("--command", next);
        index += 1;
        continue;
      case "--capture":
        ensureCaptureOptions(options);
        continue;
      case "--capture-out":
        ensureCaptureOptions(options).outputPath = readRequiredValue(arg, next);
        index += 1;
        continue;
      case "--capture-session-id":
        ensureCaptureOptions(options).sessionId = readRequiredValue(arg, next);
        index += 1;
        continue;
      case "--capture-title":
        ensureCaptureOptions(options).title = readRequiredValue(arg, next);
        index += 1;
        continue;
      case "--capture-description":
        ensureCaptureOptions(options).description = readRequiredValue(arg, next);
        index += 1;
        continue;
      case "--capture-tag":
        ensureCaptureOptions(options).doctrineTags.push(readRequiredValue(arg, next));
        index += 1;
        continue;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function ensureCaptureOptions(options: CliOptions): CaptureOptions {
  if (!options.capture) {
    options.capture = {
      doctrineTags: [],
    };
  }

  return options.capture;
}

function readRequiredValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

async function ensureClaudeHooksConfigured(): Promise<void> {
  try {
    await runPnpmOnce(["claude:connect", "--global"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Warning: could not ensure Claude Code hooks were installed globally: ${message}\n`);
  }
}

async function ensureDefaultOpencodeProfile(): Promise<void> {
  const enabledProfiles = await listEnabledGlobalOpencodeProfiles();
  if (enabledProfiles.length > 0) {
    return;
  }

  await saveGlobalOpencodeProfile({
    id: "default",
    baseUrl: normalizeBaseUrl("http://127.0.0.1:4096"),
    enabled: true,
  });
  stdout.write("Configured a default OpenCode profile at http://127.0.0.1:4096.\n");
}

async function ensureRuntime(options: CliOptions, children: ChildProcess[]): Promise<RuntimeBinding> {
  const explicitRuntimeUrl = process.env.APERTURE_RUNTIME_URL;
  if (explicitRuntimeUrl) {
    return {
      runtimeBaseUrl: explicitRuntimeUrl.replace(/\/+$/, ""),
      reusedExistingRuntime: true,
    };
  }

  const existingRuntimeUrl = await discoverRuntimeUrl();
  if (existingRuntimeUrl) {
    return {
      runtimeBaseUrl: existingRuntimeUrl,
      reusedExistingRuntime: true,
    };
  }

  const runtime = spawnPnpm(["serve", "--", "--learning", options.learningMode]);
  children.push(runtime);
  await waitForReady(runtime, "Aperture runtime listening", {
    timeoutMs: REQUIRED_STARTUP_TIMEOUT_MS,
  });

  const runtimeBaseUrl = await discoverRuntimeUrl();
  if (!runtimeBaseUrl) {
    throw new Error("Aperture runtime became ready but could not be discovered.");
  }

  return {
    runtimeBaseUrl,
    reusedExistingRuntime: false,
  };
}

async function startOptionalService(
  label: string,
  args: string[],
  marker: string,
  env: NodeJS.ProcessEnv,
  children: ChildProcess[],
): Promise<boolean> {
  const child = spawnPnpm(args, env);
  children.push(child);

  try {
    await waitForReady(child, marker, { timeoutMs: OPTIONAL_STARTUP_TIMEOUT_MS });
    return true;
  } catch (error) {
    removeChild(children, child);
    child.kill("SIGTERM");
    await waitForExit(child);
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Warning: ${label} did not become ready. Continuing without it. ${message}\n`);
    return false;
  }
}

async function beginCapture(runtimeUrl: string): Promise<RuntimeSessionCaptureCursor> {
  const baseline = await fetchSessionCapture(runtimeUrl);
  const cursor = createRuntimeSessionCaptureCursor(baseline);
  const baselineFrameCount =
    (baseline.attentionView.active ? 1 : 0)
    + baseline.attentionView.queued.length
    + baseline.attentionView.ambient.length;

  stdout.write(`Capture enabled for this Aperture session (${runtimeUrl})\n`);
  stdout.write(`- baseline steps: ${cursor.counts.steps}\n`);
  stdout.write(`- baseline source events: ${cursor.counts.sourceEvents}\n`);
  stdout.write(`- baseline queued: ${baseline.attentionView.queued.length}\n`);
  stdout.write(`- baseline ambient: ${baseline.attentionView.ambient.length}\n`);
  if (baselineFrameCount > 0) {
    stdout.write(
      "Note: the runtime already has visible state. The capture will slice new logs only, but the final bundle may still reflect earlier frames.\n",
    );
  }

  return cursor;
}

async function exportCapturedSession(
  runtimeUrl: string,
  cursor: RuntimeSessionCaptureCursor,
  options: CaptureOptions,
): Promise<void> {
  const capture = await fetchSessionCapture(runtimeUrl);
  const slicedCapture = sliceRuntimeSessionCapture(capture, cursor);
  const exportedAt = new Date().toISOString();
  const doctrineTags = uniqueStrings(["harvested", "launcher", ...options.doctrineTags]);

  if (slicedCapture.steps.length === 0) {
    stdout.write("No new runtime activity was captured during this Aperture session.\n");
    return;
  }

  const bundle = createSessionBundleFromRuntimeCapture(slicedCapture, {
    sessionId: options.sessionId ?? randomUUID(),
    title: options.title ?? defaultLauncherCaptureTitle(exportedAt),
    ...(options.description !== undefined ? { description: options.description } : {}),
    doctrineTags,
    exportedAt,
    source: {
      id: capture.kind,
      kind: "runtime",
      label: `Aperture runtime (${capture.kind})`,
      capture: {
        eventTransport: "runtime_capture",
        semanticCapture: "source+normalized+trace",
        notes: ["captured via pnpm aperture --capture"],
      },
    },
  });
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : defaultSessionBundlePath(bundle);

  await writeSessionBundle(outputPath, bundle);

  stdout.write(`Wrote captured session bundle to ${outputPath}\n`);
  stdout.write(`- session: ${bundle.sessionId}\n`);
  stdout.write(`- steps: ${bundle.steps.length}\n`);
  stdout.write(`- traces: ${bundle.traces.length}\n`);
  stdout.write(`- active: ${bundle.outcomes.finalActiveInteractionId ?? "none"}\n`);
  stdout.write(`- queued: ${bundle.outcomes.finalQueuedCount}\n`);
  stdout.write(`- ambient: ${bundle.outcomes.finalAmbientCount}\n`);
}

async function fetchSessionCapture(runtimeUrl: string): Promise<ApertureRuntimeSessionCapture> {
  const response = await fetch(`${runtimeUrl}/session`);
  if (!response.ok) {
    throw new Error(`Failed to export runtime session capture from ${runtimeUrl} (${response.status})`);
  }

  return response.json() as Promise<ApertureRuntimeSessionCapture>;
}

async function fetchRuntimeSnapshot(runtimeUrl: string): Promise<ApertureRuntimeSnapshot> {
  const response = await fetch(`${runtimeUrl}/state`);
  if (!response.ok) {
    throw new Error(`Failed to fetch runtime state from ${runtimeUrl} (${response.status})`);
  }

  return response.json() as Promise<ApertureRuntimeSnapshot>;
}

async function discoverRuntimeUrl(): Promise<string | null> {
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

function runtimeHasAdapter(snapshot: ApertureRuntimeSnapshot, kind: string): boolean {
  return snapshot.adapters.some((adapter) => adapter.kind === kind);
}

function spawnPnpm(args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const child = spawn("pnpm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout.write(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr.write(chunk.toString());
  });

  return child;
}

async function waitForReady(child: ChildProcess, marker: string, options: ReadyOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? OPTIONAL_STARTUP_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    let buffer = "";
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${marker}" after ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes(marker)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Process exited before becoming ready (code ${code ?? "unknown"})`));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
  });
}

async function runPnpmOnce(args: string[]): Promise<void> {
  const child = spawn("pnpm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let combinedOutput = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    combinedOutput += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    combinedOutput += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`pnpm ${args.join(" ")} timed out before completing`));
    }, OPTIONAL_STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(timeoutId);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new Error(combinedOutput.trim() || `pnpm ${args.join(" ")} exited with code ${exitCode ?? "unknown"}`);
  }
}

function removeChild(children: ChildProcess[], child: ChildProcess): void {
  const index = children.indexOf(child);
  if (index !== -1) {
    children.splice(index, 1);
  }
}

function defaultLauncherCaptureTitle(exportedAt: string): string {
  const date = new Date(exportedAt);
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `Aperture harvested session ${formatter.format(date)}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function printHelp(): void {
  stdout.write(
    [
      "Usage: pnpm aperture [options]",
      "",
      "Starts an opinionated Aperture stack:",
      "- reuses an existing runtime when one is already live",
      "- otherwise starts the runtime with learning enabled by default",
      "- ensures Claude Code hooks are configured globally",
      "- ensures an OpenCode profile exists",
      "- starts Claude Code, OpenCode, and optional Codex adapters when available",
      "- opens the shared Aperture TUI",
      "",
      "Options:",
      "  --learning <on|off>         Start a new runtime with learning on or off",
      "  --no-claude                 Skip starting the Claude Code adapter",
      "  --no-opencode               Skip starting the OpenCode adapter",
      "  --codex                     Start the Codex adapter too",
      "  --codex-transport <kind>    Pass a transport override to codex:start",
      "  --codex-url <url>           Pass a URL override to codex:start",
      "  --codex-command <command>   Pass a command override to codex:start",
      "  --capture                   Export a sliced Lab session bundle when Aperture exits",
      "                              Defaults to harvested + launcher tags",
      "  --capture-out <path>        Write the captured bundle to an explicit path",
      "  --capture-session-id <id>   Override the captured bundle session id",
      "  --capture-title <title>     Set the captured bundle title",
      "  --capture-description <v>   Set the captured bundle description",
      "  --capture-tag <tag>         Add a doctrine tag to the captured bundle (repeatable)",
      "  --help, -h                  Show this help text",
    ].join("\n"),
  );
  stdout.write("\n");
}

void main();
