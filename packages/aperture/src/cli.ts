import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path, { dirname, resolve } from "node:path";
import { stderr, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import packageMetadata from "../package.json" with { type: "json" };

import {
  type RuntimeSessionCaptureCursor,
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  sliceRuntimeSessionCapture,
  writeSessionBundle,
} from "@aperture/lab/capture";
import {
  type ClaudeCodeElicitationEvent,
  type ClaudeCodePermissionRequestEvent,
  type ClaudeCodePreToolUseEvent,
  createClaudeCodeHookServer,
} from "@aperture/claude-code";
import { OpencodeClient, createOpencodeBridge, type OpencodeBridge } from "@aperture/opencode";
import {
  ApertureRuntimeAdapterClient,
  ApertureRuntimeClient,
  baseAttentionSurfaceCapabilities,
  bootstrapLearningPersistence,
  createApertureRuntime,
  discoverLocalRuntimes,
  type ApertureRuntimeSnapshot,
  type ApertureRuntimeSessionCapture,
  type LearningMode,
} from "@aperture/runtime";
import { runAttentionTui } from "@aperture/tui";

import { LauncherConnectionStore, makeConnectionEntry } from "./connection-status.js";
import {
  apertureCaptureDir,
  apertureHomeDir,
  apertureLearningWorkspaceRoot,
  globalOpencodeConfigPath,
  listGlobalOpencodeProfiles,
  listEnabledGlobalOpencodeProfiles,
  type OpencodeConnectionProfile,
  normalizeBaseUrl,
  resolveProfilePassword,
  saveGlobalOpencodeProfile,
} from "./opencode-config.js";

type CaptureOptions = {
  outputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags: string[];
};

type LauncherOptions = {
  help: boolean;
  learningMode: "on" | "off";
  learningExplicit: boolean;
  enableClaude: boolean;
  enableOpencode: boolean;
  capture: CaptureOptions | null;
};

type RuntimeBinding = {
  runtimeBaseUrl: string;
  reusedExistingRuntime: boolean;
  close?: () => Promise<void>;
};

type ClaudeHookInstallResult = {
  changed: boolean;
  settingsPath: string;
  command: string;
};

type LauncherOpencodeStartResult =
  | {
      kind: "started";
      close(): Promise<void>;
      detail: string;
      hint?: string;
    }
  | {
      kind: "waiting";
      detail: string;
      hint?: string;
    };

type JsonObject = Record<string, unknown>;
type HookSpec = { eventName: string; matcher?: string };
type HookDefinition = { type: string; command?: string } & Record<string, unknown>;
type HookEntry = { matcher?: string; hooks: HookDefinition[] } & Record<string, unknown>;

const CLI_ENTRY_PATH = fileURLToPath(import.meta.url);
const CLI_REPO_ROOT = resolve(dirname(CLI_ENTRY_PATH), "..", "..", "..");
const DEFAULT_HOOK_SPECS: HookSpec[] = [
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PermissionRequest", matcher: "*" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "PostToolUseFailure", matcher: "*" },
  { eventName: "Elicitation" },
  { eventName: "ElicitationResult" },
  { eventName: "Notification" },
  { eventName: "UserPromptSubmit" },
  { eventName: "Stop" },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command.startsWith("-") || command === "launch") {
    if (command === "--version" || command === "-v") {
      printVersion();
      return;
    }
    await runLauncher(command === "launch" ? args.slice(1) : args);
    return;
  }

  switch (command) {
    case "help":
      printRequestedHelp(args.slice(1));
      return;
    case "completion":
      await runCompletionCommand(args.slice(1));
      return;
    case "debug":
      await runDebugCommand(args.slice(1));
      return;
    case "internal":
      await runInternalCommand(args.slice(1));
      return;
    case "version":
      printVersion();
      return;
    case "claude":
      await runClaudeCommand(args.slice(1));
      return;
    case "opencode":
      await runOpencodeCommand(args.slice(1));
      return;
    case "doctor":
      await runDoctor();
      return;
    case "uninstall":
      await runUninstall(args.slice(1));
      return;
    case "--version":
    case "-v":
      printVersion();
      return;
    case "--help":
    case "-h":
      printRootHelp();
      return;
    default:
      throw new Error(`Unknown Aperture command: ${command}`);
  }
}

function printVersion(): void {
  stdout.write(`${packageMetadata.version}\n`);
}

