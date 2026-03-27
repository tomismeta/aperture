import path from "node:path";

import {
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_SWE_SMITH_SPLIT,
  importPublicTrajectoryBundles,
  type ImportPublicTrajectoryBundlesOptions,
  type PublicTrajectoryDataset,
  type SweSmithTrajectorySplit,
} from "../packages/lab/src/index.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const imported = await importPublicTrajectoryBundles(options);
  const mode = options.dryRun ? "Prepared" : "Imported";

  console.log(
    `${mode} ${imported.length} public trajectory bundle${imported.length === 1 ? "" : "s"} from ${options.dataset ?? "swe-smith"} (${options.split ?? DEFAULT_SWE_SMITH_SPLIT}, offset ${options.offset ?? 0}).`,
  );

  for (const item of imported) {
    console.log(`- ${item.row.traj_id} -> ${path.relative(process.cwd(), item.filePath)}`);
  }
}

function parseArgs(argv: string[]): ImportPublicTrajectoryBundlesOptions {
  const options: ImportPublicTrajectoryBundlesOptions = {
    dataset: "swe-smith",
    split: DEFAULT_SWE_SMITH_SPLIT,
    offset: 0,
    limit: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readSplit(argv[++index]);
        break;
      case "--offset":
        options.offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        options.limit = readInteger(argv[++index], "--limit");
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.outputDirectory ??= DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR;
  return options;
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith") {
    return value;
  }

  throw new Error(`--dataset must be: swe-smith`);
}

function readSplit(value: string | undefined): SweSmithTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks") {
    return value;
  }

  throw new Error(`--split must be one of: tool, xml, ticks`);
}

function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }

  return parsed;
}

function printUsage(): void {
  console.log([
    "Usage: pnpm trajectory:import [options]",
    "",
    "Imports public trajectories into local Aperture Lab session bundles.",
    "",
    "Options:",
    "  --dataset <swe-smith>    Public dataset to import (default: swe-smith)",
    `  --split <tool|xml|ticks>  Dataset split to import (default: ${DEFAULT_SWE_SMITH_SPLIT})`,
    "  --offset <number>         Row offset in the dataset (default: 0)",
    "  --limit <number>          Number of rows to import (default: 5)",
    "  --output-dir <path>      Destination root for imported bundle JSON files",
    "  --dry-run                Fetch and convert without writing files",
    "  --help, -h               Show this message",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
