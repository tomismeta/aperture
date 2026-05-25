import { stdout } from "node:process";

import {
  installCodexHooks,
  readHookConfig,
  removeCodexHooks,
  resolveCodexConfigPath,
  resolveCodexHooksPath,
  type CodexHookInstallResult,
} from "@aperture/codex/hook-config";

export {
  readHookConfig,
  removeCodexHooks,
  resolveCodexConfigPath,
  resolveCodexHooksPath,
  type CodexHookInstallResult,
};

export async function installCodexProductHooks(options: {
  global: boolean;
  targetRoot?: string;
  quiet?: boolean;
  command: string;
}): Promise<CodexHookInstallResult> {
  const result = await installCodexHooks(options);
  if (options.quiet) {
    return result;
  }

  if (!result.changed && !result.featureChanged) {
    stdout.write(`Aperture Codex hooks are already installed in ${result.hooksPath}\n`);
    stdout.write(`Codex hooks feature flag already enabled in ${result.configPath}\n`);
    return result;
  }

  stdout.write(`Updated ${result.hooksPath}\n`);
  stdout.write(`Ensured Codex hooks feature flag in ${result.configPath}\n`);
  stdout.write(`Hook command: ${result.command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. Start Aperture with Codex hooks enabled: aperture --codex\n");
  stdout.write(`2. Restart Codex${options.global ? "" : " in the target project"}.\n`);
  stdout.write("3. Run /hooks in Codex if available to confirm the hooks loaded.\n");

  return result;
}

export function buildCodexHookCommand(cliEntryPath: string, cliRepoRoot: string): string {
  if (cliEntryPath.endsWith(".ts")) {
    return `pnpm --dir ${shellQuote(cliRepoRoot)} exec tsx ${shellQuote(cliEntryPath)} internal hook codex-forward`;
  }

  return `${shellQuote(process.execPath)} ${shellQuote(cliEntryPath)} internal hook codex-forward`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/([\"\\\\$`])/g, "\\$1")}"`;
}