async function runLauncher(args: string[]): Promise<void> {
  const options = parseLauncherArgs(args);
  if (options.help) {
    printLauncherHelp();
    return;
  }

  const cleanupTasks: Array<() => Promise<void>> = [];
  let shuttingDown = false;
  let runtimeBaseUrl: string | null = null;
  let captureCursor: RuntimeSessionCaptureCursor | null = null;
  const connectionStore = new LauncherConnectionStore([
    options.enableClaude
      ? makeConnectionEntry("claude", "Claude Code", "starting", "Preparing Claude Code integration.")
      : makeConnectionEntry("claude", "Claude Code", "disabled", "Disabled for this Aperture session."),
    options.enableOpencode
      ? makeConnectionEntry("opencode", "OpenCode", "starting", "Preparing OpenCode integration.")
      : makeConnectionEntry("opencode", "OpenCode", "disabled", "Disabled for this Aperture session."),
  ]);
  let retryOpencodeAction: (() => Promise<void>) | null = null;
  let stopOpencodeSetupAction: (() => Promise<void>) | null = null;
  let refreshClaudeAction: (() => Promise<void>) | null = null;
  let skipSetupAction: (() => Promise<void>) | null = null;

  const registerCleanup = (cleanup: () => Promise<void>) => {
    if (shuttingDown) {
      void cleanup().catch(() => {});
      return;
    }
    cleanupTasks.push(cleanup);
  };

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

    for (const cleanup of [...cleanupTasks].reverse()) {
      try {
        await cleanup();
      } catch {
        // Keep shutdown best-effort.
      }
    }
    process.exit(nextExitCode);
  };

  const onSignal = () => {
    void close();
  };

  const runConnectionAction = async (actionId: string): Promise<void> => {
    switch (actionId) {
      case "retry-opencode":
        if (!retryOpencodeAction) {
          throw new Error("OpenCode setup is still booting.");
        }
        await retryOpencodeAction();
        return;
      case "refresh-claude":
        if (!refreshClaudeAction) {
          throw new Error("Claude setup is still booting.");
        }
        await refreshClaudeAction();
        return;
      case "skip-setup":
        if (!skipSetupAction) {
          throw new Error("Setup controls are still booting.");
        }
        await skipSetupAction();
        return;
      case "show-setup":
        connectionStore.restoreSuppressed();
        return;
      default:
        throw new Error(`Unknown setup action: ${actionId}`);
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const runtime = await ensureRuntime(options);
    runtimeBaseUrl = runtime.runtimeBaseUrl;
    if (runtime.close) {
      registerCleanup(runtime.close);
    }

    if (options.capture) {
      captureCursor = await beginCapture(runtime.runtimeBaseUrl);
    }

    void startLauncherBackgroundServices(
      runtime.runtimeBaseUrl,
      options,
      registerCleanup,
      connectionStore,
      (action) => {
        refreshClaudeAction = action;
      },
      (action) => {
        retryOpencodeAction = action;
      },
      (action) => {
        stopOpencodeSetupAction = action;
      },
    ).catch((error) => {
      if (process.env.APERTURE_VERBOSE_BOOT !== "1") {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Launcher startup warning: ${message}\n`);
    });

    skipSetupAction = async () => {
      if (stopOpencodeSetupAction) {
        await stopOpencodeSetupAction();
      }
      connectionStore.suppressPending();
    };

    await runLauncherTui(runtime.runtimeBaseUrl, connectionStore, runConnectionAction);
    await close(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    await close(1);
  }
}

async function runRuntimeServer(args: string[]): Promise<void> {
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

async function runTui(): Promise<void> {
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
      terminalTitle: "Aperture Live",
    });
  } finally {
    await client.close();
  }
}

async function runHookCommand(args: string[]): Promise<void> {
  const command = args[0];
  switch (command) {
    case "claude-forward":
      await runClaudeForward();
      return;
    default:
      throw new Error(`Unknown Aperture hook command: ${command ?? "(missing)"}`);
  }
}

async function runInternalCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printInternalHelp();
    return;
  }

  switch (command) {
    case "runtime":
      await runRuntimeServer(args.slice(1));
      return;
    case "tui":
      await runTui();
      return;
    case "hook":
      await runHookCommand(args.slice(1));
      return;
    case "claude-adapter":
      await runClaudeAdapter();
      return;
    case "opencode-adapter":
      await runOpencodeAdapter();
      return;
    default:
      throw new Error(`Unknown Aperture internal command: ${command}`);
  }
}

async function runCompletionCommand(args: string[]): Promise<void> {
  const shell = args[0];
  if (!shell || shell === "--help" || shell === "-h") {
    printCompletionHelp();
    return;
  }

  switch (shell) {
    case "bash":
      stdout.write(buildBashCompletionScript());
      return;
    case "zsh":
      stdout.write(buildZshCompletionScript());
      return;
    case "fish":
      stdout.write(buildFishCompletionScript());
      return;
    default:
      throw new Error(`Unknown Aperture completion shell: ${shell}`);
  }
}

async function runDebugCommand(args: string[]): Promise<void> {
  const topic = args[0];
  if (topic === "--help" || topic === "-h") {
    printDebugHelp();
    return;
  }

  const snapshot = await collectDebugSnapshot();
  switch (topic) {
    case undefined:
    case "all":
      printDebugSnapshot(snapshot, "all");
      return;
    case "runtime":
    case "claude":
    case "opencode":
    case "state":
    case "capture":
      printDebugSnapshot(snapshot, topic);
      return;
    default:
      throw new Error(`Unknown Aperture debug topic: ${topic}`);
  }
}

async function runClaudeCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printClaudeHelp();
    return;
  }
  switch (command) {
    case "connect":
      await runClaudeConnect(args.slice(1));
      return;
    case "disconnect":
      await runClaudeDisconnect(args.slice(1));
      return;
    default:
      throw new Error(`Unknown Aperture Claude command: ${command ?? "(missing)"}`);
  }
}

async function runOpencodeCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printOpencodeHelp();
    return;
  }
  switch (command) {
    default:
      throw new Error(`Unknown Aperture OpenCode command: ${command ?? "(missing)"}`);
  }
}

async function runClaudeConnect(args: string[]): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude connect /path/to/project\n");
    stderr.write("   or: aperture claude connect --global\n");
    process.exit(1);
  }

  await installClaudeHooks({
    global,
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });
}

async function runClaudeDisconnect(args: string[]): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude disconnect /path/to/project\n");
    stderr.write("   or: aperture claude disconnect --global\n");
    process.exit(1);
  }

  const result = await removeClaudeHooks({
    global,
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });

  if (!result.changed) {
    stdout.write(`No Aperture Claude hooks found in ${result.settingsPath}\n`);
    return;
  }

  stdout.write(`Updated ${result.settingsPath}\n`);
  stdout.write("Removed Aperture Claude hook entries.\n");
  stdout.write(`Restart Claude Code${global ? "" : " in the target project"}.\n`);
}

async function installClaudeHooks(options: {
  global: boolean;
  targetRoot?: string;
  quiet?: boolean;
}): Promise<ClaudeHookInstallResult> {
  const settingsPath = resolveClaudeSettingsPath(options.global, options.targetRoot);
  const command = buildClaudeHookCommand();

  const settings = await readSettings(settingsPath);
  const updated = mergeHooks(settings, DEFAULT_HOOK_SPECS, command);
  const changed = JSON.stringify(settings) !== JSON.stringify(updated);

  if (!changed) {
    return {
      changed,
      settingsPath,
      command,
    };
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  if (options.quiet) {
    return {
      changed,
      settingsPath,
      command,
    };
  }

  stdout.write(`Updated ${settingsPath}\n`);
  stdout.write(`Hook command: ${command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. Start Aperture: aperture\n");
  stdout.write(`2. Restart Claude Code${options.global ? "" : " in the target project"}.\n`);
  stdout.write("3. Run /hooks in Claude Code to confirm the hooks loaded.\n");

  return {
    changed,
    settingsPath,
    command,
  };
}

async function removeClaudeHooks(options: {
  global: boolean;
  targetRoot?: string;
}): Promise<ClaudeHookInstallResult> {
  const settingsPath = resolveClaudeSettingsPath(options.global, options.targetRoot);
  const settings = await readSettings(settingsPath);
  const updated = removeApertureHooks(settings);
  const changed = JSON.stringify(settings) !== JSON.stringify(updated);

  if (!changed) {
    return {
      changed,
      settingsPath,
      command: buildClaudeHookCommand(),
    };
  }

  if (Object.keys(updated).length === 0) {
    await rm(settingsPath, { force: true });
    return {
      changed,
      settingsPath,
      command: buildClaudeHookCommand(),
    };
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  return {
    changed,
    settingsPath,
    command: buildClaudeHookCommand(),
  };
}

async function runClaudeForward(): Promise<void> {
  const chunks: Buffer[] = [];

  stdin.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  stdin.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const target = process.env.APERTURE_CLAUDE_HOOK_URL ?? "http://127.0.0.1:4545/hook";

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
        stderr.write(`Aperture hook forward failed: ${response.status} ${response.statusText}\n`);
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
      stderr.write(`Aperture hook forward failed: ${message}\n`);
      process.exit(0);
    }
  });
}

async function runClaudeAdapter(): Promise<void> {
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const requestPath = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  const runtimeBaseUrl = await resolveRuntimeUrl("Claude adapter", ["APERTURE_RUNTIME_URL", "APERTURE_CLAUDE_RUNTIME_URL"]);
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "claude-code",
    label: "Claude Code hook server",
    metadata: {
      transport: "hook-server",
    },
  });

  const hookServer = createClaudeCodeHookServer(adapterClient, {
    host,
    port,
    path: requestPath,
    includePostToolUse: true,
    preToolUsePolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "ask"),
    permissionRequestPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "native"),
    elicitationPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "native"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeApprovalFallbackEvent(event, reason));
      }
    },
    onPermissionRequestFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudePermissionFallbackEvent(event, reason));
      }
    },
    onElicitationFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeElicitationFallbackEvent(event, reason));
      }
    },
  });
  const hookBinding = await hookServer.listen();

  stderr.write(`Aperture Claude adapter listening at ${hookBinding.url}\n`);
  stderr.write(`Connected Claude adapter to runtime ${runtimeBaseUrl}\n`);
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

