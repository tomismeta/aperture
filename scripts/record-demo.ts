import { accessSync, constants, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const tapeArg = process.argv[2] ?? "demo/aperture-demo.tape";
const tapePath = resolve(rootDir, tapeArg);
const outputGif = resolve(rootDir, "docs/assets/demo.gif");
const outputMp4 = resolve(rootDir, "docs/assets/demo.mp4");

function main(): void {
  assertExecutable("vhs", [
    "vhs is required to record the TUI demo.",
    "Install it from https://github.com/charmbracelet/vhs and rerun pnpm demo:record.",
  ]);
  assertReadable(tapePath, `Tape file not found: ${tapePath}`);

  mkdirSync(dirname(outputGif), { recursive: true });
  rmSync(outputGif, { force: true });
  rmSync(outputMp4, { force: true });

  process.stdout.write(`Recording Aperture TUI demo to ${outputGif} and ${outputMp4}\n`);
  runOrExit("vhs", [tapePath], rootDir);
}

function assertExecutable(command: string, messageLines: string[]): void {
  const result = spawnSync(command, ["--help"], { stdio: "ignore" });
  if (result.error) {
    for (const line of messageLines) {
      process.stderr.write(`${line}\n`);
    }
    process.exit(1);
  }
}

function assertReadable(path: string, errorMessage: string): void {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    process.stderr.write(`${errorMessage}\n`);
    process.exit(1);
  }
}

function runOrExit(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
