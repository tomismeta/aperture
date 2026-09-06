import os from "node:os";
import path from "node:path";
import { stderr } from "node:process";

import { resolveOmpAttentionSocketPath } from "./omp-attention-event.js";
import {
  cleanupOwnedSocket,
  DirectSocketStartupError,
  OwnedSocketCleanupError,
} from "./notification-worker/direct-socket-lifecycle.js";
import { runOmpWorkerStdio } from "./notification-worker/omp-stdio.js";
import { serializeOmpWorkerOutput } from "./notification-worker/omp-worker-protocol.js";

// Replaced by the artifact build. The environment fallback exists only for source execution.
declare const APERTURE_PACKAGE_VERSION: string;

const packageVersion =
  typeof APERTURE_PACKAGE_VERSION === "string"
    ? APERTURE_PACKAGE_VERSION
    : (process.env.npm_package_version ?? "0.0.0-development");

let runningWorker = false;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const socketPath = resolveOmpAttentionSocketPath();
  if (!socketPath) {
    throw new OwnedSocketCleanupError("Aperture worker socket path is invalid", 74);
  }
  if (options.cleanupOwnedSocket) {
    if (options.stateDir) {
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup arguments are invalid", 74);
    }
    await cleanupOwnedSocket(socketPath);
    return;
  }
  const stateDir = options.stateDir ?? defaultStateDirectory(process.env);
  runningWorker = true;
  await runOmpWorkerStdio({ packageVersion, stateDir, socketPath });
}

type WorkerOptions = {
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
    if (argument === "--state-dir") {
      const value = args[index + 1];
      if (!value || !path.isAbsolute(value)) {
        throw new Error("--state-dir requires an absolute path");
      }
      options.stateDir = path.normalize(value);
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: aperture-attention-engine [--state-dir <absolute-path>] [--cleanup-owned-socket]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown aperture attention worker option: ${argument ?? "(missing)"}`);
  }
  return options;
}

function defaultStateDirectory(environment: NodeJS.ProcessEnv): string {
  const home = environment.HOME || os.homedir();
  const stateHome = environment.XDG_STATE_HOME || path.join(home, ".local", "state");
  if (!path.isAbsolute(stateHome) || stateHome.includes("\0")) {
    throw new Error("Aperture worker state home is invalid");
  }
  return path.join(path.normalize(stateHome), "omarchy", "aperture");
}

void main().catch((error) => {
  let failure = error;
  if (!runningWorker && !process.argv.includes("--cleanup-owned-socket")) {
    process.stdout.write(
      serializeOmpWorkerOutput({
        type: "error",
        code: "direct_transport_unavailable",
        message: "Aperture worker startup configuration is unsafe.",
        recoverable: false,
      }),
    );
    failure = new DirectSocketStartupError(
      "Aperture worker startup configuration is unsafe",
      "unsafe",
    );
  }
  const exitCode =
    failure instanceof OwnedSocketCleanupError || failure instanceof DirectSocketStartupError
      ? failure.exitCode
      : 1;
  process.exitCode = exitCode;
  if (runningWorker) {
    // Teardown may have failed before Node could safely close the Unix listener.
    // Process exit closes descriptors without unlinking a replacement pathname.
    // Give the diagnostic a bounded chance to flush, even with blocked stderr.
    setTimeout(() => process.exit(exitCode), 100).unref();
  }
  stderr.write(
    `${failure instanceof Error ? failure.message : "Aperture attention worker failed"}\n`,
    () => {
      if (runningWorker) process.exit(exitCode);
    },
  );
});