async function runOpencodeAdapter(): Promise<void> {
  const profiles = await listEnabledGlobalOpencodeProfiles();

  if (profiles.length === 0) {
    stderr.write("No enabled OpenCode connection profiles found. Configure one before starting Aperture.\n");
    return;
  }

  const runtimeBaseUrl = await resolveRuntimeUrl("OpenCode adapter", ["APERTURE_RUNTIME_URL", "APERTURE_OPENCODE_RUNTIME_URL"]);

  const bridges: OpencodeBridge[] = [];
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
  stderr.write("Run the TUI separately with: aperture internal tui\n");

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

function parseLauncherArgs(args: string[]): LauncherOptions {
  const options: LauncherOptions = {
    help: false,
    learningMode: "on",
    learningExplicit: false,
    enableClaude: true,
    enableOpencode: true,
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
        options.learningMode = readRequiredValue(arg, next) === "off" ? "off" : "on";
        options.learningExplicit = true;
        index += 1;
        continue;
      case "--no-claude":
        options.enableClaude = false;
        continue;
      case "--no-opencode":
        options.enableOpencode = false;
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

function ensureCaptureOptions(options: LauncherOptions): CaptureOptions {
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

async function ensureDefaultOpencodeProfile(options: { quiet?: boolean } = {}): Promise<void> {
  const enabledProfiles = await listEnabledGlobalOpencodeProfiles();
  if (enabledProfiles.length > 0) {
    return;
  }

  await saveGlobalOpencodeProfile({
    id: "default",
    baseUrl: normalizeBaseUrl("http://127.0.0.1:4096"),
    enabled: true,
  });
  if (!options.quiet) {
    stdout.write("Configured a default OpenCode profile at http://127.0.0.1:4096.\n");
  }
}

async function startLauncherBackgroundServices(
  runtimeBaseUrl: string,
  options: LauncherOptions,
  registerCleanup: (cleanup: () => Promise<void>) => void,
  connections: LauncherConnectionStore,
  setRefreshClaudeAction: (action: () => Promise<void>) => void,
  setRetryOpencodeAction: (action: () => Promise<void>) => void,
  setStopOpencodeSetupAction: (action: () => Promise<void>) => void,
): Promise<void> {
  const claudeSetup = options.enableClaude
    ? installClaudeHooks({ global: true, quiet: true })
    : Promise.resolve<ClaudeHookInstallResult | null>(null);
  const opencodeSetup = options.enableOpencode
    ? ensureDefaultOpencodeProfile({ quiet: true }).then(async () => listEnabledGlobalOpencodeProfiles())
    : Promise.resolve<OpencodeConnectionProfile[]>([]);
  const runtimeSnapshotPromise = fetchRuntimeSnapshot(runtimeBaseUrl);

  const [runtimeSnapshot, claudeInstall, opencodeProfiles] = await Promise.all([
    runtimeSnapshotPromise,
    claudeSetup,
    opencodeSetup,
  ]);

  if (options.enableClaude) {
    setRefreshClaudeAction(async () => {
      connections.update("claude", {
        state: "starting",
        detail: "Refreshing Claude Code setup.",
      });
      const nextInstall = await installClaudeHooks({ global: true, quiet: true });
      const nextSnapshot = await fetchRuntimeSnapshot(runtimeBaseUrl);
      await startClaudeConnection(runtimeBaseUrl, nextSnapshot, nextInstall, registerCleanup, connections);
    });
    await startClaudeConnection(runtimeBaseUrl, runtimeSnapshot, claudeInstall, registerCleanup, connections);
  }

  if (options.enableOpencode) {
    const opencode = await startOpencodeConnection(runtimeBaseUrl, runtimeSnapshot, opencodeProfiles, registerCleanup, connections);
    setRetryOpencodeAction(opencode.retry);
    setStopOpencodeSetupAction(opencode.stop);
  }
}

async function startClaudeConnection(
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
    ...(install?.changed ? { hint: "Restart Claude Code and run /hooks once to load the updated hooks." } : {}),
  });

  try {
    const adapter = await startLauncherClaudeAdapter(runtimeBaseUrl);
    registerCleanup(() => adapter.close());
    connections.update("claude", readyClaudeState(install?.changed ?? false, false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    connections.update("claude", {
      state: "error",
      detail: `Claude bridge failed to start: ${message}`,
      hint: "Run `aperture internal claude-adapter` directly to inspect the failure.",
    });
  }
}

async function startOpencodeConnection(
  runtimeBaseUrl: string,
  runtimeSnapshot: ApertureRuntimeSnapshot,
  profiles: OpencodeConnectionProfile[],
  registerCleanup: (cleanup: () => Promise<void>) => void,
  connections: LauncherConnectionStore,
): Promise<{ retry(): Promise<void>; stop(): Promise<void> }> {
  if (profiles.length === 0) {
    connections.update("opencode", {
      state: "action",
      detail: "No enabled OpenCode profiles are configured yet.",
      hint: "Add or enable an OpenCode profile to connect it to Aperture.",
    });
    return {
      retry: async () => {},
      stop: async () => {},
    };
  }

  const attachedExistingBridge = runtimeHasAdapter(runtimeSnapshot, "opencode");
  connections.update("opencode", {
    state: "starting",
    detail: attachedExistingBridge
      ? `Checking the existing OpenCode connection at ${describeProfileTargets(profiles)}.`
      : `Trying ${describeProfileTargets(profiles)}.`,
  });

  let closed = false;
  let suspended = false;
  let activeClose: (() => Promise<void>) | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let healthTimer: NodeJS.Timeout | null = null;
  let attemptInFlight = false;

  const stopRetryLoop = () => {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  };

  const stopHealthLoop = () => {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  };

  const refreshHealth = async () => {
    if (closed || suspended) {
      return;
    }

    const probe = await probeOpencodeProfiles(profiles);
    if (probe.kind === "ready") {
      connections.update("opencode", {
        state: "ready",
        detail: attachedExistingBridge
          ? `Attached to an existing OpenCode connection at ${describeProfileTargets(profiles)}.`
          : probe.detail,
        ...(probe.hint ? { hint: probe.hint } : {}),
      });
      return;
    }

    connections.update("opencode", {
      state: "action",
      detail: probe.detail,
      ...(probe.hint ? { hint: probe.hint } : {}),
    });
  };

  const ensureHealthLoop = () => {
    if (healthTimer) {
      return;
    }
    healthTimer = setInterval(() => {
      void refreshHealth().catch(() => {});
    }, 5_000);
  };

  const attempt = async () => {
    if (closed || suspended || attemptInFlight || activeClose) {
      return;
    }
    attemptInFlight = true;
    try {
      const result = await startLauncherOpencodeAdapter(runtimeBaseUrl);
      if (result.kind === "started") {
        activeClose = result.close;
        stopRetryLoop();
        ensureHealthLoop();
        connections.update("opencode", {
          state: "ready",
          detail: result.detail,
          ...(result.hint ? { hint: result.hint } : {}),
        });
        return;
      }

      connections.update("opencode", {
        state: "action",
        detail: result.detail,
        ...(result.hint ? { hint: result.hint } : {}),
      });
      if (!retryTimer) {
        retryTimer = setInterval(() => {
          void attempt();
        }, 5_000);
      }
      ensureHealthLoop();
    } finally {
      attemptInFlight = false;
    }
  };

  const stop = async () => {
    suspended = true;
    stopRetryLoop();
    stopHealthLoop();
    if (activeClose) {
      const close = activeClose;
      activeClose = null;
      await close();
    }
  };

  if (attachedExistingBridge) {
    ensureHealthLoop();
    await refreshHealth();
  } else {
    await attempt();
  }

  registerCleanup(async () => {
    closed = true;
    await stop();
  });

  return {
    retry: async () => {
      suspended = false;
      if (attachedExistingBridge) {
        ensureHealthLoop();
        await refreshHealth();
        return;
      }
      await attempt();
    },
    stop,
  };
}

function readyClaudeState(changedHooks: boolean, attachedExisting: boolean): {
  state: "ready" | "action";
  detail: string;
  hint?: string;
} {
  if (changedHooks) {
    return {
      state: "action",
      detail: attachedExisting
        ? "Claude bridge is ready, but Claude Code still needs to reload the updated hooks."
        : "Claude bridge is ready. Claude Code still needs to reload the updated hooks.",
      hint: "Restart Claude Code and run /hooks once to finish setup.",
    };
  }

  return {
    state: "ready",
    detail: attachedExisting
      ? "Attached to an existing Claude Code bridge."
      : "Listening for Claude Code hooks.",
  };
}

function describeProfileTargets(profiles: OpencodeConnectionProfile[]): string {
  const targets = [...new Set(profiles.map((profile) => profile.baseUrl))];
  if (targets.length === 1) {
    return targets[0] ?? "OpenCode";
  }
  return `${targets.length} OpenCode endpoints`;
}

function humanizeOpencodeError(profile: OpencodeConnectionProfile, message: string): string {
  if (message === "fetch failed") {
    if (profile.baseUrl === "http://127.0.0.1:4096") {
      return "Run: opencode serve --port 4096, then opencode attach http://127.0.0.1:4096.";
    }
    return `Run: start OpenCode at ${profile.baseUrl}, then attach with opencode attach ${profile.baseUrl}.`;
  }

  return message;
}

async function ensureRuntime(options: LauncherOptions): Promise<RuntimeBinding> {
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

  const controlHost = process.env.APERTURE_CONTROL_HOST ?? "127.0.0.1";
  const controlPort = readNumber(process.env.APERTURE_CONTROL_PORT) ?? 4546;
  const controlPathPrefix = process.env.APERTURE_CONTROL_PATH ?? "/runtime";
  const learningBootstrap = options.learningMode === "on"
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

  return {
    runtimeBaseUrl: binding.controlUrl.replace(/\/+$/, ""),
    reusedExistingRuntime: false,
    close: async () => {
      await runtime.close();
    },
  };
}

async function startLauncherClaudeAdapter(runtimeBaseUrl: string) {
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "claude-code",
    label: "Claude Code hook server",
    metadata: {
      transport: "hook-server",
    },
  });
  const hookServer = createClaudeCodeHookServer(adapterClient, {
    host: process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1",
    port: readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545,
    path: process.env.APERTURE_CLAUDE_PATH ?? "/hook",
    includePostToolUse: true,
    preToolUsePolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "ask"),
    permissionRequestPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "native"),
    elicitationPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "native"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeApprovalFallbackEvent(event, reason));
      }
    },
    onPermissionRequestFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudePermissionFallbackEvent(event, reason));
      }
    },
    onElicitationFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeElicitationFallbackEvent(event, reason));
      }
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

