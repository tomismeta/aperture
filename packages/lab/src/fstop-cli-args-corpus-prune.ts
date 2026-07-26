import path from "node:path";

import type { PublicCorpusPruneOptions } from "./public-corpus-prune.js";
import { printCorpusPruneUsage } from "./fstop-cli-usage.js";
import { printUsageAndExit } from "./fstop-cli-args-support.js";
import type { JsonOptions } from "./fstop-cli-args.js";

export type CorpusPruneCliOptions = PublicCorpusPruneOptions & JsonOptions;

export function parseCorpusPruneArgs(argv: string[]): CorpusPruneCliOptions {
  const options: CorpusPruneCliOptions = {
    manifestPaths: [],
    previousManifestPaths: [],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--manifest":
        options.manifestPaths = [
          ...options.manifestPaths,
          path.resolve(readFlagValue(argv, ++index, arg)),
        ];
        break;
      case "--previous-manifest":
        options.previousManifestPaths = [
          ...(options.previousManifestPaths ?? []),
          path.resolve(readFlagValue(argv, ++index, arg)),
        ];
        break;
      case "--bundle-root":
        options.bundleRoot = path.resolve(readFlagValue(argv, ++index, arg));
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--dry-run":
        options.apply = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCorpusPruneUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.manifestPaths.length === 0) {
    throw new Error("--manifest is required for corpus-prune");
  }
  return options;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
