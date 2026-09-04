import path from "node:path";
import { stderr } from "node:process";

import { resolveOmpAttentionSocketPath } from "./omp-attention-event.js";

import {
  loadNotificationWorkerConfig,
  notificationWorkerPaths,
} from "./notification-worker/config.js";
import {
  cleanupOwnedSocket,
  OwnedSocketCleanupError,
} from "./notification-worker/direct-socket-lifecycle.js";
import { runNotificationWorkerStdio } from "./notification-worker/stdio.js";

declare const APERTURE_PACKAGE_VERSION: string;
declare const APERTURE_WORKER_ARTIFACT_MODE: "notification" | "omp-only";

const packageVersion =
  typeof APERTURE_PACKAGE_VERSION === "string"
    ? APERTURE_PACKAGE_VERSION
    : (process.env.npm_package_version ?? "0.0.0-development");
const workerMode =
  typeof APERTURE_WORKER_ARTIFACT_MODE === "string"
    ? APERTURE_WORKER_ARTIFACT_MODE
    : "notification";

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.cleanupOwnedSocket && options.stateDir) {
    throw new OwnedSocketCleanupError("Aperture worker socket cleanup arguments are invalid", 74);
  }
  if (options.cleanupOwnedSocket) {
    const socketPath = resolveOmpAttentionSocketPath();
    if (!socketPath) {
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup path is invalid", 74);
    }
    await cleanupOwnedSocket(socketPath);
    return;
  }
  const defaults = notificationWorkerPaths();
  const configPath = path.resolve(options.configPath ?? defaults.configPath);
  const stateDir = path.resolve(options.stateDir ?? defaults.stateDir);
  const config = await loadNotificationWorkerConfig(configPath);
  await runNotificationWorkerStdio({
    packageVersion,
    identities: config.identities,
    stateDir,
    mode: workerMode,
    ...(defaults.socketPath ? { socketPath: defaults.socketPath } : {}),
  });
}

type WorkerOptions = {
  configPath?: string;
  stateDir?: string;
  cleanupOwnedSocket: boolean;
};

function parseOptions(args: string[]): WorkerOptions {
  const options: WorkerOptions = { cleanupOwnedSocket: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--cleanup-owned-socket") {
      options.cleanupOwnedSocket = true;
      continue;
    }
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value) throw new Error("--config requires a path");
      options.configPath = value;
      index += 1;
      continue;
    }
    if (argument === "--state-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--state-dir requires a path");
      options.stateDir = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: aperture-attention-engine [--config <path>] [--state-dir <path>] [--cleanup-owned-socket]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown aperture attention worker option: ${argument ?? "(missing)"}`);
  }
  return options;
}

void main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : "Aperture attention worker failed"}\n`);
  process.exitCode = error instanceof OwnedSocketCleanupError ? error.exitCode : 1;
});