async function startLauncherOpencodeAdapter(runtimeBaseUrl: string): Promise<LauncherOpencodeStartResult> {
  const profiles = await listEnabledGlobalOpencodeProfiles();
  if (profiles.length === 0) {
    return {
      kind: "waiting",
      detail: "No enabled OpenCode profiles are configured.",
      hint: "Add or enable an OpenCode profile to connect OpenCode to Aperture.",
    };
  }

  const bridges: OpencodeBridge[] = [];
  const unavailable: string[] = [];
  for (const profile of profiles) {
    try {
      const password = resolveProfilePassword(profile);
      if (profile.auth && !password) {
        throw new Error(
          `Profile "${profile.id}" needs ${profile.auth.passwordEnv ?? "its configured password"} before Aperture can connect.`,
        );
      }

      const clientOptions = {
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
      };

      const probeClient = new OpencodeClient(clientOptions);
      await probeClient.listPermissions();

      const bridge = createOpencodeBridge({
        runtimeBaseUrl,
        runtimeLabel: profile.label ? `OpenCode adapter (${profile.label})` : `OpenCode adapter (${profile.id})`,
        runtimeMetadata: {
          profileId: profile.id,
        },
        ...(profile.label ? { sourceLabel: profile.label } : {}),
        client: clientOptions,
      });
      await bridge.start();
      bridges.push(bridge);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailable.push(
        profiles.length > 1
          ? `${profile.id}: ${humanizeOpencodeError(profile, message)}`
          : humanizeOpencodeError(profile, message),
      );
    }
  }

  if (bridges.length > 0) {
    const detail = unavailable.length > 0
      ? `Connected ${bridges.length} OpenCode profile${bridges.length === 1 ? "" : "s"} · ${unavailable.length} unavailable`
      : `Connected ${bridges.length} OpenCode profile${bridges.length === 1 ? "" : "s"}`;
    return {
      kind: "started",
      detail,
      ...(unavailable.length > 0 ? { hint: unavailable[0] } : {}),
      async close() {
        for (const bridge of bridges.reverse()) {
          await bridge.close();
        }
      },
    };
  }

  return {
    kind: "waiting",
    detail: `Waiting for OpenCode at ${describeProfileTargets(profiles)}.`,
    ...(unavailable[0] ? { hint: unavailable[0] } : {}),
  };
}

type OpencodeProfileProbeResult =
  | { kind: "ready"; detail: string; hint?: string }
  | { kind: "waiting"; detail: string; hint?: string };

async function probeOpencodeProfiles(
  profiles: OpencodeConnectionProfile[],
): Promise<OpencodeProfileProbeResult> {
  if (profiles.length === 0) {
    return {
      kind: "waiting",
      detail: "No enabled OpenCode profiles are configured.",
      hint: "Add or enable an OpenCode profile to connect OpenCode to Aperture.",
    };
  }

  const unavailable: string[] = [];
  let reachable = 0;

  for (const profile of profiles) {
    try {
      const password = resolveProfilePassword(profile);
      if (profile.auth && !password) {
        throw new Error(
          `Profile \"${profile.id}\" needs ${profile.auth.passwordEnv ?? "its configured password"} before Aperture can connect.`,
        );
      }

      const probeClient = new OpencodeClient({
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
      });
      await probeClient.listPermissions();
      reachable += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unavailable.push(
        profiles.length > 1
          ? `${profile.id}: ${humanizeOpencodeError(profile, message)}`
          : humanizeOpencodeError(profile, message),
      );
    }
  }

  if (reachable > 0) {
    return {
      kind: "ready",
      detail: `Connected ${reachable} OpenCode profile${reachable === 1 ? "" : "s"}.`,
      ...(unavailable[0] ? { hint: unavailable[0] } : {}),
    };
  }

  return {
    kind: "waiting",
    detail: `Waiting for OpenCode at ${describeProfileTargets(profiles)}.`,
    ...(unavailable[0] ? { hint: unavailable[0] } : {}),
  };
}

async function runLauncherTui(
  runtimeBaseUrl: string,
  connections: LauncherConnectionStore,
  runConnectionAction: (actionId: string) => Promise<void>,
): Promise<void> {
  const client = await ApertureRuntimeClient.connect({
    baseUrl: runtimeBaseUrl,
    label: "tui",
    surfaceCapabilities: {
      ...baseAttentionSurfaceCapabilities,
      responses: {
        ...baseAttentionSurfaceCapabilities.responses,
        supportsTextResponse: true,
      },
    },
  });

  try {
    await runAttentionTui(client, {
      title: "Aperture",
      terminalTitle: "Aperture Live",
      getConnectionStatus: () => connections.getSnapshot(),
      subscribeConnectionStatus: (listener) => connections.subscribe(listener),
      runConnectionAction,
    });
  } finally {
    await client.close();
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
        notes: ["captured via aperture --capture"],
      },
    },
  });
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : defaultSessionBundlePath(bundle, apertureCaptureDir());

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

async function resolveRuntimeUrl(label: string, envVars: string[]): Promise<string> {
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

async function runDoctor(): Promise<void> {
  const dataDir = apertureHomeDir();
  const captureDir = apertureCaptureDir();
  const learningRoot = resolve(apertureLearningWorkspaceRoot(), ".aperture");
  const settingsPath = resolveClaudeSettingsPath(true);
  const claudeSettings = await readSettings(settingsPath);
  const claudeHookCount = countApertureHookEntries(claudeSettings);
  const allProfiles = await listGlobalOpencodeProfiles();
  const enabledProfiles = allProfiles.filter((profile) => profile.enabled);
  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  const opencodeStatus = await probeOpencodeProfiles(enabledProfiles);

  const lines = [
    "Aperture Doctor",
    "The live attention surface for humans working with agents.",
    "",
    "Product state",
    `  data dir: ${dataDir}`,
    `  captures: ${captureDir}`,
    `  learning state: ${learningRoot}`,
    `  OpenCode config: ${globalOpencodeConfigPath()}`,
    "",
    "Claude Code",
    `  hooks: ${claudeHookCount > 0 ? `installed (${claudeHookCount})` : "not installed"}`,
    `  settings: ${settingsPath}`,
    `  command: ${buildClaudeHookCommand()}`,
    "",
    "OpenCode",
    `  profiles: ${enabledProfiles.length}/${allProfiles.length} enabled`,
    `  status: ${opencodeStatus.detail}`,
    ...(opencodeStatus.hint ? [`  hint: ${opencodeStatus.hint}`] : []),
    "",
    "Runtime",
    `  live runtimes: ${runtimes.length}`,
    ...runtimes.map((runtime) => `  - ${runtime.controlUrl} (pid ${runtime.pid})`),
  ];

  if (claudeHookCount === 0) {
    lines.push("", "Suggested next steps", "  1. Run `aperture` to install Claude hooks and boot the product.");
  } else if (enabledProfiles.length === 0) {
    lines.push(
      "",
      "Suggested next steps",
      "  1. Start Aperture with `aperture`.",
      "  2. Start OpenCode with `opencode serve --port 4096`, then `opencode attach http://127.0.0.1:4096`.",
    );
  }

  stdout.write(`${lines.join("\n")}\n`);
}

type DebugTopic = "all" | "runtime" | "claude" | "opencode" | "state" | "capture";

type DebugCaptureArtifact = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
};

