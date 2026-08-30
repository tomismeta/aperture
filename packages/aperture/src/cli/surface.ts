import { stderr, stdout } from "node:process";

import { runApertureSurfaceStdio } from "../surface/stdio.js";

export async function runSurfaceCommand(args: string[], packageVersion: string): Promise<void> {
  const options = parseSurfaceOptions(args);
  if (options.help) {
    printSurfaceHelp();
    return;
  }
  if (!options.stdio) {
    throw new Error("Aperture surface currently requires --stdio.");
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runApertureSurfaceStdio({
      packageVersion,
      label: options.label,
      signal: controller.signal,
      stdout,
      stderr,
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export function printSurfaceHelp(): void {
  stdout.write(`Aperture external attention surface\n\n`);
  stdout.write(`Usage:\n`);
  stdout.write(`  aperture surface --stdio [--label <label>]\n\n`);
  stdout.write(`Options:\n`);
  stdout.write(`  --stdio          Emit the JSONL surface protocol.\n`);
  stdout.write(`  --label <label>  Runtime attachment label (default: external-surface).\n`);
  stdout.write(`  -h, --help       Show this help.\n`);
}

type SurfaceOptions = {
  stdio: boolean;
  label: string;
  help: boolean;
};

function parseSurfaceOptions(args: string[]): SurfaceOptions {
  let stdio = false;
  let label = "external-surface";
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--stdio":
        stdio = true;
        break;
      case "--label": {
        const value = args[index + 1];
        if (!value) {
          throw new Error("--label requires a value.");
        }
        label = normalizeLabel(value);
        index += 1;
        break;
      }
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`Unknown Aperture surface option: ${arg ?? "(missing)"}`);
    }
  }

  return { stdio, label, help };
}

function normalizeLabel(value: string): string {
  const label = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) {
    throw new Error("--label must contain visible text.");
  }
  if (label.length > 120) {
    throw new Error("--label must be 120 characters or fewer.");
  }
  return label;
}
