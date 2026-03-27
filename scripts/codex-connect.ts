import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { buildCodexHookCommand, installCodexHooks } from "../packages/codex/src/index.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("-"));

  if (!global && !targetArg) {
    stderr.write("Usage: pnpm codex:connect /path/to/project\n");
    stderr.write("   or: pnpm codex:connect --global\n");
    process.exit(1);
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = targetArg ? resolve(targetArg) : undefined;
  const forwarderPath = resolve(repoRoot, "scripts", "codex-forward.ts");
  const command = buildCodexHookCommand(forwarderPath, repoRoot);

  const result = await installCodexHooks({
    global,
    targetRoot,
    command,
  });

  if (!result.changed && !result.featureChanged) {
    stdout.write(`Aperture Codex hooks are already installed in ${result.hooksPath}\n`);
    stdout.write(`Feature flag already enabled in ${result.configPath}\n`);
    return;
  }

  stdout.write(`Updated ${result.hooksPath}\n`);
  stdout.write(`Ensured codex_hooks feature flag in ${result.configPath}\n`);
  stdout.write(`Hook command: ${result.command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. Start Aperture runtime: pnpm serve\n");
  stdout.write("2. Start the Codex hook adapter: pnpm codex:hooks:start\n");
  stdout.write(`3. Restart Codex${global ? "" : " in the target project"}.\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
