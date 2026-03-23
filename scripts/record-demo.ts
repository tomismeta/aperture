import { accessSync, constants, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const tapeArg = process.argv[2] ?? "demo/aperture-demo.tape";
const tapePath = resolve(rootDir, tapeArg);
function main(): void {
  assertExecutable("vhs", [
    "vhs is required to record the TUI demo.",
    "Install it from https://github.com/charmbracelet/vhs and rerun pnpm demo:record.",
  ]);
  assertReadable(tapePath, `Tape file not found: ${tapePath}`);
  const outputs = readTapeOutputs(tapePath);

  for (const outputPath of outputs) {
    mkdirSync(dirname(outputPath), { recursive: true });
    rmSync(outputPath, { force: true });
  }

  process.stdout.write(`Recording Aperture TUI demo to ${outputs.join(" and ")}\n`);
  runOrExit("vhs", [tapePath], rootDir);
}

function readTapeOutputs(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const outputs = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Output "))
    .map((line) => line.slice("Output ".length).trim())
    .filter((line) => line.length > 0)
    .map((line) => resolve(rootDir, line));

  if (outputs.length === 0) {
    process.stderr.write(`Tape file does not declare any Output paths: ${path}\n`);
    process.exit(1);
  }

  return outputs;
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
