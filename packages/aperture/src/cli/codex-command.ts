import { resolve } from "node:path";
import { stderr, stdout } from "node:process";

import {
  buildCodexHookCommand,
  installCodexProductHooks,
  removeCodexHooks,
} from "./codex-hooks.js";
import { printCodexHelp } from "./help.js";
import type { ProductCliContext } from "./claude-command.js";

export async function runCodexCommand(args: string[], context: ProductCliContext): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printCodexHelp();
    return;
  }

  switch (command) {
    case "connect":
      await runCodexConnect(args.slice(1), context);
      return;
    case "disconnect":
      await runCodexDisconnect(args.slice(1), context);
      return;
    default:
      throw new Error(`Unknown Aperture Codex command: ${command ?? "(missing)"}`);
  }
}

async function runCodexConnect(args: string[], context: ProductCliContext): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture codex connect /path/to/project\n");
    stderr.write("   or: aperture codex connect --global\n");
    process.exit(1);
  }

  await installCodexProductHooks({
    global,
    command: buildCodexHookCommand(context.entryPath, context.repoRoot),
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });
}

async function runCodexDisconnect(args: string[], context: ProductCliContext): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture codex disconnect /path/to/project\n");
    stderr.write("   or: aperture codex disconnect --global\n");
    process.exit(1);
  }

  const result = await removeCodexHooks({
    global,
    command: buildCodexHookCommand(context.entryPath, context.repoRoot),
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });

  if (!result.changed) {
    stdout.write(`No Aperture Codex hooks found in ${result.hooksPath}\n`);
    return;
  }

  stdout.write(`Updated ${result.hooksPath}\n`);
  stdout.write("Removed Aperture Codex hook entries.\n");
  stdout.write("Note: the Codex hooks feature flag was left in config.toml intentionally.\n");
}
