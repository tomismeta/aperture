import path from "node:path";
import { stderr } from "node:process";

import {
  loadNotificationWorkerConfig,
  notificationWorkerPaths,
} from "./notification-worker/config.js";
import { runNotificationWorkerStdio } from "./notification-worker/stdio.js";

declare const APERTURE_PACKAGE_VERSION: string;

const packageVersion =
  typeof APERTURE_PACKAGE_VERSION === "string"
    ? APERTURE_PACKAGE_VERSION
    : (process.env.npm_package_version ?? "0.0.0-development");

async function main(): Promise<void> {
  const defaults = notificationWorkerPaths();
  const options = parseOptions(process.argv.slice(2));
  const configPath = path.resolve(options.configPath ?? defaults.configPath);
  const stateDir = path.resolve(options.stateDir ?? defaults.stateDir);
  const config = await loadNotificationWorkerConfig(configPath);
  await runNotificationWorkerStdio({
    packageVersion,
    identities: config.identities,
    stateDir,
    ...(defaults.socketPath ? { socketPath: defaults.socketPath } : {}),
  });
}

type WorkerOptions = {
  configPath?: string;
  stateDir?: string;
};

function parseOptions(args: string[]): WorkerOptions {
  const options: WorkerOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
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
        "Usage: aperture-attention-engine [--config <path>] [--state-dir <path>]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown aperture attention worker option: ${argument ?? "(missing)"}`);
  }
  return options;
}

void main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
