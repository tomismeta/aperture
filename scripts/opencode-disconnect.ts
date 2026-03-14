import { stderr, stdout } from "node:process";

import { globalOpencodeConfigPath, removeGlobalOpencodeProfile } from "./opencode-config.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  if (!global) {
    stderr.write("Usage: pnpm opencode:disconnect --global [--name NAME]\n");
    process.exit(1);
  }

  const profileId = readFlag(args, "--name") ?? "default";
  const removed = await removeGlobalOpencodeProfile(profileId);
  if (!removed) {
    stdout.write(`No OpenCode connection profile named "${profileId}" was found in ${globalOpencodeConfigPath()}\n`);
    return;
  }

  stdout.write(`Removed OpenCode connection profile "${profileId}" from ${globalOpencodeConfigPath()}\n`);
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