type DebugSnapshot = {
  dataDir: string;
  captureDir: string;
  learningRoot: string;
  globalClaudeSettingsPath: string;
  globalClaudeHookCount: number;
  localClaudeSettingsPath: string;
  localClaudeHookCount: number;
  allProfiles: OpencodeConnectionProfile[];
  enabledProfiles: OpencodeConnectionProfile[];
  opencodeStatus: OpencodeProfileProbeResult;
  runtimes: Awaited<ReturnType<typeof discoverLocalRuntimes>>;
  primaryRuntimeUrl: string | null;
  runtimeSnapshot: ApertureRuntimeSnapshot | null;
  runtimeSnapshotError: string | null;
  recentCaptureArtifacts: DebugCaptureArtifact[];
};

async function collectDebugSnapshot(): Promise<DebugSnapshot> {
  const dataDir = apertureHomeDir();
  const captureDir = apertureCaptureDir();
  const learningRoot = resolve(apertureLearningWorkspaceRoot(), ".aperture");
  const globalClaudeSettingsPath = resolveClaudeSettingsPath(true);
  const localClaudeSettingsPath = resolveClaudeSettingsPath(false, process.cwd());
  const [globalClaudeSettings, localClaudeSettings, allProfiles, runtimes, recentCaptureArtifacts] = await Promise.all([
    readSettings(globalClaudeSettingsPath),
    readSettings(localClaudeSettingsPath),
    listGlobalOpencodeProfiles(),
    discoverLocalRuntimes({ kind: "aperture" }),
    listRecentCaptureArtifacts(captureDir),
  ]);
  const enabledProfiles = allProfiles.filter((profile) => profile.enabled);
  const opencodeStatus = await probeOpencodeProfiles(enabledProfiles);
  const primaryRuntimeUrl = runtimes[0]?.controlUrl?.replace(/\/+$/, "") ?? null;

  let runtimeSnapshot: ApertureRuntimeSnapshot | null = null;
  let runtimeSnapshotError: string | null = null;
  if (primaryRuntimeUrl) {
    try {
      runtimeSnapshot = await fetchRuntimeSnapshot(primaryRuntimeUrl);
    } catch (error) {
      runtimeSnapshotError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    dataDir,
    captureDir,
    learningRoot,
    globalClaudeSettingsPath,
    globalClaudeHookCount: countApertureHookEntries(globalClaudeSettings),
    localClaudeSettingsPath,
    localClaudeHookCount: countApertureHookEntries(localClaudeSettings),
    allProfiles,
    enabledProfiles,
    opencodeStatus,
    runtimes,
    primaryRuntimeUrl,
    runtimeSnapshot,
    runtimeSnapshotError,
    recentCaptureArtifacts,
  };
}

async function listRecentCaptureArtifacts(directory: string): Promise<DebugCaptureArtifact[]> {
  if (!await pathExists(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const captures = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        const metadata = await stat(absolutePath);
        return {
          name: entry.name,
          sizeBytes: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
        } satisfies DebugCaptureArtifact;
      }),
  );

  return captures
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, 5);
}

function printDebugSnapshot(snapshot: DebugSnapshot, topic: DebugTopic): void {
  const sections: string[] = [
    "Aperture Debug",
    "Support details for runtime, integrations, and local product state.",
    "",
    "Version",
    `  aperture: ${packageMetadata.version}`,
    `  node: ${process.version}`,
    `  cwd: ${process.cwd()}`,
    "",
  ];

  const include = (name: Exclude<DebugTopic, "all">) => topic === "all" || topic === name;

  if (include("state")) {
    sections.push(
      "Product state",
      `  data dir: ${snapshot.dataDir}`,
      `  captures: ${snapshot.captureDir}`,
      `  learning state: ${snapshot.learningRoot}`,
      `  capture files: ${snapshot.recentCaptureArtifacts.length}`,
      "",
    );
  }

  if (include("claude")) {
    sections.push(
      "Claude Code",
      `  global hooks: ${snapshot.globalClaudeHookCount > 0 ? `installed (${snapshot.globalClaudeHookCount})` : "not installed"}`,
      `  global settings: ${snapshot.globalClaudeSettingsPath}`,
      `  local hooks in cwd: ${snapshot.localClaudeHookCount > 0 ? `installed (${snapshot.localClaudeHookCount})` : "not installed"}`,
      `  local settings: ${snapshot.localClaudeSettingsPath}`,
      `  command: ${buildClaudeHookCommand()}`,
      "",
    );
  }

  if (include("opencode")) {
    sections.push(
      "OpenCode",
      `  profiles: ${snapshot.enabledProfiles.length}/${snapshot.allProfiles.length} enabled`,
      `  status: ${snapshot.opencodeStatus.detail}`,
      ...(snapshot.opencodeStatus.hint ? [`  hint: ${snapshot.opencodeStatus.hint}`] : []),
      ...snapshot.allProfiles.map((profile) => (
        `  - ${profile.id}${profile.enabled ? " [enabled]" : " [disabled]"} -> ${profile.baseUrl}${profile.label ? ` (${profile.label})` : ""}`
      )),
      "",
    );
  }

  if (include("runtime")) {
    sections.push(
      "Runtime",
      `  live runtimes: ${snapshot.runtimes.length}`,
      ...(snapshot.primaryRuntimeUrl ? [`  primary: ${snapshot.primaryRuntimeUrl}`] : []),
      ...snapshot.runtimes.map((runtime) => `  - ${runtime.controlUrl} (pid ${runtime.pid})`),
    );

    if (snapshot.runtimeSnapshot) {
      sections.push(
        `  surfaces: ${snapshot.runtimeSnapshot.surfaceCount}`,
        `  adapters: ${snapshot.runtimeSnapshot.adapters.length}`,
        `  attention: now ${snapshot.runtimeSnapshot.attentionView.active ? 1 : 0} · next ${snapshot.runtimeSnapshot.attentionView.queued.length} · ambient ${snapshot.runtimeSnapshot.attentionView.ambient.length}`,
        `  recent signals: ${snapshot.runtimeSnapshot.signalSummary.recentSignals}`,
        `  lifetime signals: ${snapshot.runtimeSnapshot.signalSummary.lifetimeSignals}`,
        ...snapshot.runtimeSnapshot.adapters.map((adapter) => (
          `  - ${adapter.kind}${adapter.label ? ` (${adapter.label})` : ""} · last seen ${adapter.lastSeenAt}`
        )),
      );
    } else if (snapshot.runtimeSnapshotError) {
      sections.push(`  snapshot error: ${snapshot.runtimeSnapshotError}`);
    }

    sections.push("");
  }

  if (include("capture")) {
    sections.push(
      "Capture",
      `  directory: ${snapshot.captureDir}`,
      ...(snapshot.recentCaptureArtifacts.length === 0
        ? ["  recent files: none"]
        : [
            "  recent files:",
            ...snapshot.recentCaptureArtifacts.map((artifact) => (
              `  - ${artifact.name} · ${formatBytes(artifact.sizeBytes)} · ${artifact.modifiedAt}`
            )),
          ]),
      "",
    );
  }

  stdout.write(`${sections.join("\n").replace(/\n+$/, "\n")}`);
}

