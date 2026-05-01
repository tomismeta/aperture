import { stderr, stdout } from "node:process";

import {
  ApertureRuntimeClient,
  baseAttentionSurfaceCapabilities,
  bootstrapLearningPersistence,
  createApertureRuntime,
  type ApertureRuntimeSnapshot,
} from "@aperture/runtime";
import { runAttentionTui } from "@aperture/tui";

import {
  claudeBridgeUrl,
  isClaudeBridgePortInUse,
  readyClaudeState,
  runtimeHasLiveClaudeActivity,
  startLauncherClaudeAdapter,
} from "./claude-adapter.js";
import {
  buildClaudeHookCommand,
  installClaudeHooks,
  type ClaudeHookInstallResult,
} from "./claude-hooks.js";
import { beginCapture, exportCapturedSession, type CaptureOptions } from "./capture.js";
import { printLauncherHelp } from "./help.js";
import {
  describeProfileTargets,
  opencodeAttachHint,
  probeOpencodeProfiles,
  runtimeHasLiveOpencodeActivity,
  startLauncherOpencodeAdapter,
} from "./opencode-support.js";
import {
  discoverRuntimeUrl,
  fetchRuntimeSnapshot,
  runtimeHasAdapter,
  type RuntimeBinding,
} from "./runtime-support.js";
import { readNumber, readRequiredValue } from "./shared.js";
import { LauncherConnectionStore, makeConnectionEntry } from "../connection-status.js";
import {
  apertureLearningWorkspaceRoot,
  listEnabledGlobalOpencodeProfiles,
  normalizeBaseUrl,
  saveGlobalOpencodeProfile,
  type OpencodeConnectionProfile,
} from "../opencode-config.js";

type LauncherOptions = {
  help: boolean;
  learningMode: "on" | "off";
  enableClaude: boolean;
  enableOpencode: boolean;
  capture: CaptureOptions | null;
};

export type LauncherContext = {
  entryPath: string;
  repoRoot: string;
};

export async function runLauncher(args: string[], context: LauncherContext): Promise<void> {
  const options = parseLauncherArgs(args);
  if (options.help) {
    printLauncherHelp();
    return;
  }

  const cleanupTasks: Array<() => Promise<void>> = [];
  let shuttingDown = false;
  let runtimeBaseUrl: string | null = null;
  let captureCursor: Awaited<ReturnType<typeof beginCapture>> | null = null;
  const connectionStore = new LauncherConnectionStore([
    options.enableClaude
      ? makeConnectionEntry(
          "claude",
          "Claude Code",
          "starting",
          "Preparing Claude Code integration.",
        )
      : makeConnectionEntry(
          "claude",
          "Claude Code",
          "disabled",
          "Disabled for this Aperture session.",
        ),
    options.enableOpencode
      ? makeConnectionEntry("opencode", "OpenCode", "starting", "Preparing OpenCode integration.")
      : makeConnectionEntry(
          "opencode",
          "OpenCode",
          "disabled",
          "Disabled for this Aperture session.",
        ),
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
      context,
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
      reportLauncherStartupWarning(error);
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

function reportLauncherStartupWarning(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Launcher startup warning: ${message}\n`);
  if (process.env.APERTURE_VERBOSE_BOOT === "1" && error instanceof Error && error.stack) {
    stderr.write(`${error.stack}\n`);
  }
}

function parseLauncherArgs(args: string[]): LauncherOptions {
  const options: LauncherOptions = {
    help: false,
    learningMode: "on",
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
  context: LauncherContext,
  registerCleanup: (cleanup: () => Promise<void>) => void,
  connections: LauncherConnectionStore,
  setRefreshClaudeAction: (action: () => Promise<void>) => void,
  setRetryOpencodeAction: (action: () => Promise<void>) => void,
  setStopOpencodeSetupAction: (action: () => Promise<void>) => void,
): Promise<void> {
  const hookCommand = buildClaudeHookCommand(context.entryPath, context.repoRoot);
  const claudeSetup = options.enableClaude
    ? installClaudeHooks({ global: true, quiet: true, command: hookCommand })
    : Promise.resolve<ClaudeHookInstallResult | null>(null);
  const opencodeSetup = options.enableOpencode
    ? ensureDefaultOpencodeProfile({ quiet: true }).then(async () =>
        listEnabledGlobalOpencodeProfiles(),
      )
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
      const nextInstall = await installClaudeHooks({
        global: true,
        quiet: true,
        command: hookCommand,
      });
      const nextSnapshot = await fetchRuntimeSnapshot(runtimeBaseUrl);
      await startClaudeConnection(
        runtimeBaseUrl,
        nextSnapshot,
        nextInstall,
        registerCleanup,
        connections,
      );
    });
    await startClaudeConnection(
      runtimeBaseUrl,
      runtimeSnapshot,
      claudeInstall,
      registerCleanup,
      connections,
    );
  }

  if (options.enableOpencode) {
    const opencode = await startOpencodeConnection(
      runtimeBaseUrl,
      runtimeSnapshot,
      opencodeProfiles,
      registerCleanup,
      connections,
    );
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
      const latestSnapshot = await fetchRuntimeSnapshot(runtimeBaseUrl);
      if (!runtimeHasLiveOpencodeActivity(latestSnapshot)) {
        connections.update("opencode", {
          state: "action",
          detail: "OpenCode server is ready. Attach the OpenCode terminal to finish setup.",
          hint: opencodeAttachHint(profiles),
        });
        return;
      }

      connections.update("opencode", {
        state: "ready",
        detail: attachedExistingBridge
          ? `Attached to an existing OpenCode session at ${describeProfileTargets(profiles)}.`
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
        await refreshHealth();
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
  const learningBootstrap =
    options.learningMode === "on"
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
      terminalTitle: "Aperture",
      getConnectionStatus: () => connections.getSnapshot(),
      subscribeConnectionStatus: (listener) => connections.subscribe(listener),
      runConnectionAction,
    });
  } finally {
    await client.close();
  }
}
