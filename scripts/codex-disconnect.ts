import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { buildCodexHookCommand, removeCodexHooks } from "../packages/codex/src/index.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("-"));

  if (!global && !targetArg) {
    stderr.write("Usage: pnpm codex:disconnect /path/to/project\n");
    stderr.write("   or: pnpm codex:disconnect --global\n");
    process.exit(1);
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = targetArg ? resolve(targetArg) : undefined;
  const forwarderPath = resolve(repoRoot, "scripts", "codex-forward.ts");
  const command = buildCodexHookCommand(forwarderPath, repoRoot);

  const result = await removeCodexHooks({
    global,
    targetRoot,
    command,
  });

  if (!result.changed) {
    stdout.write(`No Aperture Codex hooks found in ${result.hooksPath}\n`);
    return;
  }

  stdout.write(`Updated ${result.hooksPath}\n`);
  stdout.write("Removed Aperture Codex hook entries.\n");
  stdout.write("Note: the Codex hooks feature flag was left in config.toml intentionally.\n");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