async function runUninstall(args: string[]): Promise<void> {
  const options = parseUninstallArgs(args);
  if (options.help) {
    printRequestedHelp(["uninstall"]);
    return;
  }

  const dataDir = apertureHomeDir();
  const settingsPath = resolveClaudeSettingsPath(true);
  const projectRoots = [...options.projectRoots];
  const cwdSettingsPath = resolveClaudeSettingsPath(false, process.cwd());
  if (projectRoots.length === 0 && await pathExists(cwdSettingsPath)) {
    projectRoots.push(process.cwd());
  }
  const planLines = [
    "Aperture uninstall will remove:",
    `  - product state under ${dataDir}`,
    `  - Aperture Claude hook entries from ${settingsPath}`,
    ...projectRoots.flatMap((projectRoot) => [
      `  - Aperture Claude hook entries from ${resolveClaudeSettingsPath(false, projectRoot)}`,
      `  - project state under ${resolve(projectRoot, ".aperture")}`,
    ]),
  ];

  if (!options.yes) {
    stdout.write(`${planLines.join("\n")}\n`);
    stdout.write("\n");
    stdout.write("Re-run with `aperture uninstall --yes` to remove everything above.\n");
    if (projectRoots.length === 0) {
      stdout.write("Add `--project /path/to/project` to also remove project-local Claude hooks.\n");
    }
    return;
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  const stoppedRuntimes: string[] = [];
  for (const runtime of runtimes) {
    try {
      process.kill(runtime.pid, "SIGTERM");
      stoppedRuntimes.push(`${runtime.controlUrl} (pid ${runtime.pid})`);
    } catch {
      // Best-effort shutdown only.
    }
  }

  const removedSettings: string[] = [];
  const globalResult = await removeClaudeHooks({ global: true });
  if (globalResult.changed) {
    removedSettings.push(globalResult.settingsPath);
  }

  for (const projectRoot of projectRoots) {
    const result = await removeClaudeHooks({
      global: false,
      targetRoot: projectRoot,
    });
    if (result.changed) {
      removedSettings.push(result.settingsPath);
    }

    await rm(resolve(projectRoot, ".aperture"), { recursive: true, force: true });
  }

  await rm(dataDir, { recursive: true, force: true });

  stdout.write("Aperture cleanup complete.\n");
  if (stoppedRuntimes.length > 0) {
    stdout.write(`Stopped ${stoppedRuntimes.length} live runtime${stoppedRuntimes.length === 1 ? "" : "s"}.\n`);
  }
  if (removedSettings.length > 0) {
    stdout.write("Removed Claude hook entries from:\n");
    for (const settings of removedSettings) {
      stdout.write(`- ${settings}\n`);
    }
  }
  stdout.write(`Removed product state at ${dataDir}\n`);
  stdout.write("\n");
  stdout.write("To remove the package itself, run one of:\n");
  stdout.write("- npm uninstall -g @tomismeta/aperture\n");
  stdout.write("- pnpm remove -g @tomismeta/aperture\n");
}

type UninstallOptions = {
  yes: boolean;
  help: boolean;
  projectRoots: string[];
};

function parseUninstallArgs(args: string[]): UninstallOptions {
  const options: UninstallOptions = {
    yes: false,
    help: false,
    projectRoots: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--yes":
      case "-y":
        options.yes = true;
        continue;
      case "--help":
      case "-h":
        options.help = true;
        continue;
      case "--project":
        options.projectRoots.push(resolve(readRequiredValue(arg, next)));
        index += 1;
        continue;
      default:
        throw new Error(`Unknown uninstall argument: ${arg}`);
    }
  }

  return options;
}

function runtimeHasAdapter(snapshot: ApertureRuntimeSnapshot, kind: string): boolean {
  return snapshot.adapters.some((adapter) => adapter.kind === kind);
}

function buildClaudeHookCommand(): string {
  if (CLI_ENTRY_PATH.endsWith(".ts")) {
    return `pnpm --dir ${shellQuote(CLI_REPO_ROOT)} exec tsx ${shellQuote(CLI_ENTRY_PATH)} internal hook claude-forward`;
  }

  return `${shellQuote(process.execPath)} ${shellQuote(CLI_ENTRY_PATH)} internal hook claude-forward`;
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

function readNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLearningMode(args: string[]): LearningMode {
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

async function readSettings(settingsPath: string): Promise<JsonObject> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings must be a JSON object");
    }
    return parsed as JsonObject;
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${settingsPath}: ${message}`);
  }
}

function resolveClaudeSettingsPath(global: boolean, targetRoot?: string): string {
  return global
    ? resolve(process.env.HOME ?? "~", ".claude", "settings.json")
    : resolve(targetRoot ?? ".", ".claude", "settings.local.json");
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === "ENOENT";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function mergeHooks(settings: JsonObject, hookSpecs: HookSpec[], command: string): JsonObject {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const hookSpec of hookSpecs) {
    hooks[hookSpec.eventName] = ensureCommandHook(hooks[hookSpec.eventName], command, hookSpec.matcher);
  }

  next.hooks = hooks;
  return next;
}

function removeApertureHooks(settings: JsonObject): JsonObject {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const [eventName, existing] of Object.entries(hooks)) {
    if (!Array.isArray(existing)) {
      continue;
    }

    const cleanedEntries = existing
      .map(cloneEntry)
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !isAnyApertureHook(hook))
          : [],
      }))
      .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

    if (cleanedEntries.length === 0) {
      delete hooks[eventName];
      continue;
    }

    hooks[eventName] = cleanedEntries;
  }

  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
    return next;
  }

  next.hooks = hooks;
  return next;
}

function countApertureHookEntries(settings: JsonObject): number {
  const hooks = normalizeHooks(settings.hooks);
  let count = 0;

  for (const existing of Object.values(hooks)) {
    if (!Array.isArray(existing)) {
      continue;
    }

    for (const entry of existing) {
      const cloned = cloneEntry(entry);
      count += cloned.hooks.filter(isAnyApertureHook).length;
    }
  }

  return count;
}

function normalizeHooks(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settings.hooks must be an object when present");
  }

  return { ...(value as Record<string, unknown>) };
}

function ensureCommandHook(existing: unknown, command: string, matcher?: string): HookEntry[] {
  const entries = Array.isArray(existing)
    ? existing.map(cloneEntry).filter((entry) => !isLegacyApertureHookEntry(entry, command))
    : [];
  const hook: HookDefinition = { type: "command", command };

  for (const entry of entries) {
    if (hasCommand(entry, command) && sameMatcher(entry.matcher, matcher)) {
      return entries;
    }
  }

  const matchedEntry = entries.find((entry) => sameMatcher(entry.matcher, matcher) && Array.isArray(entry.hooks));
  if (matchedEntry) {
    matchedEntry.hooks.push(hook);
    return entries;
  }

  const nextEntry: HookEntry = matcher !== undefined
    ? { matcher, hooks: [hook] }
    : { hooks: [hook] };
  entries.push(nextEntry);

  return entries;
}

function cloneEntry(entry: unknown): HookEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("hook entries must be objects");
  }

  const typedEntry = entry as Record<string, unknown>;
  const hooks = Array.isArray(typedEntry.hooks) ? typedEntry.hooks.map(cloneHook) : [];
  return {
    ...typedEntry,
    ...(typeof typedEntry.matcher === "string" ? { matcher: typedEntry.matcher } : {}),
    hooks,
  };
}

function cloneHook(hook: unknown): HookDefinition {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    throw new Error("hook definitions must be objects");
  }

  return { ...(hook as HookDefinition) };
}

function hasCommand(entry: HookEntry, command: string): boolean {
  return Array.isArray(entry.hooks)
    && entry.hooks.some((hook) => hook.type === "command" && hook.command === command);
}

function sameMatcher(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function isLegacyApertureHookEntry(entry: HookEntry, command: string): boolean {
  if (!Array.isArray(entry.hooks)) {
    return false;
  }

  return entry.hooks.some((hook) => {
    if (hook.type !== "command" || typeof hook.command !== "string") {
      return false;
    }

    if (hook.command === command) {
      return false;
    }

    return isAnyApertureHook(hook);
  });
}

function isAnyApertureHook(hook: HookDefinition): boolean {
  if (hook.type !== "command" || typeof hook.command !== "string") {
    return false;
  }

  return hook.command.includes("hook claude-forward")
    || hook.command.includes("/scripts/claude-hook-forward.mjs")
    || hook.command.includes("/scripts/claude-forward.mjs")
    || hook.command.includes("/scripts/claude-forward.ts")
    || hook.command.includes("http://127.0.0.1:4545/hook")
    || hook.command.includes("http://localhost:4545/hook");
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function claudeApprovalFallbackEvent(
  event: ClaudeCodePreToolUseEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:PreToolUse:${encodeURIComponent(
      event.tool_use_id,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? `${event.tool_name} approval timed out`
        : `${event.tool_name} approval returned to Claude`,
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a response in time and returned this approval to Claude Code."
        : "Aperture did not retain this approval frame, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

function claudeElicitationFallbackEvent(
  event: ClaudeCodeElicitationEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:Elicitation:${encodeURIComponent(
      event.elicitation_id ?? event.message,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? "Claude input request timed out"
        : "Claude input request returned to Claude",
    summary:
      reason === "timed_out"
        ? "Aperture did not receive an input response in time and returned this request to Claude Code."
        : "Aperture did not retain this input request, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

function claudePermissionFallbackEvent(
  event: ClaudeCodePermissionRequestEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:PermissionRequest:${encodeURIComponent(
      event.tool_name,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? `${event.tool_name} permission timed out`
        : `${event.tool_name} permission returned to Claude`,
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a permission response in time and returned this request to Claude Code."
        : "Aperture did not retain this permission request, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

function claudeSource(
  event: Pick<ClaudeCodePreToolUseEvent | ClaudeCodePermissionRequestEvent | ClaudeCodeElicitationEvent, "session_id" | "cwd">,
) {
  const workspace = event.cwd.split("/").filter(Boolean).at(-1) ?? "";
  const session = shortSessionLabel(event.session_id);
  return {
    id: `claude-code:${event.session_id}`,
    kind: "claude-code" as const,
    label: workspace ? `Claude Code ${workspace} #${session}` : `Claude Code #${session}`,
  };
}

