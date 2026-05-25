import { resolve } from "node:path";
import { stderr, stdout } from "node:process";

import { buildClaudeHookCommand, installClaudeHooks, removeClaudeHooks } from "./claude-hooks.js";
import { printClaudeHelp } from "./help.js";

export type ProductCliContext = {
  entryPath: string;
  repoRoot: string;
};

export async function runClaudeCommand(args: string[], context: ProductCliContext): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printClaudeHelp();
    return;
  }

  switch (command) {
    case "connect":
      await runClaudeConnect(args.slice(1), context);
      return;
    case "disconnect":
      await runClaudeDisconnect(args.slice(1), context);
      return;
    default:
      throw new Error(`Unknown Aperture Claude command: ${command ?? "(missing)"}`);
  }
}

async function runClaudeConnect(args: string[], context: ProductCliContext): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude connect /path/to/project\n");
    stderr.write("   or: aperture claude connect --global\n");
    process.exit(1);
  }

  await installClaudeHooks({
    global,
    command: buildClaudeHookCommand(context.entryPath, context.repoRoot),
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });
}

async function runClaudeDisconnect(args: string[], context: ProductCliContext): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude disconnect /path/to/project\n");
    stderr.write("   or: aperture claude disconnect --global\n");
    process.exit(1);
  }

  const result = await removeClaudeHooks({
    global,
    command: buildClaudeHookCommand(context.entryPath, context.repoRoot),
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
