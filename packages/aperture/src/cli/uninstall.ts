import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";

import { discoverLocalRuntimes } from "@aperture/runtime";

import { apertureHomeDir } from "../opencode-config.js";
import { removeClaudeHooks, resolveClaudeSettingsPath } from "./claude-hooks.js";
import { readRequiredValue, pathExists } from "./shared.js";

type UninstallOptions = {
  yes: boolean;
  help: boolean;
  projectRoots: string[];
};

export async function runUninstall(
  args: string[],
  options: {
    command: string;
    printHelp(): void;
  },
): Promise<void> {
  const parsed = parseUninstallArgs(args);
  if (parsed.help) {
    options.printHelp();
    return;
  }

  const dataDir = apertureHomeDir();
  const settingsPath = resolveClaudeSettingsPath(true);
  const projectRoots = [...parsed.projectRoots];
  const cwdSettingsPath = resolveClaudeSettingsPath(false, process.cwd());
  if (projectRoots.length === 0 && (await pathExists(cwdSettingsPath))) {
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

  if (!parsed.yes) {
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
  const globalResult = await removeClaudeHooks({ global: true, command: options.command });
  if (globalResult.changed) {
    removedSettings.push(globalResult.settingsPath);
  }

  for (const projectRoot of projectRoots) {
    const result = await removeClaudeHooks({
      global: false,
      targetRoot: projectRoot,
      command: options.command,
    });
    if (result.changed) {
      removedSettings.push(result.settingsPath);
    }

    await rm(resolve(projectRoot, ".aperture"), { recursive: true, force: true });
  }

  await rm(dataDir, { recursive: true, force: true });

  stdout.write("Aperture cleanup complete.\n");
  if (stoppedRuntimes.length > 0) {
    stdout.write(
      `Stopped ${stoppedRuntimes.length} live runtime${stoppedRuntimes.length === 1 ? "" : "s"}.\n`,
    );
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
