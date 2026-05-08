import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import packageMetadata from "../package.json" with { type: "json" };

import { runClaudeAdapter, runClaudeForward } from "./cli/claude-adapter.js";
import {
  buildClaudeHookCommand,
  installClaudeHooks,
  removeClaudeHooks,
} from "./cli/claude-hooks.js";
import { runConfigCommand } from "./cli/config.js";
import { collectDebugSnapshot, printDebugSnapshot, runDoctor } from "./cli/doctor-debug.js";
import {
  printClaudeHelp,
  printDebugHelp,
  printInternalHelp,
  printOpencodeHelp,
  printRequestedHelp,
  printRootHelp,
  printUninstallHelp,
  printVersion,
  runCompletionCommand,
} from "./cli/help.js";
import { runLauncher } from "./cli/launcher.js";
import { runOpencodeAdapter } from "./cli/opencode-support.js";
import { resolveRuntimeUrl, runRuntimeServer, runTui } from "./cli/runtime-support.js";
import { runUninstall } from "./cli/uninstall.js";

const CLI_ENTRY_PATH = fileURLToPath(import.meta.url);
const CLI_REPO_ROOT = resolve(dirname(CLI_ENTRY_PATH), "..", "..", "..");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command.startsWith("-") || command === "launch") {
    if (command === "--version" || command === "-v") {
      printVersion(packageMetadata.version);
      return;
    }
    await runLauncher(command === "launch" ? args.slice(1) : args, {
      entryPath: CLI_ENTRY_PATH,
      repoRoot: CLI_REPO_ROOT,
    });
    return;
  }

  switch (command) {
    case "help":
      printRequestedHelp(args.slice(1));
      return;
    case "completion":
      await runCompletionCommand(args.slice(1));
      return;
    case "debug":
      await runDebugCommand(args.slice(1));
      return;
    case "config":
      await runConfigCommand(args.slice(1));
      return;
    case "internal":
      await runInternalCommand(args.slice(1));
      return;
    case "version":
      printVersion(packageMetadata.version);
      return;
    case "claude":
      await runClaudeCommand(args.slice(1));
      return;
    case "opencode":
      await runOpencodeCommand(args.slice(1));
      return;
    case "doctor":
      await runDoctor(buildClaudeHookCommand(CLI_ENTRY_PATH, CLI_REPO_ROOT));
      return;
    case "uninstall":
      await runUninstall(args.slice(1), {
        command: buildClaudeHookCommand(CLI_ENTRY_PATH, CLI_REPO_ROOT),
        printHelp: printUninstallHelp,
      });
      return;
    case "--version":
    case "-v":
      printVersion(packageMetadata.version);
      return;
    case "--help":
    case "-h":
      printRootHelp();
      return;
    default:
      throw new Error(`Unknown Aperture command: ${command}`);
  }
}

async function runHookCommand(args: string[]): Promise<void> {
  const command = args[0];
  switch (command) {
    case "claude-forward":
      await runClaudeForward();
      return;
    default:
      throw new Error(`Unknown Aperture hook command: ${command ?? "(missing)"}`);
  }
}

async function runInternalCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printInternalHelp();
    return;
  }

  switch (command) {
    case "runtime":
      await runRuntimeServer(args.slice(1));
      return;
    case "tui":
      await runTui();
      return;
    case "hook":
      await runHookCommand(args.slice(1));
      return;
    case "claude-adapter":
      await runClaudeAdapter(
        await resolveRuntimeUrl("Claude adapter", [
          "APERTURE_RUNTIME_URL",
          "APERTURE_CLAUDE_RUNTIME_URL",
        ]),
      );
      return;
    case "opencode-adapter":
      await runOpencodeAdapter(
        await resolveRuntimeUrl("OpenCode adapter", [
          "APERTURE_RUNTIME_URL",
          "APERTURE_OPENCODE_RUNTIME_URL",
        ]),
      );
      return;
    default:
      throw new Error(`Unknown Aperture internal command: ${command}`);
  }
}

async function runDebugCommand(args: string[]): Promise<void> {
  const topic = args[0];
  if (topic === "--help" || topic === "-h") {
    printDebugHelp();
    return;
  }

  const snapshot = await collectDebugSnapshot();
  const command = buildClaudeHookCommand(CLI_ENTRY_PATH, CLI_REPO_ROOT);
  switch (topic) {
    case undefined:
    case "all":
      printDebugSnapshot(snapshot, "all", command);
      return;
    case "runtime":
    case "claude":
    case "opencode":
    case "state":
    case "capture":
      printDebugSnapshot(snapshot, topic, command);
      return;
    default:
      throw new Error(`Unknown Aperture debug topic: ${topic}`);
  }
}

async function runClaudeCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printClaudeHelp();
    return;
  }

  switch (command) {
    case "connect":
      await runClaudeConnect(args.slice(1));
      return;
    case "disconnect":
      await runClaudeDisconnect(args.slice(1));
      return;
    default:
      throw new Error(`Unknown Aperture Claude command: ${command ?? "(missing)"}`);
  }
}

async function runOpencodeCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printOpencodeHelp();
    return;
  }

  switch (command) {
    default:
      throw new Error(`Unknown Aperture OpenCode command: ${command ?? "(missing)"}`);
  }
}

async function runClaudeConnect(args: string[]): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude connect /path/to/project\n");
    stderr.write("   or: aperture claude connect --global\n");
    process.exit(1);
  }

  await installClaudeHooks({
    global,
    command: buildClaudeHookCommand(CLI_ENTRY_PATH, CLI_REPO_ROOT),
    ...(targetArg ? { targetRoot: resolve(targetArg) } : {}),
  });
}

async function runClaudeDisconnect(args: string[]): Promise<void> {
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: aperture claude disconnect /path/to/project\n");
    stderr.write("   or: aperture claude disconnect --global\n");
    process.exit(1);
  }

  const result = await removeClaudeHooks({
    global,
    command: buildClaudeHookCommand(CLI_ENTRY_PATH, CLI_REPO_ROOT),
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

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