function shortSessionLabel(sessionId: string): string {
  const compact = sessionId.replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(0, 6) || "session";
}

function printRequestedHelp(args: string[]): void {
  const topic = args[0];

  switch (topic) {
    case undefined:
      printRootHelp();
      return;
    case "launch":
      printLauncherHelp();
      return;
    case "doctor":
      printDoctorHelp();
      return;
    case "debug":
      printDebugHelp();
      return;
    case "completion":
      printCompletionHelp();
      return;
    case "uninstall":
      printUninstallHelp();
      return;
    case "claude":
      printClaudeHelp();
      return;
    case "opencode":
      printOpencodeHelp();
      return;
    case "internal":
      printInternalHelp();
      return;
    default:
      throw new Error(`Unknown help topic: ${topic}`);
  }
}

function printRootHelp(): void {
  stdout.write(
    [
      "Aperture",
      "The live attention surface for humans working with agents.",
      "",
      "Usage:",
      "  aperture",
      "  aperture [options]",
      "  aperture <command> [options]",
      "",
      "Common flows:",
      "  aperture",
      "      Launch Aperture, connect Claude/OpenCode, and open the TUI.",
      "  aperture --capture",
      "      Launch Aperture and export a replayable capture on exit.",
      "  aperture doctor",
      "      Check runtime, Claude hooks, OpenCode profiles, and product state.",
      "  aperture debug",
      "      Print support details for runtime, hooks, OpenCode, and captures.",
      "  aperture --version",
      "      Print the installed Aperture version.",
      "  aperture uninstall --yes",
      "      Remove Aperture state and Claude hook entries before uninstalling the package.",
      "",
      "Commands:",
      "  help [topic]          Show help for Aperture or a specific topic",
      "  doctor                Print runtime, Claude, OpenCode, and state health",
      "  debug [topic]         Print support details for troubleshooting",
      "  completion <shell>    Print a shell completion script",
      "  uninstall [--yes]     Remove Aperture-owned state and Claude hooks",
      "  claude                Manage Claude Code setup",
      "  opencode              Show the OpenCode setup flow Aperture expects",
      "  internal              Advanced runtime, TUI, adapter, and hook plumbing",
      "  version               Print the installed Aperture version",
      "",
      "Launcher options:",
      "  --learning <on|off>   Start a new runtime with learning on or off",
      "  --no-claude           Skip starting the Claude Code adapter",
      "  --no-opencode         Skip starting the OpenCode adapter",
      "  --capture             Export a troubleshooting capture when Aperture exits",
      "  --capture-out <path>  Write the captured bundle to an explicit path",
      "  --help, -h            Show this help text",
      "  --version, -v         Print the installed Aperture version",
      "",
      "Help topics:",
      "  aperture help launch",
      "  aperture help doctor",
      "  aperture help debug",
      "  aperture help completion",
      "  aperture help uninstall",
      "  aperture help claude",
      "  aperture help opencode",
      "  aperture help internal",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printLauncherHelp(): void {
  stdout.write(
    [
      "Aperture Launch",
      "Boot the opinionated local Aperture product.",
      "",
      "Usage:",
      "  aperture [options]",
      "",
      "What launch does:",
      "  - reuses an existing Aperture runtime when one is already live",
      "  - otherwise starts the runtime with learning enabled by default",
      "  - ensures Claude Code hooks are configured globally",
      "  - ensures an OpenCode profile exists",
      "  - starts Claude Code and OpenCode integrations when available",
      "  - opens the shared Aperture TUI",
      "",
      "Options:",
      "  --learning <on|off>         Start a new runtime with learning on or off",
      "  --no-claude                 Skip starting the Claude Code adapter",
      "  --no-opencode               Skip starting the OpenCode adapter",
      "  --capture                   Export a troubleshooting capture when Aperture exits",
      "  --capture-out <path>        Write the captured bundle to an explicit path",
      "  --help, -h                  Show this help text",
      "",
      "Examples:",
      "  aperture",
      "  aperture --capture",
      "  aperture --no-opencode",
      "",
      "Advanced:",
      "  aperture help internal",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printDoctorHelp(): void {
  stdout.write(
    [
      "Aperture Doctor",
      "Inspect runtime, integration, and state health without changing anything.",
      "",
      "Usage:",
      "  aperture doctor",
      "",
      "Doctor reports:",
      "  - Aperture product state paths under ~/.aperture",
      "  - Claude Code hook installation status",
      "  - the installed Claude hook command shape",
      "  - OpenCode profile and reachability status",
      "  - live Aperture runtimes on this machine",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printDebugHelp(): void {
  stdout.write(
    [
      "Aperture Debug",
      "Print support-focused details for runtime, integrations, and local product state.",
      "",
      "Usage:",
      "  aperture debug",
      "  aperture debug runtime",
      "  aperture debug claude",
      "  aperture debug opencode",
      "  aperture debug state",
      "  aperture debug capture",
      "",
      "What it shows:",
      "  - product state paths and recent capture files",
      "  - Claude hook installation details",
      "  - OpenCode profile and reachability details",
      "  - live runtime discovery and primary runtime snapshot",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printCompletionHelp(): void {
  stdout.write(
    [
      "Aperture Completion",
      "Print a shell completion script for Aperture.",
      "",
      "Usage:",
      "  aperture completion bash",
      "  aperture completion zsh",
      "  aperture completion fish",
      "",
      "Examples:",
      "  aperture completion zsh > ~/.zsh/completions/_aperture",
      "  aperture completion bash > ~/.local/share/bash-completion/completions/aperture",
      "  aperture completion fish > ~/.config/fish/completions/aperture.fish",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printUninstallHelp(): void {
  stdout.write(
    [
      "Aperture Uninstall",
      "Remove Aperture-owned local state and Claude hook entries before uninstalling the package.",
      "",
      "Usage:",
      "  aperture uninstall --yes [--project /path/to/project]",
      "",
      "What it removes:",
      "  - ~/.aperture",
      "  - Aperture Claude hook entries from ~/.claude/settings.json",
      "  - Aperture Claude hook entries from any --project targets you pass",
      "  - .aperture under any --project targets you pass",
      "",
      "Examples:",
      "  aperture uninstall --yes",
      "  aperture uninstall --yes --project /path/to/repo",
      "",
      "After cleanup, remove the package itself with:",
      "  npm uninstall -g @tomismeta/aperture",
      "  pnpm remove -g @tomismeta/aperture",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printClaudeHelp(): void {
  stdout.write(
    [
      "Aperture Claude Code",
      "Configure Claude Code so Aperture can surface approvals and questions.",
      "",
      "Usage:",
      "  aperture claude connect --global",
      "  aperture claude connect /path/to/project",
      "  aperture claude disconnect --global",
      "  aperture claude disconnect /path/to/project",
      "",
      "Commands:",
      "  connect      Install Aperture Claude hook entries",
      "  disconnect   Remove Aperture Claude hook entries",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printOpencodeHelp(): void {
  stdout.write(
    [
      "Aperture OpenCode",
      "Connect Aperture to an OpenCode server-backed session.",
      "",
      "The opinionated Aperture flow expects:",
      "  1. opencode serve --port 4096",
      "  2. opencode attach http://127.0.0.1:4096",
      "  3. aperture",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printInternalHelp(): void {
  stdout.write(
    [
      "Aperture Internal",
      "Advanced runtime, TUI, adapter, and hook plumbing used for debugging and support.",
      "",
      "Usage:",
      "  aperture internal runtime [--learning on|off]",
      "  aperture internal tui",
      "  aperture internal claude-adapter",
      "  aperture internal opencode-adapter",
      "  aperture internal hook claude-forward",
    ].join("\n"),
  );
  stdout.write("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildBashCompletionScript(): string {
  return `# aperture bash completion
_aperture_completion() {
  local cur prev command
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"

  local root_commands="help doctor debug completion uninstall claude opencode internal version"
  local help_topics="launch doctor debug completion uninstall claude opencode internal"
  local claude_commands="connect disconnect"
  local debug_topics="runtime claude opencode state capture all"
  local completion_shells="bash zsh fish"
  local internal_commands="runtime tui claude-adapter opencode-adapter hook"
  local root_flags="--help -h --version -v --learning --no-claude --no-opencode --capture --capture-out"

  case "$command" in
    help)
      COMPREPLY=( $(compgen -W "$help_topics" -- "$cur") )
      return
      ;;
    claude)
      COMPREPLY=( $(compgen -W "$claude_commands" -- "$cur") )
      return
      ;;
    debug)
      COMPREPLY=( $(compgen -W "$debug_topics" -- "$cur") )
      return
      ;;
    completion)
      COMPREPLY=( $(compgen -W "$completion_shells" -- "$cur") )
      return
      ;;
    internal)
      COMPREPLY=( $(compgen -W "$internal_commands" -- "$cur") )
      return
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$root_flags" -- "$cur") )
    return
  fi

  COMPREPLY=( $(compgen -W "$root_commands" -- "$cur") )
}

complete -F _aperture_completion aperture
`;
}

function buildZshCompletionScript(): string {
  return `#compdef aperture

local -a root_commands help_topics claude_commands debug_topics completion_shells internal_commands
root_commands=(
  'help:show help for Aperture or a topic'
  'doctor:print runtime, Claude, OpenCode, and state health'
  'debug:print support details for troubleshooting'
  'completion:print a shell completion script'
  'uninstall:remove Aperture-owned state and Claude hooks'
  'claude:manage Claude Code setup'
  'opencode:show the OpenCode setup flow Aperture expects'
  'internal:advanced runtime, TUI, adapter, and hook plumbing'
  'version:print the installed Aperture version'
)
help_topics=(launch doctor debug completion uninstall claude opencode internal)
claude_commands=(connect disconnect)
debug_topics=(runtime claude opencode state capture all)
completion_shells=(bash zsh fish)
internal_commands=(runtime tui claude-adapter opencode-adapter hook)

if (( CURRENT == 2 )); then
  _describe 'command' root_commands
  return
fi

case "$words[2]" in
  help)
    _describe 'help topic' help_topics
    ;;
  claude)
    _describe 'Claude command' claude_commands
    ;;
  debug)
    _describe 'debug topic' debug_topics
    ;;
  completion)
    _describe 'shell' completion_shells
    ;;
  internal)
    _describe 'internal command' internal_commands
    ;;
  *)
    _arguments \
      '--help[Show this help text]' \
      '-h[Show this help text]' \
      '--version[Print the installed Aperture version]' \
      '-v[Print the installed Aperture version]' \
      '--learning[Start a new runtime with learning on or off]:mode:(on off)' \
      '--no-claude[Skip starting the Claude Code adapter]' \
      '--no-opencode[Skip starting the OpenCode adapter]' \
      '--capture[Export a troubleshooting capture when Aperture exits]' \
      '--capture-out[Write the captured bundle to an explicit path]:path:_files'
    ;;
esac
`;
}

function buildFishCompletionScript(): string {
  return `complete -c aperture -f

complete -c aperture -n '__fish_use_subcommand' -a 'help' -d 'Show help for Aperture or a topic'
complete -c aperture -n '__fish_use_subcommand' -a 'doctor' -d 'Print runtime, Claude, OpenCode, and state health'
complete -c aperture -n '__fish_use_subcommand' -a 'debug' -d 'Print support details for troubleshooting'
complete -c aperture -n '__fish_use_subcommand' -a 'completion' -d 'Print a shell completion script'
complete -c aperture -n '__fish_use_subcommand' -a 'uninstall' -d 'Remove Aperture-owned state and Claude hooks'
complete -c aperture -n '__fish_use_subcommand' -a 'claude' -d 'Manage Claude Code setup'
complete -c aperture -n '__fish_use_subcommand' -a 'opencode' -d 'Show the OpenCode setup flow Aperture expects'
complete -c aperture -n '__fish_use_subcommand' -a 'internal' -d 'Advanced runtime, TUI, adapter, and hook plumbing'
complete -c aperture -n '__fish_use_subcommand' -a 'version' -d 'Print the installed Aperture version'

complete -c aperture -n '__fish_seen_subcommand_from help' -a 'launch doctor debug completion uninstall claude opencode internal'
complete -c aperture -n '__fish_seen_subcommand_from claude' -a 'connect disconnect'
complete -c aperture -n '__fish_seen_subcommand_from debug' -a 'runtime claude opencode state capture all'
complete -c aperture -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
complete -c aperture -n '__fish_seen_subcommand_from internal' -a 'runtime tui claude-adapter opencode-adapter hook'

complete -c aperture -l help -s h -d 'Show this help text'
complete -c aperture -l version -s v -d 'Print the installed Aperture version'
complete -c aperture -l learning -d 'Start a new runtime with learning on or off'
complete -c aperture -l no-claude -d 'Skip starting the Claude Code adapter'
complete -c aperture -l no-opencode -d 'Skip starting the OpenCode adapter'
complete -c aperture -l capture -d 'Export a troubleshooting capture when Aperture exits'
complete -c aperture -l capture-out -r -d 'Write the captured bundle to an explicit path'
`;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
