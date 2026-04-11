import path from "node:path";

import {
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
  defaultPublicTrajectorySplit,
  type ImportPublicTrajectoryBundlesOptions,
} from "./index.js";
import {
  printIngestUsage,
  printTrajectoryImportUsage,
} from "./fstop-cli-usage.js";
import {
  printUsageAndExit,
  readDataset,
  readInteger,
  readPublicSplit,
} from "./fstop-cli-args-support.js";
import type { IngestOptions } from "./fstop-cli-args.js";

export function parseIngestArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {
    filePath: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--file":
        options.filePath = path.resolve(argv[++index] ?? "");
        break;
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readPublicSplit(argv[++index]);
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printIngestUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.dataset && !options.split) {
    options.split = defaultPublicTrajectorySplit(options.dataset);
  }
  options.outputDirectory ??= DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR;
  return options;
}

export function parseTrajectoryImportArgs(argv: string[]): ImportPublicTrajectoryBundlesOptions {
  const options: ImportPublicTrajectoryBundlesOptions = {
    dataset: "swe-smith",
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
        options.split = readPublicSplit(argv[++index]);
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
        return printUsageAndExit(printTrajectoryImportUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.split ??= defaultPublicTrajectorySplit(options.dataset ?? "swe-smith");
  options.outputDirectory ??= DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR;
  return options;
}
