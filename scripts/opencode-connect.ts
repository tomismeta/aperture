import { stderr, stdout } from "node:process";

import {
  globalOpencodeConfigPath,
  normalizeBaseUrl,
  promptHiddenPassword,
  saveGlobalOpencodeProfile,
} from "./opencode-config.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  if (!global) {
    stderr.write("Usage: pnpm opencode:connect --global [--url URL] [--name NAME] [--label LABEL] [--username USER] [--password-env ENV] [--directory PATH]\n");
    process.exit(1);
  }

  const profileId = readFlag(args, "--name") ?? "default";
  const label = readFlag(args, "--label");
  const baseUrl = normalizeBaseUrl(readFlag(args, "--url") ?? "http://127.0.0.1:4096");
  const username = readFlag(args, "--username");
  const passwordEnv = readFlag(args, "--password-env");
  const directory = readFlag(args, "--directory");
  const scopeMode = readFlag(args, "--scope-mode");

  let password: string | undefined;
  if (username && !passwordEnv) {
    password = await promptHiddenPassword(`OpenCode password for ${username}: `);
    if (password) {
      stdout.write("Warning: storing a direct password in ~/.aperture/opencode.json. Prefer --password-env for better security.\n");
    }
  }

  const profile = await saveGlobalOpencodeProfile({
    id: profileId,
    ...(label ? { label } : {}),
    baseUrl,
    enabled: true,
    ...(username || passwordEnv || password
      ? {
          auth: {
            username: username ?? "opencode",
            ...(password ? { password } : {}),
            ...(passwordEnv ? { passwordEnv } : {}),
          },
        }
      : {}),
    ...(directory
      ? {
          scope: {
            directory,
            ...(scopeMode === "query" ? { mode: "query" as const } : {}),
          },
        }
      : {}),
  });

  stdout.write(`Saved OpenCode connection profile "${profile.id}" to ${globalOpencodeConfigPath()}\n`);
  stdout.write(`Base URL: ${profile.baseUrl}\n`);
  if (profile.scope?.directory) {
    stdout.write(`Directory scope: ${profile.scope.directory} (${profile.scope.mode ?? "header"})\n`);
  }
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. Start OpenCode separately: opencode serve\n");
  stdout.write("2. Start Aperture: pnpm aperture\n");
  stdout.write("3. The shared Aperture TUI will attach to the same runtime as Claude Code and OpenCode adapters.\n");
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    return undefined;
  }
  return value;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
